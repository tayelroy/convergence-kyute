import { encode } from "@msgpack/msgpack";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils";

type Side = "buy" | "sell";

type ActiveAccount = {
  address: string;
  signTypedData: (typedData: Record<string, unknown>) => Promise<string>;
};

type ExecuteEthOrderParams = {
  account: ActiveAccount;
  side: Side;
  positionUsd: number;
  leverage: number;
  testnet: boolean;
  slippageBps?: number;
};

const MIN_NOTIONAL_USD = 10;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

type MetaAndCtxResponse = [
  {
    universe: Array<{
      name: string;
      szDecimals: number;
    }>;
  },
  unknown[],
];

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    const candidates = [obj.message, obj.shortMessage, obj.details, obj.error];
    for (const c of candidates) {
      if (typeof c === "string" && c.length > 0) return c;
    }
    try {
      return JSON.stringify(obj);
    } catch {
      return "Unknown object error";
    }
  }
  return "Unknown error";
};

const toUint64Bytes = (n: bigint | number | string): Uint8Array => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(n));
  return bytes;
};

const removeUndefinedKeys = (obj: unknown): unknown => {
  if (Array.isArray(obj)) return obj.map(removeUndefinedKeys);
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) result[key] = removeUndefinedKeys(value);
    }
    return result;
  }
  return obj;
};

const largeIntToBigInt = (obj: unknown): unknown => {
  if (typeof obj === "number" && Number.isInteger(obj) && (obj >= 0x100000000 || obj < -0x80000000)) {
    return BigInt(obj);
  }
  if (Array.isArray(obj)) return obj.map(largeIntToBigInt);
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) result[key] = largeIntToBigInt(value);
    return result;
  }
  return obj;
};

const createL1ActionHash = (args: {
  action: Record<string, unknown> | unknown[];
  nonce: number;
  vaultAddress?: `0x${string}`;
  expiresAfter?: number;
}): `0x${string}` => {
  const { action, nonce, vaultAddress, expiresAfter } = args;
  const actionBytes = encode(largeIntToBigInt(removeUndefinedKeys(action)));
  const nonceBytes = toUint64Bytes(nonce);
  const vaultMarker = vaultAddress ? new Uint8Array([1]) : new Uint8Array([0]);
  const vaultBytes = vaultAddress ? hexToBytes(vaultAddress.slice(2)) : new Uint8Array();
  const expiresMarker = expiresAfter !== undefined ? new Uint8Array([0]) : new Uint8Array();
  const expiresBytes = expiresAfter !== undefined ? toUint64Bytes(expiresAfter) : new Uint8Array();

  const bytes = concatBytes(actionBytes, nonceBytes, vaultMarker, vaultBytes, expiresMarker, expiresBytes);
  return `0x${bytesToHex(keccak_256(bytes))}`;
};

const parseSignature = (signatureHex: string): { r: `0x${string}`; s: `0x${string}`; v: 27 | 28 } => {
  const sig = signatureHex.slice(2);
  if (sig.length !== 130) {
    throw new Error("Invalid signature length from wallet");
  }
  const r = `0x${sig.slice(0, 64)}` as const;
  const s = `0x${sig.slice(64, 128)}` as const;
  const vRaw = parseInt(sig.slice(128, 130), 16);
  const v = (vRaw >= 27 ? vRaw : vRaw + 27) as 27 | 28;
  if (v !== 27 && v !== 28) throw new Error("Invalid signature recovery value");
  return { r, s, v };
};

const signTypedDataWithFallback = async (
  account: ActiveAccount,
  typedData: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: `0x${string}`;
    };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  },
): Promise<string> => {
  try {
    return await account.signTypedData(typedData);
  } catch (error) {
    const message = errorMessage(error).toLowerCase();
    const isChainIdMismatch = message.includes("chainid should be same as current chainid");
    if (!isChainIdMismatch) throw error;

    // Some wallet wrappers enforce `typedData.domain.chainId === activeChainId`.
    // Hyperliquid L1 signing requires chainId=1337, so we fallback to raw EIP-1193 call.
    if (typeof window === "undefined" || !(window as Window & { ethereum?: unknown }).ethereum) {
      throw new Error("Wallet rejected chainId mismatch and no injected provider fallback is available");
    }

    const provider = (window as Window & {
      ethereum?: {
        request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      };
    }).ethereum;

    if (!provider?.request) {
      throw new Error("Injected wallet provider missing request() for signTypedData fallback");
    }

    const typedDataForRpc = {
      ...typedData,
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        ...typedData.types,
      },
    };

    const signature = await provider.request({
      method: "eth_signTypedData_v4",
      params: [account.address, JSON.stringify(typedDataForRpc)],
    });

    if (typeof signature !== "string") {
      throw new Error("Invalid signature response from eth_signTypedData_v4");
    }
    return signature;
  }
};

const signL1Action = async (args: {
  account: ActiveAccount;
  action: Record<string, unknown> | unknown[];
  nonce: number;
  isTestnet: boolean;
}) => {
  const connectionId = createL1ActionHash({ action: args.action, nonce: args.nonce });
  const typedData = {
    domain: {
      name: "Exchange",
      version: "1",
      chainId: 1337,
      verifyingContract: ZERO_ADDRESS,
    },
    types: {
      Agent: [
        { name: "source", type: "string" },
        { name: "connectionId", type: "bytes32" },
      ],
    },
    primaryType: "Agent",
    message: {
      source: args.isTestnet ? "b" : "a",
      connectionId,
    },
  } as const;
  const signatureHex = await signTypedDataWithFallback(args.account, typedData);
  return parseSignature(signatureHex);
};

const formatDecimalString = (value: string): string =>
  value
    .trim()
    .replace(/^(-?)0+(?=\d)/, "$1")
    .replace(/\.0*$|(\.\d+?)0+$/, "$1")
    .replace(/^(-?)\./, "$10.")
    .replace(/^-?$/, "0")
    .replace(/^-0$/, "0");

const toFixedTruncate = (value: string, decimals: number): string => {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error("Invalid decimals");
  const regex = new RegExp(`^-?(?:\\d+)?(?:\\.\\d{0,${decimals}})?`);
  const result = value.match(regex)?.[0];
  if (!result) throw new Error("Invalid numeric format");
  return formatDecimalString(result);
};

const toPrecisionTruncate = (value: string, precision: number): string => {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return "0";
  const magnitude = Math.floor(Math.log10(Math.abs(num)));
  const decimals = Math.max(precision - magnitude - 1, 0);
  return formatDecimalString(toFixedTruncate(value, decimals));
};

const formatSize = (size: number, szDecimals: number): string => {
  const out = toFixedTruncate(String(size), szDecimals);
  if (out === "0") throw new Error("Size too small after formatting");
  return out;
};

const formatPrice = (price: number, szDecimals: number): string => {
  if (Number.isInteger(price)) return String(price);
  const maxDecimals = Math.max(6 - szDecimals, 0);
  const decTrim = toFixedTruncate(String(price), maxDecimals);
  const sigTrim = toPrecisionTruncate(decTrim, 5);
  if (sigTrim === "0") throw new Error("Price too small after formatting");
  return sigTrim;
};

const postInfo = async (testnet: boolean, type: string) => {
  const response = await fetch("/api/hyperliquid/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "info",
      testnet,
      payload: { type },
    }),
  });
  const body = (await response.json()) as { ok: boolean; status?: number; data?: unknown; error?: string };
  if (!response.ok || !body.ok) {
    throw new Error(`Info relay failed: http=${response.status} upstream=${body.status ?? "n/a"} ${body.error ?? ""}`);
  }
  return body.data;
};

const postExchange = async (testnet: boolean, payload: Record<string, unknown>) => {
  const response = await fetch("/api/hyperliquid/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "exchange",
      testnet,
      payload,
    }),
  });
  const body = (await response.json()) as { ok: boolean; status?: number; data?: unknown; error?: string };
  if (!response.ok || !body.ok) {
    throw new Error(
      `Exchange relay failed: http=${response.status} upstream=${body.status ?? "n/a"} ${body.error ?? JSON.stringify(body.data ?? {})}`,
    );
  }
  return body.data;
};

export const executeEthOrderClientSide = async (params: ExecuteEthOrderParams) => {
  const slippageBps = params.slippageBps ?? 50;

  if (params.positionUsd < MIN_NOTIONAL_USD) {
    throw new Error("Minimum order value is $10");
  }
  if (params.leverage < 1 || params.leverage > 50) {
    throw new Error("Leverage must be between 1 and 50");
  }

  let metaRaw: unknown;
  let midsRaw: unknown;
  try {
    [metaRaw, midsRaw] = await Promise.all([
      postInfo(params.testnet, "metaAndAssetCtxs"),
      postInfo(params.testnet, "allMids"),
    ]);
  } catch (e) {
    throw new Error(`Preflight fetch failed: ${errorMessage(e)}`);
  }

  const [meta] = metaRaw as MetaAndCtxResponse;
  const mids = midsRaw as Record<string, string>;

  const ethIndex = meta.universe.findIndex((a) => a.name === "ETH");
  if (ethIndex < 0) throw new Error("ETH not found in market universe");

  const szDecimals = meta.universe[ethIndex].szDecimals;
  const mid = Number(mids.ETH);
  if (!Number.isFinite(mid) || mid <= 0) throw new Error("Unable to fetch ETH mid price");

  const size = formatSize(params.positionUsd / mid, szDecimals);
  const limitPx = formatPrice(
    params.side === "buy" ? mid * (1 + slippageBps / 10_000) : mid * (1 - slippageBps / 10_000),
    szDecimals,
  );

  const leverageAction = {
    type: "updateLeverage",
    asset: ethIndex,
    isCross: true,
    leverage: Math.round(params.leverage),
  };
  const leverageNonce = Date.now();
  let leverageSignature: { r: `0x${string}`; s: `0x${string}`; v: 27 | 28 };
  try {
    leverageSignature = await signL1Action({
      account: params.account,
      action: leverageAction,
      nonce: leverageNonce,
      isTestnet: params.testnet,
    });
  } catch (e) {
    throw new Error(`Leverage signature failed: ${errorMessage(e)}`);
  }
  try {
    await postExchange(params.testnet, { action: leverageAction, nonce: leverageNonce, signature: leverageSignature });
  } catch (e) {
    throw new Error(`Leverage submit failed: ${errorMessage(e)}`);
  }

  const orderAction = {
    type: "order",
    orders: [
      {
        a: ethIndex,
        b: params.side === "buy",
        p: limitPx,
        s: size,
        r: false,
        t: { limit: { tif: "Ioc" } },
      },
    ],
    grouping: "na",
  };
  const orderNonce = Date.now() + 1;
  let orderSignature: { r: `0x${string}`; s: `0x${string}`; v: 27 | 28 };
  try {
    orderSignature = await signL1Action({
      account: params.account,
      action: orderAction,
      nonce: orderNonce,
      isTestnet: params.testnet,
    });
  } catch (e) {
    throw new Error(`Order signature failed: ${errorMessage(e)}`);
  }
  let orderResp: unknown;
  try {
    orderResp = await postExchange(params.testnet, { action: orderAction, nonce: orderNonce, signature: orderSignature });
  } catch (e) {
    throw new Error(`Order submit failed: ${errorMessage(e)}`);
  }

  return {
    ok: true,
    orderResponse: orderResp,
    ethIndex,
    midPrice: mid,
    sizeEth: size,
    limitPrice: limitPx,
    positionUsd: params.positionUsd,
  };
};
