import {
  CronCapability,
  consensusIdenticalAggregation,
  handler,
  Runner,
  HTTPClient,
  EVMClient,
  hexToBase64,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  parseEther,
  keccak256,
  toBytes,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  computeHedgePolicy,
  type HedgeMode,
  type PositionSide,
} from "../hedge-policy.js";
import { buildHedgeExecutionPlan } from "../hedge-execution-plan.js";
import {
  DEFAULT_BOROS_CORE_API_BASE_URL,
  DEFAULT_BOROS_MARKET_ID,
  fetchBorosAprSnapshot,
} from "../boros-core-api.js";
import { resolveFreshOracleTimestamp } from "../oracle-timestamp.js";
import { fetchTextViaRequester, type SupabaseRestFetch } from "../supabase-rest.js";
import { resolveUserHedgeMode } from "../strategy-config.js";
import { resolveRequiredWalletIdentity } from "../wallet-bridge.js";

type PerpSide = "buy" | "sell";
type PerpOrderType = "market" | "limit";
type ExecutionStatus = "filled" | "resting" | "error";

type HyperliquidMetaAndCtxs = [
  {
    universe: Array<{
      name: string;
      szDecimals?: number;
    }>;
  },
  Array<{
    markPx?: string;
    oraclePx?: string;
    midPx?: string;
  }>,
];

type HyperliquidInfoClient = {
  postInfo: (payload: Record<string, unknown>) => Promise<unknown>;
};

type HyperliquidExchangeClient = {
  order?: (payload: Record<string, unknown>) => Promise<unknown>;
};

type RpcTextFetchResult = {
  statusCode: number;
  bodyText: string;
};

type RpcTextFetch = (url: string, bodyText: string) => Promise<RpcTextFetchResult>;

type RelaySignedRequest = {
  action: Record<string, unknown>;
  nonce: number;
  signature: Record<string, unknown>;
  vaultAddress?: `0x${string}`;
};

type RelaySigner = (params: {
  action: Record<string, unknown>;
  nonce: number;
  privateKey: `0x${string}`;
  vaultAddress?: `0x${string}`;
}) => Promise<RelaySignedRequest>;

type ExecutionEvent = {
  asset: string;
  side: PerpSide;
  size: string;
  filled_price: string | null;
  status: ExecutionStatus;
  oid: string | null;
  reason?: string;
};

type ExecutePerpOrderParams = {
  asset: string;
  side: PerpSide;
  size: number;
  orderType: PerpOrderType;
  reduceOnly?: boolean;
  requestedPrice?: number;
  slippageBps?: number;
  oracleDeviationBps?: number;
  baseUrl?: string;
  privateKey?: `0x${string}`;
  vaultAddress?: `0x${string}`;
  infoClient?: HyperliquidInfoClient;
  exchangeClient?: HyperliquidExchangeClient;
  relaySigner?: RelaySigner;
  emitEvent?: (event: ExecutionEvent) => void;
};

const DEFAULT_HL_BASE_URL = "https://api.hyperliquid.xyz";
const DEFAULT_MAX_ORACLE_DEVIATION_BPS = 100; // 1.00%
const DEFAULT_RPC_READ_TIMEOUT_MS = 8_000;
const DEFAULT_RPC_RECEIPT_TIMEOUT_MS = 30_000;
const DEFAULT_RPC_RECEIPT_POLL_MS = 1_000;

const postJson = async (url: string, payload: Record<string, unknown>) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`HTTP ${response.status} from ${url}: ${bodyText}`);
  }
  return response.json() as Promise<unknown>;
};

const fetchRpcTextViaRequester = (
  requester: HTTPSendRequester,
  url: string,
  bodyText: string,
): RpcTextFetchResult => {
  const response = requester.sendRequest({
    url,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: Buffer.from(bodyText).toString("base64"),
    cacheSettings: {
      store: false,
      maxAge: "0s",
    },
  }).result();

  return {
    statusCode: response.statusCode,
    bodyText: new TextDecoder().decode(response.body),
  };
};

const rawRpcRequest = async <T>(args: {
  rpcUrl: string;
  method: string;
  params: unknown[];
  timeoutMs?: number;
  rpcFetch: RpcTextFetch;
}): Promise<T> => {
  const timeoutMs = args.timeoutMs ?? DEFAULT_RPC_READ_TIMEOUT_MS;
  const requestBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: args.method,
    params: args.params,
  });

  const response = await Promise.race([
    args.rpcFetch(args.rpcUrl, requestBody),
    new Promise<RpcTextFetchResult>((_, reject) =>
      setTimeout(() => reject(new Error(`${args.method} timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`HTTP ${response.statusCode} from ${args.rpcUrl}: ${response.bodyText}`);
  }

  const payload = JSON.parse(response.bodyText) as {
    result?: T;
    error?: { code?: number; message?: string; data?: unknown };
  };

  if (payload.error) {
    throw new Error(
      `JSON-RPC ${payload.error.code ?? "unknown"}: ${payload.error.message ?? "Unknown error"}${
        payload.error.data !== undefined ? ` data=${JSON.stringify(payload.error.data)}` : ""
      }`,
    );
  }

  return payload.result as T;
};

const rawRpcBatchRequest = async (args: {
  rpcUrl: string;
  calls: Array<{ id: number; method: string; params: unknown[] }>;
  timeoutMs?: number;
  rpcFetch: RpcTextFetch;
}): Promise<Map<number, unknown>> => {
  const timeoutMs = args.timeoutMs ?? DEFAULT_RPC_READ_TIMEOUT_MS;
  const requestBody = JSON.stringify(
    args.calls.map((call) => ({
      jsonrpc: "2.0",
      id: call.id,
      method: call.method,
      params: call.params,
    })),
  );

  const response = await Promise.race([
    args.rpcFetch(args.rpcUrl, requestBody),
    new Promise<RpcTextFetchResult>((_, reject) =>
      setTimeout(() => reject(new Error(`rpc batch timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`HTTP ${response.statusCode} from ${args.rpcUrl}: ${response.bodyText}`);
  }

  const payload = JSON.parse(response.bodyText) as Array<{
    id?: number;
    result?: unknown;
    error?: { code?: number; message?: string; data?: unknown };
  }>;

  if (!Array.isArray(payload)) {
    throw new Error(`Invalid batch RPC response: ${response.bodyText}`);
  }

  const results = new Map<number, unknown>();
  for (const item of payload) {
    if (typeof item.id !== "number") {
      throw new Error(`Batch RPC item missing numeric id: ${JSON.stringify(item)}`);
    }
    if (item.error) {
      throw new Error(
        `JSON-RPC ${item.error.code ?? "unknown"} on batch id=${item.id}: ${item.error.message ?? "Unknown error"}${
          item.error.data !== undefined ? ` data=${JSON.stringify(item.error.data)}` : ""
        }`,
      );
    }
    results.set(item.id, item.result);
  }

  return results;
};

const rawEthCall = async (args: {
  rpcUrl: string;
  to: `0x${string}`;
  data: `0x${string}`;
  blockTag?: string;
  timeoutMs?: number;
  rpcFetch: RpcTextFetch;
}): Promise<`0x${string}`> => {
  const result = await rawRpcRequest<string>({
    rpcUrl: args.rpcUrl,
    method: "eth_call",
    params: [{ to: args.to, data: args.data }, args.blockTag ?? "latest"],
    timeoutMs: args.timeoutMs,
    rpcFetch: args.rpcFetch,
  });

  if (typeof result !== "string" || !result.startsWith("0x")) {
    throw new Error(`Invalid eth_call result: ${JSON.stringify(result)}`);
  }

  return result as `0x${string}`;
};

const toRpcHex = (value: bigint): `0x${string}` => `0x${value.toString(16)}` as `0x${string}`;

const estimateGasWithHeadroom = async (args: {
  rpcUrl: string;
  from: Address;
  to: Address;
  data: `0x${string}`;
  rpcFetch: RpcTextFetch;
}): Promise<bigint> => {
  const result = await rawRpcRequest<string>({
    rpcUrl: args.rpcUrl,
    method: "eth_estimateGas",
    params: [{ from: args.from, to: args.to, data: args.data }],
    rpcFetch: args.rpcFetch,
  });
  const estimate = BigInt(result);
  return (estimate * 12n) / 10n;
};

const getPendingNonce = async (args: {
  rpcUrl: string;
  address: Address;
  rpcFetch: RpcTextFetch;
}): Promise<bigint> => {
  const result = await rawRpcRequest<string>({
    rpcUrl: args.rpcUrl,
    method: "eth_getTransactionCount",
    params: [args.address, "pending"],
    rpcFetch: args.rpcFetch,
  });
  return BigInt(result);
};

const getGasPrice = async (args: {
  rpcUrl: string;
  rpcFetch: RpcTextFetch;
}): Promise<bigint> => {
  const result = await rawRpcRequest<string>({
    rpcUrl: args.rpcUrl,
    method: "eth_gasPrice",
    params: [],
    rpcFetch: args.rpcFetch,
  });
  return BigInt(result);
};

const getChainId = async (args: {
  rpcUrl: string;
  rpcFetch: RpcTextFetch;
}): Promise<number> => {
  const result = await rawRpcRequest<string>({
    rpcUrl: args.rpcUrl,
    method: "eth_chainId",
    params: [],
    rpcFetch: args.rpcFetch,
  });
  return Number(BigInt(result));
};

const sendSignedTransaction = async (args: {
  rpcUrl: string;
  account: ReturnType<typeof privateKeyToAccount>;
  to: Address;
  data: `0x${string}`;
  rpcFetch: RpcTextFetch;
}): Promise<`0x${string}`> => {
  const [nonce, gasPrice, gas, chainId] = await Promise.all([
    getPendingNonce({ rpcUrl: args.rpcUrl, address: args.account.address, rpcFetch: args.rpcFetch }),
    getGasPrice({ rpcUrl: args.rpcUrl, rpcFetch: args.rpcFetch }),
    estimateGasWithHeadroom({
      rpcUrl: args.rpcUrl,
      from: args.account.address,
      to: args.to,
      data: args.data,
      rpcFetch: args.rpcFetch,
    }),
    getChainId({ rpcUrl: args.rpcUrl, rpcFetch: args.rpcFetch }),
  ]);

  const rawTx = await args.account.signTransaction({
    chainId,
    type: "legacy",
    to: args.to,
    data: args.data,
    nonce,
    gas,
    gasPrice,
    value: 0n,
  });

  const txHash = await rawRpcRequest<string>({
    rpcUrl: args.rpcUrl,
    method: "eth_sendRawTransaction",
    params: [rawTx],
    rpcFetch: args.rpcFetch,
  });

  if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
    throw new Error(`Invalid eth_sendRawTransaction result: ${JSON.stringify(txHash)}`);
  }

  return txHash as `0x${string}`;
};

const waitForTransactionReceipt = async (args: {
  rpcUrl: string;
  txHash: `0x${string}`;
  rpcFetch: RpcTextFetch;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{ status: "success" | "reverted"; raw: Record<string, unknown> }> => {
  const timeoutMs = args.timeoutMs ?? DEFAULT_RPC_RECEIPT_TIMEOUT_MS;
  const pollIntervalMs = args.pollIntervalMs ?? DEFAULT_RPC_RECEIPT_POLL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await rawRpcRequest<Record<string, unknown> | null>({
      rpcUrl: args.rpcUrl,
      method: "eth_getTransactionReceipt",
      params: [args.txHash],
      rpcFetch: args.rpcFetch,
    });

    if (result) {
      const statusHex = typeof result.status === "string" ? result.status : "0x0";
      return {
        status: statusHex === "0x1" ? "success" : "reverted",
        raw: result,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Timed out waiting for transaction receipt tx=${args.txHash}`);
};

const readUserIdToAddress = async (args: {
  rpcUrl: string;
  vaultAddress: `0x${string}`;
  userId: bigint;
  rpcFetch: RpcTextFetch;
}): Promise<{ payload: `0x${string}`; rawResult: `0x${string}`; address: `0x${string}` }> => {
  const data = encodeFunctionData({
    abi: KYUTE_VAULT_ABI,
    functionName: "userIdToAddress",
    args: [args.userId],
  });

  const result = await rawEthCall({
    rpcUrl: args.rpcUrl,
    to: args.vaultAddress,
    data,
    rpcFetch: args.rpcFetch,
  });

  const address = decodeFunctionResult({
    abi: KYUTE_VAULT_ABI,
    functionName: "userIdToAddress",
    data: result,
  }) as `0x${string}`;

  return { payload: data, rawResult: result, address };
};

const readCreCallbackOperator = async (args: {
  rpcUrl: string;
  vaultAddress: `0x${string}`;
  rpcFetch: RpcTextFetch;
}): Promise<{ payload: `0x${string}`; rawResult: `0x${string}`; address: `0x${string}` }> => {
  const data = encodeFunctionData({
    abi: KYUTE_VAULT_ABI,
    functionName: "creCallbackOperator",
  });

  const result = await rawEthCall({
    rpcUrl: args.rpcUrl,
    to: args.vaultAddress,
    data,
    rpcFetch: args.rpcFetch,
  });

  const address = decodeFunctionResult({
    abi: KYUTE_VAULT_ABI,
    functionName: "creCallbackOperator",
    data: result,
  }) as `0x${string}`;

  return { payload: data, rawResult: result, address };
};

const readUserPosition = async (args: {
  rpcUrl: string;
  vaultAddress: `0x${string}`;
  userAddress: `0x${string}`;
  rpcFetch: RpcTextFetch;
}): Promise<{
  payload: `0x${string}`;
  rawResult: `0x${string}`;
  position: readonly [Address, boolean, bigint, bigint, boolean, Address, bigint, bigint, bigint, boolean, boolean];
}> => {
  const data = encodeFunctionData({
    abi: KYUTE_VAULT_ABI,
    functionName: "userPositions",
    args: [args.userAddress],
  });

  const result = await rawEthCall({
    rpcUrl: args.rpcUrl,
    to: args.vaultAddress,
    data,
    rpcFetch: args.rpcFetch,
  });

  const position = decodeFunctionResult({
    abi: KYUTE_VAULT_ABI,
    functionName: "userPositions",
    data: result,
  }) as readonly [Address, boolean, bigint, bigint, boolean, Address, bigint, bigint, bigint, boolean, boolean];

  return { payload: data, rawResult: result, position };
};

const readVaultMappingAndPosition = async (args: {
  rpcUrl: string;
  vaultAddress: `0x${string}`;
  userId: bigint;
  userAddress: `0x${string}`;
  rpcFetch: RpcTextFetch;
}): Promise<{
  mappingPayload: `0x${string}`;
  mappingRawResult: `0x${string}`;
  mappedAddress: `0x${string}`;
  positionPayload: `0x${string}`;
  positionRawResult: `0x${string}`;
  position: readonly [Address, boolean, bigint, bigint, boolean, Address, bigint, bigint, bigint, boolean, boolean];
}> => {
  const mappingPayload = encodeFunctionData({
    abi: KYUTE_VAULT_ABI,
    functionName: "userIdToAddress",
    args: [args.userId],
  });
  const positionPayload = encodeFunctionData({
    abi: KYUTE_VAULT_ABI,
    functionName: "userPositions",
    args: [args.userAddress],
  });

  const results = await rawRpcBatchRequest({
    rpcUrl: args.rpcUrl,
    rpcFetch: args.rpcFetch,
    calls: [
      {
        id: 1,
        method: "eth_call",
        params: [{ to: args.vaultAddress, data: mappingPayload }, "latest"],
      },
      {
        id: 2,
        method: "eth_call",
        params: [{ to: args.vaultAddress, data: positionPayload }, "latest"],
      },
    ],
  });

  const mappingRawResult = results.get(1);
  const positionRawResult = results.get(2);
  if (typeof mappingRawResult !== "string" || !mappingRawResult.startsWith("0x")) {
    throw new Error(`Invalid batch mapping result: ${JSON.stringify(mappingRawResult)}`);
  }
  if (typeof positionRawResult !== "string" || !positionRawResult.startsWith("0x")) {
    throw new Error(`Invalid batch position result: ${JSON.stringify(positionRawResult)}`);
  }

  const mappedAddress = decodeFunctionResult({
    abi: KYUTE_VAULT_ABI,
    functionName: "userIdToAddress",
    data: mappingRawResult as `0x${string}`,
  }) as `0x${string}`;

  const position = decodeFunctionResult({
    abi: KYUTE_VAULT_ABI,
    functionName: "userPositions",
    data: positionRawResult as `0x${string}`,
  }) as readonly [Address, boolean, bigint, bigint, boolean, Address, bigint, bigint, bigint, boolean, boolean];

  return {
    mappingPayload,
    mappingRawResult: mappingRawResult as `0x${string}`,
    mappedAddress,
    positionPayload,
    positionRawResult: positionRawResult as `0x${string}`,
    position,
  };
};

const parseOrderResult = (
  raw: unknown,
): { status: ExecutionStatus; filledPrice: string | null; oid: string | null; reason?: string } => {
  const data = raw as Record<string, unknown>;
  const response = (data.response ?? data.data ?? data) as Record<string, unknown>;
  const statuses = ((response.data as Record<string, unknown> | undefined)?.statuses ??
    response.statuses ??
    []) as unknown[];

  for (const entry of statuses) {
    const statusEntry = entry as Record<string, unknown>;

    if (statusEntry.filled) {
      const filled = statusEntry.filled as Record<string, unknown>;
      return {
        status: "filled",
        filledPrice: (filled.avgPx ?? filled.px ?? null) as string | null,
        oid: (filled.oid ?? null) as string | null,
      };
    }

    if (statusEntry.resting) {
      const resting = statusEntry.resting as Record<string, unknown>;
      return {
        status: "resting",
        filledPrice: null,
        oid: (resting.oid ?? null) as string | null,
      };
    }

    if (statusEntry.error) {
      return {
        status: "error",
        filledPrice: null,
        oid: null,
        reason: String(statusEntry.error),
      };
    }
  }

  if (data.status === "error") {
    return { status: "error", filledPrice: null, oid: null, reason: String(data.error ?? "Unknown error") };
  }

  return { status: "resting", filledPrice: null, oid: null };
};

const isSdkClient = (exchangeClient: HyperliquidExchangeClient | undefined): exchangeClient is Required<Pick<HyperliquidExchangeClient, "order">> => {
  return typeof exchangeClient?.order === "function";
};

/**
 * Executes a Hyperliquid perpetual order with pre-flight validation and structured execution events.
 *
 * Notes:
 * - `limit` orders require `requestedPrice`.
 * - `market` orders are sent as IOC with a strict slippage bound.
 * - If `exchangeClient.order` is provided, it is used as the preferred execution path.
 * - If no SDK client exists, provide `privateKey` + `relaySigner` for `/exchange` order-relay flow.
 */
export const execute_perp_order = async (params: ExecutePerpOrderParams): Promise<ExecutionEvent> => {
  const emit = params.emitEvent ?? ((event) => console.log(JSON.stringify(event)));
  const baseUrl = params.baseUrl ?? DEFAULT_HL_BASE_URL;
  const slippageBps = params.slippageBps ?? 50; // 0.50%
  const oracleDeviationBps = params.oracleDeviationBps ?? DEFAULT_MAX_ORACLE_DEVIATION_BPS;

  try {
    const infoClient = params.infoClient ?? {
      postInfo: (payload: Record<string, unknown>) => postJson(`${baseUrl}/info`, payload),
    };

    const [metaAndCtxsRaw, allMidsRaw] = await Promise.all([
      infoClient.postInfo({ type: "metaAndAssetCtxs" }),
      infoClient.postInfo({ type: "allMids" }),
    ]);

    const [meta, assetCtxs] = metaAndCtxsRaw as HyperliquidMetaAndCtxs;
    const mids = allMidsRaw as Record<string, string>;

    const asset = params.asset.toUpperCase();
    const assetIndex = meta.universe.findIndex((u) => u.name === asset);
    if (assetIndex < 0) throw new Error(`Unknown perp asset: ${asset}`);

    const szDecimals = meta.universe[assetIndex].szDecimals ?? 0;
    const midPxRaw = mids[asset] ?? assetCtxs[assetIndex]?.midPx ?? assetCtxs[assetIndex]?.markPx;
    if (!midPxRaw) throw new Error(`Unable to resolve mid-price for ${asset}`);

    const midPx = Number(midPxRaw);
    if (!Number.isFinite(midPx) || midPx <= 0) throw new Error(`Invalid mid-price for ${asset}: ${midPxRaw}`);

    let size: string;
    try {
      size = formatSize(params.size, szDecimals);
    } catch {
      throw new Error(
        `Order size too small or invalid for ${asset}. requested=${params.size}, szDecimals=${szDecimals}`,
      );
    }
    if (Number(size) <= 0) {
      throw new Error(
        `Order size too small for ${asset}. requested=${params.size}, szDecimals=${szDecimals}, formatted=${size}`,
      );
    }

    // Oracle price sanity check against the user's intended price (limit price or optional market guard price).
    if (typeof params.requestedPrice === "number" && params.requestedPrice > 0) {
      const deviationBps = (Math.abs(params.requestedPrice - midPx) / midPx) * 10_000;
      if (deviationBps > oracleDeviationBps) {
        throw new Error(
          `Oracle check failed for ${asset}: requested=${params.requestedPrice}, mid=${midPx}, deviation=${deviationBps.toFixed(2)}bps`,
        );
      }
    }

    let limitPx: string;
    if (params.orderType === "limit") {
      if (typeof params.requestedPrice !== "number" || params.requestedPrice <= 0) {
        throw new Error("Limit orders require a positive requestedPrice");
      }
      limitPx = formatPrice(params.requestedPrice, szDecimals, "perp");
    } else {
      // Market orders on Hyperliquid are implemented as IOC limit orders with protective price bounds.
      const slippageFraction = slippageBps / 10_000;
      const maxAcceptablePx =
        params.side === "buy" ? midPx * (1 + slippageFraction) : midPx * (1 - slippageFraction);
      limitPx = formatPrice(maxAcceptablePx, szDecimals, "perp");
    }

    const orderWire = {
      a: assetIndex,
      b: params.side === "buy",
      p: limitPx,
      s: size,
      r: params.reduceOnly ?? false,
      t: { limit: { tif: params.orderType === "market" ? "Ioc" : "Gtc" } },
    };

    let rawOrderResponse: unknown;

    if (isSdkClient(params.exchangeClient)) {
      rawOrderResponse = await params.exchangeClient.order({
        orders: [orderWire],
        grouping: "na",
      });
    } else {
      if (!params.privateKey || !params.relaySigner) {
        throw new Error(
          "Missing execution transport: pass exchangeClient.order(...) for SDK mode, or privateKey + relaySigner for order-relay mode",
        );
      }

      const nonce = Date.now();
      const action = { type: "order", orders: [orderWire], grouping: "na" };
      const signedRequest = await params.relaySigner({
        action,
        nonce,
        privateKey: params.privateKey,
        vaultAddress: params.vaultAddress,
      });

      rawOrderResponse = await postJson(`${baseUrl}/exchange`, signedRequest);
    }

    const parsed = parseOrderResult(rawOrderResponse);
    const event: ExecutionEvent = {
      asset,
      side: params.side,
      size,
      filled_price: parsed.filledPrice,
      status: parsed.status,
      oid: parsed.oid,
      ...(parsed.reason ? { reason: parsed.reason } : {}),
    };
    emit(event);

    if (event.status === "error") {
      throw new Error(event.reason ?? "Order rejected by exchange");
    }

    return event;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Account is Liquidating")) {
      throw new Error(`Execution aborted: ${message}`);
    }
    if (message.toLowerCase().includes("insufficient")) {
      throw new Error(`Execution aborted due to insufficient margin/balance: ${message}`);
    }
    if (message.toLowerCase().includes("timeout")) {
      throw new Error(`Network timeout while sending Hyperliquid order: ${message}`);
    }
    throw new Error(`execute_perp_order failed: ${message}`);
  }
};

/*
Usage Example (0.5% slippage tolerance):

await execute_perp_order({
  asset: "BTC",
  side: "buy",
  size: 0.01,
  orderType: "market",
  slippageBps: 50, // 0.50%
  oracleDeviationBps: 100, // reject if requested price deviates > 1%
  reduceOnly: false, // set true to close/reduce an existing position
  exchangeClient, // preferred: official SDK Exchange client with .order(...)
});
*/

type Config = {
  schedule: string;
  vaultAddress: string;
  agentSidecarUrl?: string;
  userId?: number;
  yuToken?: string;
  supabaseUrl?: string;
  hlAddress?: string;
  hlTestnet?: boolean;
  hlBaseUrl?: string;
  hlFundingTestnet?: boolean;
  hlFundingBaseUrl?: string;
  hlPositionTestnet?: boolean;
  hlPositionBaseUrl?: string;
  thresholdBp?: number;
  entryThresholdBp?: number;
  exitThresholdBp?: number;
  hedgeMode?: HedgeMode;
  hedgeNotionalUseMarkPrice?: boolean;
  borosOiFeeBp?: number;
  borosMarketId?: number;
  borosMarketAddress?: string;
  borosCoreApiUrl?: string;
  windowHours?: number;
  callbackPrivateKey?: `0x${string}`;
  rpcUrl?: string;
  enableReportWrite?: boolean;
  executeOnchain?: boolean;
};

type FundingHistoryEntry = {
  fundingRate?: number | string;
  funding?: number | string;
  rate?: number | string;
  time?: number | string;
  timestamp?: number | string;
  t?: number | string;
};

type SerializedVaultPosition = {
  asset: Address;
  isLong: boolean;
  notional: string;
  leverage: string;
  hasBorosHedge: boolean;
  yuToken: Address;
  lastUpdateTimestamp: string;
  targetHedgeNotional: string;
  currentHedgeNotional: string;
  currentHedgeIsLong: boolean;
  targetHedgeIsLong: boolean;
};

type AgentSidecarSnapshot = {
  identity: {
    userId: string;
    walletAddress: Address;
    source: string;
  };
  strategy: {
    mode: HedgeMode;
    source: string;
    warning?: string;
  };
  vault: {
    mappedUser: Address;
    position: SerializedVaultPosition;
  };
  funding: {
    averageFundingBp: number;
    observedFundingPoints: number;
    latestFundingTimestampMs: number;
  };
  borosQuote: BorosAprSnapshot;
  position: {
    positionSide: PositionSide;
    hlSize: number;
    markPrice: number;
    hedgeNotional: number;
  };
};

const PAIR = "ETHUSDC";
const HL_COIN = "ETH";
const WINDOW_HOURS = 1;
const MIN_CONFIDENCE_BP = 6000;
const DEFAULT_ENTRY_THRESHOLD_BP = 40;
const DEFAULT_EXIT_THRESHOLD_BP = 10;
const DEFAULT_BOROS_OI_FEE_BP = 10;
const DEFAULT_REBALANCE_THRESHOLD_BP = 100n;
const DEFAULT_MIN_REBALANCE_DELTA_WEI = 10_000_000_000_000_000n;
const DEFAULT_ANVIL_RPC_URL = "http://localhost:8545";
const DEFAULT_ANVIL_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const KYUTE_VAULT_ABI = [
  {
    type: "function",
    name: "syncHyperliquidPosition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "userId", type: "uint256" },
      { name: "isLong", type: "bool" },
      { name: "notional", type: "uint256" },
      { name: "leverage", type: "uint256" },
      { name: "targetHedgeNotional", type: "uint256" },
      { name: "targetHedgeIsLong", type: "bool" },
      { name: "oracleTimestamp", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "executeHedge",
    stateMutability: "nonpayable",
    inputs: [
      { name: "userId", type: "uint256" },
      { name: "shouldHedge", type: "bool" },
      { name: "yuToken", type: "address" },
      { name: "predictedApr", type: "int256" },
      { name: "confidenceBp", type: "uint256" },
      { name: "borosApr", type: "int256" },
      { name: "hedgeNotional", type: "uint256" },
      { name: "oracleTimestamp", type: "uint256" },
      { name: "proofHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "syncUserAddress",
    stateMutability: "nonpayable",
    inputs: [
      { name: "userId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "creCallbackOperator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "userIdToAddress",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "userPositions",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "asset", type: "address" },
      { name: "isLong", type: "bool" },
      { name: "notional", type: "uint256" },
      { name: "leverage", type: "uint256" },
      { name: "hasBorosHedge", type: "bool" },
      { name: "yuToken", type: "address" },
      { name: "lastUpdateTimestamp", type: "uint256" },
      { name: "targetHedgeNotional", type: "uint256" },
      { name: "currentHedgeNotional", type: "uint256" },
      { name: "currentHedgeIsLong", type: "bool" },
      { name: "targetHedgeIsLong", type: "bool" },
    ],
  },
] as const;
const HL_MAINNET_URL = "https://api.hyperliquid.xyz/info";
const HL_TESTNET_URL = "https://api.hyperliquid-testnet.xyz/info";

const resolveHlUrl = (config: Config, kind: "funding" | "position"): string => {
  const specificBaseUrl = kind === "funding" ? config.hlFundingBaseUrl : config.hlPositionBaseUrl;
  if (specificBaseUrl) return specificBaseUrl;

  const specificTestnet = kind === "funding" ? config.hlFundingTestnet : config.hlPositionTestnet;
  if (typeof specificTestnet === "boolean") {
    return specificTestnet ? HL_TESTNET_URL : HL_MAINNET_URL;
  }

  if (config.hlBaseUrl) return config.hlBaseUrl;
  return config.hlTestnet ? HL_TESTNET_URL : HL_MAINNET_URL;
};

const resolveUseMarkPrice = (config: Config): boolean => {
  if (typeof config.hedgeNotionalUseMarkPrice === "boolean") {
    return config.hedgeNotionalUseMarkPrice;
  }
  return false;
};

const readOptionalSecret = (runtime: Runtime<Config>, id: string): string | null => {
  try {
    const secret = runtime.getSecret({ id }).result();
    const value = secret.value?.trim();
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
};

const createSupabaseRestFetch = (http: HTTPClient, runtime: Runtime<Config>): SupabaseRestFetch => {
  return async (url, headers) =>
    http
      .sendRequest(runtime, fetchTextViaRequester, consensusIdenticalAggregation())(url, headers)
      .result();
};

const createRpcTextFetch = (http: HTTPClient, runtime: Runtime<Config>): RpcTextFetch => {
  return async (url, bodyText) =>
    http
      .sendRequest(runtime, fetchRpcTextViaRequester, consensusIdenticalAggregation())(url, bodyText)
      .result();
};

const buildQueryString = (query: Record<string, string | undefined>): string =>
  Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");

const deserializeVaultPosition = (
  serialized: SerializedVaultPosition,
): readonly [Address, boolean, bigint, bigint, boolean, Address, bigint, bigint, bigint, boolean, boolean] => {
  return [
    serialized.asset,
    serialized.isLong,
    BigInt(serialized.notional),
    BigInt(serialized.leverage),
    serialized.hasBorosHedge,
    serialized.yuToken,
    BigInt(serialized.lastUpdateTimestamp),
    BigInt(serialized.targetHedgeNotional),
    BigInt(serialized.currentHedgeNotional),
    serialized.currentHedgeIsLong,
    serialized.targetHedgeIsLong,
  ] as const;
};

const fetchAgentSnapshotViaSidecar = (
  requester: HTTPSendRequester,
  args: {
    baseUrl: string;
    walletAddress: Address;
    vaultAddress?: Address;
    marketKey: string;
    assetSymbol: string;
    venue: string;
    borosMarketAddress?: string;
    fallbackMode: HedgeMode;
    hlFundingUrl: string;
    hlPositionUrl: string;
    useMarkPrice: boolean;
    windowHours: number;
    borosCoreApiBaseUrl: string;
    borosMarketId: number;
    rpcUrl: string;
  },
): AgentSidecarSnapshot => {
  const query = buildQueryString({
    walletAddress: args.walletAddress,
    marketKey: args.marketKey,
    assetSymbol: args.assetSymbol,
    venue: args.venue,
    fallbackMode: args.fallbackMode,
    hlFundingUrl: args.hlFundingUrl,
    hlPositionUrl: args.hlPositionUrl,
    useMarkPrice: String(args.useMarkPrice),
    windowHours: String(args.windowHours),
    borosCoreApiBaseUrl: args.borosCoreApiBaseUrl,
    borosMarketId: String(args.borosMarketId),
    rpcUrl: args.rpcUrl,
    vaultAddress: args.vaultAddress,
    borosMarketAddress: args.borosMarketAddress,
  });

  const response = requester.sendRequest({
    url: `${args.baseUrl.replace(/\/+$/, "")}/internal/agent-snapshot?${query}`,
    method: "GET",
    headers: { accept: "application/json" },
    cacheSettings: { store: false, maxAge: "0s" },
  }).result();

  const parsed = JSON.parse(new TextDecoder().decode(response.body)) as {
    ok?: boolean;
    error?: string;
    snapshot?: AgentSidecarSnapshot;
  };
  if (!parsed.ok || !parsed.snapshot) {
    throw new Error(parsed.error ?? "Agent sidecar snapshot request failed");
  }
  return parsed.snapshot;
};

const executeDecisionViaSidecar = (
  requester: HTTPSendRequester,
  args: {
    baseUrl: string;
    payload: Record<string, unknown>;
  },
): { ok: boolean; syncTxHash?: string | null; executeTxHash?: string | null } => {
  const response = requester.sendRequest({
    url: `${args.baseUrl.replace(/\/+$/, "")}/internal/execute-hedge`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: Buffer.from(JSON.stringify(args.payload)).toString("base64"),
    cacheSettings: { store: false, maxAge: "0s" },
  }).result();

  const parsed = JSON.parse(new TextDecoder().decode(response.body)) as {
    ok?: boolean;
    error?: string;
    syncTxHash?: string | null;
    executeTxHash?: string | null;
  };
  if (!parsed.ok) {
    throw new Error(parsed.error ?? "Agent sidecar execute request failed");
  }
  return { ok: true, syncTxHash: parsed.syncTxHash, executeTxHash: parsed.executeTxHash };
};

const resolveAgentIdentity = async (params: {
  config: Config;
  vaultAddress?: Address;
  supabaseUrl?: string;
  supabaseKey?: string;
  supabaseFetch?: SupabaseRestFetch;
  logger?: (message: string) => void;
}): Promise<{ userId: bigint; walletAddress: Address; source: string }> => {
  const configuredWallet =
    params.config.hlAddress && /^0x[0-9a-fA-F]{40}$/.test(params.config.hlAddress)
      ? (params.config.hlAddress as Address)
      : null;

  const identity = await resolveRequiredWalletIdentity({
    walletAddress: configuredWallet,
    vaultAddress: params.vaultAddress,
    supabaseUrl: params.supabaseUrl,
    supabaseKey: params.supabaseKey,
    supabaseFetch: params.supabaseFetch,
    logger: params.logger,
  });

  return {
    userId: BigInt(identity.record.userId),
    walletAddress: identity.record.walletAddress,
    source: identity.source,
  };
};

const fetchPredictedFundingBp = (
  requester: HTTPSendRequester,
  coin: string,
  baseUrl: string,
): number => {
  const payload = JSON.stringify({ type: "predictedFundings" });
  const response = requester.sendRequest({
    url: baseUrl,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: Buffer.from(payload).toString("base64"),
    cacheSettings: {
      store: true,
      maxAge: "30s",
    },
  }).result();

  const jsonStr = new TextDecoder().decode(response.body);
  const data = JSON.parse(jsonStr) as any[];
  const coinData = data.find((item: any) => Array.isArray(item) && item[0] === coin);
  if (!coinData) return 0;

  const venues = coinData[1] as any[];
  const hlPerpEntry = venues.find((v: any) => Array.isArray(v) && v[0] === "HlPerp");
  if (!hlPerpEntry) return 0;

  const fundingRate = Number(hlPerpEntry[1]?.fundingRate ?? hlPerpEntry[1]?.funding ?? 0);
  if (!Number.isFinite(fundingRate)) return 0;
  // fundingRate is per-hour; annualize to bp
  return Math.round(fundingRate * 24 * 365 * 10_000);
};

const fetchAverageFundingBp = (
  requester: HTTPSendRequester,
  baseUrl: string,
  windowHours: number,
): { averageFundingBp: number; observedFundingPoints: number; latestFundingTimestampMs: number } => {
  const startTime = Date.now() - windowHours * 60 * 60 * 1000;
  const payload = JSON.stringify({
    type: "fundingHistory",
    coin: HL_COIN,
    startTime,
  });

  const response = requester.sendRequest({
    url: baseUrl,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: Buffer.from(payload).toString("base64"),
    cacheSettings: {
      store: true,
      maxAge: "30s",
    },
  }).result();

  const jsonStr = new TextDecoder().decode(response.body);
  const data = JSON.parse(jsonStr) as FundingHistoryEntry[];

  const points = data
    .map((entry) => ({
      rate: Number(entry.fundingRate ?? entry.funding ?? entry.rate ?? NaN),
      timestampMs: Number(entry.time ?? entry.timestamp ?? entry.t ?? Date.now()),
    }))
    .filter((point) => Number.isFinite(point.rate));

  const rates = points.map((point) => point.rate);
  const latestFundingTimestampMs = points.reduce(
    (latest, point) => (point.timestampMs > latest ? point.timestampMs : latest),
    Date.now(),
  );

  if (rates.length === 0) {
    const fallbackBp = fetchPredictedFundingBp(requester, HL_COIN, baseUrl);
    return {
      averageFundingBp: fallbackBp,
      observedFundingPoints: 0,
      latestFundingTimestampMs: Date.now(),
    };
  }

  const averageRate = rates.reduce((sum, value) => sum + value, 0) / rates.length;
  // fundingRate entries are per-hour; annualize to bp
  return {
    averageFundingBp: Math.round(averageRate * 24 * 365 * 10_000),
    observedFundingPoints: rates.length,
    latestFundingTimestampMs,
  };
};

const fetchHlPositionSnapshot = (
  requester: HTTPSendRequester,
  baseUrl: string,
  userAddress: string,
  useMarkPrice: boolean,
): { positionSide: PositionSide; hlSize: number; markPrice: number; hedgeNotional: number } => {
  const payloadMeta = JSON.stringify({ type: "metaAndAssetCtxs" });
  const payloadState = JSON.stringify({ type: "clearinghouseState", user: userAddress });

  const [metaRes, stateRes] = [
    requester.sendRequest({
      url: baseUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(payloadMeta).toString("base64"),
      cacheSettings: { store: true, maxAge: "30s" },
    }).result(),
    requester.sendRequest({
      url: baseUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(payloadState).toString("base64"),
      cacheSettings: { store: true, maxAge: "15s" },
    }).result(),
  ];

  const [meta, contexts] = JSON.parse(new TextDecoder().decode(metaRes.body)) as HyperliquidMetaAndCtxs;
  const state = JSON.parse(new TextDecoder().decode(stateRes.body)) as {
    assetPositions?: Array<{ position?: Record<string, unknown> }>;
  };

  const ethIndex = meta.universe.findIndex((entry) => entry.name === HL_COIN);
  if (ethIndex < 0) throw new Error(`Unable to locate ${HL_COIN} in Hyperliquid universe`);

  const markPxRaw = contexts[ethIndex]?.markPx ?? contexts[ethIndex]?.midPx;
  const markPrice = Number(markPxRaw ?? 0);
  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    throw new Error(`Invalid mark price for ${PAIR}: ${String(markPxRaw)}`);
  }

  const positionEntry = (state.assetPositions ?? []).find((entry) => {
    const coin = String(entry.position?.coin ?? "");
    return coin.toUpperCase() === HL_COIN;
  });

  const signedSize = Number(positionEntry?.position?.szi ?? 0);
  const positionSide: PositionSide = signedSize < 0 ? "short" : "long";
  const hlSize = Math.abs(signedSize);
  const hedgeNotional = useMarkPrice ? hlSize * markPrice : hlSize;

  return { positionSide, hlSize, markPrice, hedgeNotional };
};

const fetchLiveInputSnapshot = (
  requester: HTTPSendRequester,
  args: {
    hlFundingUrl: string;
    hlPositionUrl: string;
    windowHours: number;
    userAddress: string;
    useMarkPrice: boolean;
    borosCoreApiBaseUrl: string;
    borosMarketId: number;
  },
): {
  funding: { averageFundingBp: number; observedFundingPoints: number; latestFundingTimestampMs: number };
  borosQuote: BorosAprSnapshot;
  position: { positionSide: PositionSide; hlSize: number; markPrice: number; hedgeNotional: number };
} => {
  const funding = fetchAverageFundingBp(requester, args.hlFundingUrl, args.windowHours);
  const borosQuote = fetchBorosAprSnapshot(requester, args.borosCoreApiBaseUrl, args.borosMarketId);
  const position = fetchHlPositionSnapshot(
    requester,
    args.hlPositionUrl,
    args.userAddress,
    args.useMarkPrice,
  );

  return { funding, borosQuote, position };
};

const resolveExecutionOutcome = (args: {
  action: "OPEN_HEDGE" | "CLOSE_HEDGE" | "SKIP";
  shouldHedge: boolean;
  executeOnchain: boolean;
  directExecuteSucceeded: boolean;
  reportWriteSucceeded: boolean;
}): string => {
  if (args.action === "SKIP") {
    return args.shouldHedge ? "HEDGE_ALREADY_IN_SYNC" : "HEDGE_NOT_REQUIRED";
  }

  const actionLabel = args.action === "OPEN_HEDGE" ? "OPEN" : "CLOSE";
  if (!args.executeOnchain) {
    return `HEDGE_${actionLabel}_PLANNED`;
  }
  if (args.directExecuteSucceeded) {
    return `HEDGE_${actionLabel}_EXECUTED`;
  }
  if (args.reportWriteSucceeded) {
    return `HEDGE_${actionLabel}_REPORTED`;
  }
  return `HEDGE_${actionLabel}_FAILED`;
};

const onCronTrigger = async (runtime: Runtime<Config>) => {
  try {
    const http = new HTTPClient();
    const config = runtime.config;
    runtime.log("kyute-agent cron trigger entered");
    const supabaseUrl = config.supabaseUrl?.trim() || undefined;
    const supabaseKey = readOptionalSecret(runtime, "SUPABASE_KEY") ?? undefined;
    const supabaseFetch = createSupabaseRestFetch(http, runtime);
    const rpcFetch = createRpcTextFetch(http, runtime);
    const entryThresholdBp = config.entryThresholdBp ?? config.thresholdBp ?? DEFAULT_ENTRY_THRESHOLD_BP;
    const exitThresholdBp = config.exitThresholdBp ?? DEFAULT_EXIT_THRESHOLD_BP;
    const windowHours = config.windowHours ?? WINDOW_HOURS;
    const configuredHedgeMode = config.hedgeMode ?? "adverse_only";
    const borosOiFeeBp = config.borosOiFeeBp ?? DEFAULT_BOROS_OI_FEE_BP;
    const useMarkPrice = resolveUseMarkPrice(config);
    const hlFundingUrl = resolveHlUrl(config, "funding");
    const hlPositionUrl = resolveHlUrl(config, "position");
    const yuToken = (config.yuToken ?? "0x0000000000000000000000000000000000000001") as `0x${string}`;
    const executeOnchain = config.executeOnchain ?? false;
    const enableReportWrite = config.enableReportWrite ?? false;
    const rpcUrl = config.rpcUrl ?? DEFAULT_ANVIL_RPC_URL;
    const vaultAddress = config.vaultAddress as `0x${string}`;
    const agentSidecarUrl = config.agentSidecarUrl?.trim() || undefined;
    const marketKey = `${HL_COIN.toLowerCase()}:hlperp:${String(config.borosMarketAddress ?? "").toLowerCase() || "default"}`;
    const borosMarketId = Number.isFinite(config.borosMarketId)
      ? Math.max(1, Math.floor(config.borosMarketId as number))
      : DEFAULT_BOROS_MARKET_ID;
    const borosCoreApiBaseUrl =
      config.borosCoreApiUrl?.trim() || DEFAULT_BOROS_CORE_API_BASE_URL;

    const hasVaultAddress =
      /^0x[0-9a-fA-F]{40}$/.test(vaultAddress) &&
      vaultAddress !== "0x0000000000000000000000000000000000000000";
    let userId: bigint;
    let hlWallet: { address: Address; source: string };
    let mappedUser = ZERO_ADDRESS;
    let positionState: readonly [Address, boolean, bigint, bigint, boolean, Address, bigint, bigint, bigint, boolean, boolean] | null =
      null;
    let hedgeMode: HedgeMode;
    let funding: { averageFundingBp: number; observedFundingPoints: number; latestFundingTimestampMs: number };
    let borosQuote: BorosAprSnapshot;
    let position: { positionSide: PositionSide; hlSize: number; markPrice: number; hedgeNotional: number };

    if (agentSidecarUrl) {
      runtime.log(`Using agent sidecar ${agentSidecarUrl}`);
      const snapshot = await http
        .sendRequest(runtime, fetchAgentSnapshotViaSidecar, consensusIdenticalAggregation())({
          baseUrl: agentSidecarUrl,
          walletAddress: (config.hlAddress ?? ZERO_ADDRESS) as Address,
          vaultAddress: hasVaultAddress ? vaultAddress : undefined,
          marketKey,
          assetSymbol: HL_COIN,
          venue: "HlPerp",
          borosMarketAddress: config.borosMarketAddress,
          fallbackMode: configuredHedgeMode,
          hlFundingUrl,
          hlPositionUrl,
          useMarkPrice,
          windowHours,
          borosCoreApiBaseUrl,
          borosMarketId,
          rpcUrl,
        })
        .result();

      userId = BigInt(snapshot.identity.userId);
      hlWallet = { address: snapshot.identity.walletAddress, source: snapshot.identity.source };
      mappedUser = snapshot.vault.mappedUser;
      positionState = deserializeVaultPosition(snapshot.vault.position);
      hedgeMode = snapshot.strategy.mode;
      funding = snapshot.funding;
      borosQuote = snapshot.borosQuote;
      position = snapshot.position;

      runtime.log(`Resolved identity source=${hlWallet.source} userId=${userId} wallet=${hlWallet.address}`);
      runtime.log(`Using strategy mode ${hedgeMode} from ${snapshot.strategy.source}`);
      if (snapshot.strategy.warning) {
        runtime.log(`Strategy mode warning: ${snapshot.strategy.warning}`);
      }
      runtime.log(`Decoded mapped user address=${mappedUser}`);
      runtime.log(
        `Fetched live inputs fundingBp=${funding.averageFundingBp} borosMarketId=${borosQuote.marketId} hlSize=${position.hlSize.toFixed(6)} side=${position.positionSide}`,
      );
    } else {
      runtime.log(
        `Identity config supabaseUrl=${supabaseUrl ?? "<missing>"} supabaseKeyPresent=${supabaseKey ? "true" : "false"} configuredWallet=${
          config.hlAddress ?? "<missing>"
        }`,
      );
      const identity = await resolveAgentIdentity({
        config,
        vaultAddress: hasVaultAddress ? vaultAddress : undefined,
        supabaseUrl,
        supabaseKey,
        supabaseFetch,
        logger: (message) => runtime.log(message),
      });
      userId = identity.userId;
      hlWallet = { address: identity.walletAddress, source: identity.source };
      runtime.log(`Resolved identity source=${identity.source} userId=${userId} wallet=${identity.walletAddress}`);
      if (hasVaultAddress) {
        runtime.log("Reading vault mapping and user position via batched raw eth_call");
        const vaultSnapshot = await readVaultMappingAndPosition({
          rpcUrl,
          vaultAddress,
          userId,
          userAddress: identity.walletAddress,
          rpcFetch,
        });
        runtime.log(`Vault mapping batch raw result=${vaultSnapshot.mappingRawResult}`);
        runtime.log(`Decoded mapped user address=${vaultSnapshot.mappedAddress}`);
        runtime.log(`Vault userPositions batch raw result=${vaultSnapshot.positionRawResult}`);
        mappedUser = vaultSnapshot.mappedAddress;
        positionState = vaultSnapshot.position;
      }

      const strategyMode = await resolveUserHedgeMode({
        userId,
        walletAddress: hlWallet.address,
        vaultAddress: hasVaultAddress ? vaultAddress : undefined,
        marketKey,
        assetSymbol: HL_COIN,
        venue: "HlPerp",
        borosMarketAddress: config.borosMarketAddress,
        fallbackMode: configuredHedgeMode,
        logger: (message) => runtime.log(message),
        supabaseUrl,
        supabaseKey,
        supabaseFetch,
      });
      hedgeMode = strategyMode.mode;
      runtime.log(`Using strategy mode ${hedgeMode} from ${strategyMode.source}`);
      if (strategyMode.warning) {
        runtime.log(`Strategy mode warning: ${strategyMode.warning}`);
      }

      const liveInputs = await http
        .sendRequest(runtime, fetchLiveInputSnapshot, consensusIdenticalAggregation())({
          hlFundingUrl,
          hlPositionUrl,
          windowHours,
          userAddress: hlWallet.address,
          useMarkPrice,
          borosCoreApiBaseUrl,
          borosMarketId,
        })
        .result();
      funding = liveInputs.funding;
      borosQuote = liveInputs.borosQuote;
      position = liveInputs.position;
      runtime.log(
        `Fetched live inputs fundingBp=${funding.averageFundingBp} borosMarketId=${borosQuote.marketId} hlSize=${position.hlSize.toFixed(6)} side=${position.positionSide}`,
      );
    }
    const signerPk = config.callbackPrivateKey ?? DEFAULT_ANVIL_PRIVATE_KEY;
    const canUseDirectSigner = executeOnchain && hasVaultAddress && /^0x[0-9a-fA-F]{64}$/.test(signerPk);
    const directAccount = canUseDirectSigner ? privateKeyToAccount(signerPk as `0x${string}`) : null;
    if (hasVaultAddress && mappedUser === ZERO_ADDRESS) {
      throw new Error(
        `Vault mapping missing; run syncUserAddress during enrollment. userId=${userId} wallet=${hlWallet.address} vault=${vaultAddress}`,
      );
    } else if (hasVaultAddress && mappedUser.toLowerCase() !== hlWallet.address.toLowerCase()) {
      throw new Error(
        `Vault mapping mismatch for userId=${userId}: onchain=${mappedUser} supabase=${hlWallet.address}`,
      );
    }
    const hasMappedUser = mappedUser !== "0x0000000000000000000000000000000000000000";
    if (hlFundingUrl !== hlPositionUrl) {
      runtime.log(`Using separate HL endpoints fundingUrl=${hlFundingUrl} positionUrl=${hlPositionUrl}`);
    }
  const oracleTimestamp = resolveFreshOracleTimestamp(funding.latestFundingTimestampMs);
  if (borosQuote.apr === null) {
    throw new Error(`Boros APR missing for marketId=${borosQuote.marketId} field=${borosQuote.field}`);
  }
  const borosApr = borosQuote.apr;
  const borosAprBp = Math.round(borosApr * 10_000);
  if (oracleTimestamp.source !== "latest_point") {
    runtime.log(
      `Oracle timestamp source=${oracleTimestamp.source} latestPointSec=${oracleTimestamp.latestPointSec ?? "none"} usingCurrentSec=${oracleTimestamp.oracleTimestampSec}`,
    );
  }
  const confidenceBp = 10_000;
  const livePositionNotionalWei = parseEther(position.hedgeNotional.toFixed(18));
  const decision = computeHedgePolicy({
    positionSide: position.positionSide,
    averageFundingBp: funding.averageFundingBp,
    borosImpliedAprBp: borosAprBp,
    confidenceBp,
    hasExistingHedge: Boolean(positionState?.[4]),
    existingHedgeIsLong: Boolean(positionState?.[9]),
    entryThresholdBp,
    exitThresholdBp,
    minConfidenceBp: MIN_CONFIDENCE_BP,
    oiFeeBp: borosOiFeeBp,
    mode: hedgeMode,
  });
  const predictedAprBp = Math.round(decision.carrySourceAprBp);
  const contractBorosAprBp = Math.round(decision.carryCostAprBp);
  const executionPlan = buildHedgeExecutionPlan({
    decision,
    proposedTargetHedgeNotionalWei: livePositionNotionalWei,
    currentHedgeWei: positionState?.[8] ?? 0n,
    hasExistingHedge: Boolean(positionState?.[4]),
    currentHedgeIsLong: Boolean(positionState?.[9]),
    rebalanceThresholdBp: DEFAULT_REBALANCE_THRESHOLD_BP,
    minRebalanceDeltaWei: DEFAULT_MIN_REBALANCE_DELTA_WEI,
  });
  const shouldHedge = executionPlan.shouldHedge;
  const targetHedgeIsLong = executionPlan.targetHedgeIsLong;
  const targetHedgeNotionalWei = executionPlan.targetHedgeNotionalWei;
  runtime.log(
    `Decision summary mode=${hedgeMode} exposure=${decision.exposure} edgeBp=${decision.edgeBp} shouldHedge=${shouldHedge} targetHedgeIsLong=${targetHedgeIsLong} targetWei=${targetHedgeNotionalWei} action=${executionPlan.action}`,
  );

  runtime.log(
    `Boros APR: ${(borosApr * 100).toFixed(2)}% marketId=${borosQuote.marketId} field=${borosQuote.field} midApr=${borosQuote.midApr ?? "null"} lastTradedApr=${borosQuote.lastTradedApr ?? "null"} floatingApr=${borosQuote.floatingApr ?? "null"} state=${borosQuote.state ?? "unknown"} market=${config.borosMarketAddress ?? "n/a"}`,
  );
  runtime.log(`HL 1h avg funding (annualized): ${funding.averageFundingBp} bp`);
  runtime.log(
    `HL wallet=${hlWallet.address} source=${hlWallet.source} side=${position.positionSide}, size=${position.hlSize.toFixed(6)} ETH, mark=${position.markPrice.toFixed(4)}, ` +
    `hedgeNotional=${position.hedgeNotional.toFixed(6)} useMark=${useMarkPrice} exposure=${decision.exposure} edge=${decision.edgeBp}bp targetHedgeIsLong=${targetHedgeIsLong}`,
  );

  const proofPayload = JSON.stringify({
    type: "kYUteMvpNodeModeProof",
    version: 2,
    generatedAt: new Date().toISOString(),
    chainId: 0,
    userId: userId.toString(),
    pair: PAIR,
    vaultAddress,
    yuToken,
    inputs: {
      windowHours,
      thresholdBp: entryThresholdBp,
      averageFundingBp: funding.averageFundingBp,
      positionSide: position.positionSide,
      hlSize: position.hlSize,
      markPrice: position.markPrice,
      hedgeNotional: position.hedgeNotional,
      borosAprBp,
      observedFundingPoints: funding.observedFundingPoints,
    },
    outputs: {
      predictedAprBp,
      confidenceBp,
      shouldHedge,
      targetHedgeIsLong,
      exposure: decision.exposure,
      edgeBp: decision.edgeBp,
    },
  });
  const proofHash = keccak256(toBytes(proofPayload));

  const reportBytes = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "bool" },
      { type: "address" },
      { type: "int256" },
      { type: "uint256" },
      { type: "int256" },
      { type: "uint8" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes32" }
    ],
    [
      userId,
      shouldHedge,
      yuToken,
      BigInt(predictedAprBp),
      BigInt(confidenceBp),
      BigInt(contractBorosAprBp),
      targetHedgeIsLong ? 1 : 2,
      livePositionNotionalWei,
      oracleTimestamp.oracleTimestampSec,
      proofHash
    ],
  )

  if (executeOnchain) {
    let directExecuteSucceeded = false;
    let reportWriteSucceeded = false;

    if (!executionPlan.executeNeeded) {
      runtime.log(`No vault execution needed; action=${executionPlan.action}`);
    } else if (agentSidecarUrl) {
      try {
        runtime.log(`Submitting execute via agent sidecar ${agentSidecarUrl}`);
        const sidecarExecute = await http
          .sendRequest(runtime, executeDecisionViaSidecar, consensusIdenticalAggregation())({
            baseUrl: agentSidecarUrl,
            payload: {
              vaultAddress,
              userId: userId.toString(),
              walletAddress: hlWallet.address,
              yuToken,
              predictedAprBp: String(predictedAprBp),
              confidenceBp: String(confidenceBp),
              contractBorosAprBp: String(contractBorosAprBp),
              targetHedgeNotionalWei: targetHedgeNotionalWei.toString(),
              oracleTimestampSec: oracleTimestamp.oracleTimestampSec.toString(),
              proofHash,
              livePositionNotionalWei: livePositionNotionalWei.toString(),
              positionSide: position.positionSide,
              targetHedgeIsLong,
              shouldHedge,
              rpcUrl,
            },
          })
          .result();
        runtime.log(
          `Agent sidecar execute completed syncTx=${sidecarExecute.syncTxHash ?? "none"} executeTx=${sidecarExecute.executeTxHash ?? "none"}`,
        );
        directExecuteSucceeded = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtime.log(`Agent sidecar execute failed (${message})`);
      }
    }

    if (!directExecuteSucceeded && executionPlan.executeNeeded && directAccount && hasVaultAddress && !agentSidecarUrl) {
      try {
        runtime.log(`Submitting direct executeHedge to vault=${vaultAddress} via rpc=${rpcUrl}`);
        runtime.log("Re-reading vault creCallbackOperator before execute via raw eth_call");
        const { rawResult: executeOperatorRawResult, address: registeredOperator } =
          await readCreCallbackOperator({
            rpcUrl,
            vaultAddress,
            rpcFetch,
          });
        runtime.log(`Execute-path creCallbackOperator raw result=${executeOperatorRawResult}`);
        runtime.log(`Execute-path decoded creCallbackOperator=${registeredOperator}`);
        if (registeredOperator.toLowerCase() !== directAccount.address.toLowerCase()) {
          throw new Error(
            `Callback signer ${directAccount.address} does not match vault creCallbackOperator ${registeredOperator}`,
          );
        }
        if (!hasMappedUser || positionState == null) {
          throw new Error(`userId=${userId} is not mapped in vault ${vaultAddress}`);
        }

        const leverageForSync = positionState[3] > 0n ? positionState[3] : 1n;
        const syncNeeded =
          (positionState[0] === "0x0000000000000000000000000000000000000000" && livePositionNotionalWei > 0n) ||
          (
            positionState[0] !== "0x0000000000000000000000000000000000000000" &&
            (
              Boolean(positionState[1]) !== (position.positionSide === "long") ||
              positionState[2] !== livePositionNotionalWei ||
              positionState[7] !== targetHedgeNotionalWei ||
              Boolean(positionState[10]) !== targetHedgeIsLong
            )
          );
        if (syncNeeded) {
          const syncData = encodeFunctionData({
            abi: KYUTE_VAULT_ABI,
            functionName: "syncHyperliquidPosition",
            args: [
              userId,
              position.positionSide === "long",
              livePositionNotionalWei,
              leverageForSync,
              targetHedgeNotionalWei,
              targetHedgeIsLong,
              oracleTimestamp.oracleTimestampSec,
            ],
          });
          const syncTxHash = await sendSignedTransaction({
            rpcUrl,
            account: directAccount,
            to: vaultAddress,
            data: syncData,
            rpcFetch,
          });
          const syncReceipt = await waitForTransactionReceipt({
            rpcUrl,
            txHash: syncTxHash,
            rpcFetch,
          });
          if (syncReceipt.status !== "success") {
            throw new Error(`syncHyperliquidPosition failed tx=${syncTxHash}`);
          }
          runtime.log(`Direct syncHyperliquidPosition tx confirmed: ${syncTxHash}`);
        }

        const data = encodeFunctionData({
          abi: KYUTE_VAULT_ABI,
          functionName: "executeHedge",
          args: [
            userId,
            shouldHedge,
            yuToken,
            BigInt(predictedAprBp),
            BigInt(confidenceBp),
            BigInt(contractBorosAprBp),
            targetHedgeNotionalWei,
            oracleTimestamp.oracleTimestampSec,
            proofHash,
          ],
        });

        const txHash = await sendSignedTransaction({
          rpcUrl,
          account: directAccount,
          to: vaultAddress,
          data,
          rpcFetch,
        });
        runtime.log(`Direct executeHedge tx submitted: ${txHash}`);
        directExecuteSucceeded = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtime.log(`Direct executeHedge failed (${message})`);
      }
    }

    if (!enableReportWrite) {
      if (agentSidecarUrl) {
        runtime.log("CRE report write disabled in demo mode; sidecar execute path only.");
      } else {
        runtime.log("CRE report write disabled in demo mode; direct execute path only.");
      }
    } else {
      if (!directExecuteSucceeded) {
        runtime.log("Direct execute failed; attempting CRE report write fallback.");
      } else {
        runtime.log("Direct execute succeeded; also emitting CRE report because enableReportWrite=true.");
      }

      const signedReport = runtime.report({
        encodedPayload: hexToBase64(reportBytes),
        encoderName: "evm",
        signingAlgo: "ecdsa",
        hashingAlgo: "keccak256",
      }).result();

      const evmClient = new EVMClient(4949039107694359620n);
      const receiver = new Uint8Array(Buffer.from(vaultAddress.slice(2), "hex"));

      if (hasVaultAddress) {
        evmClient.writeReport(runtime, {
          $report: true,
          receiver,
          report: signedReport,
        }).result();
        reportWriteSucceeded = true;
      }
    }

    if (executionPlan.executeNeeded && !directExecuteSucceeded && !reportWriteSucceeded) {
      throw new Error(`Hedge execution required but no write path succeeded (action=${executionPlan.action})`);
    }

    const executionOutcome = resolveExecutionOutcome({
      action: executionPlan.action,
      shouldHedge,
      executeOnchain,
      directExecuteSucceeded,
      reportWriteSucceeded,
    });
    runtime.log(`Hedge Execution Outcome: ${executionOutcome}`);
    runtime.log(`Hedge Decision Computed: ${shouldHedge}`);
    return executionOutcome;
  } else {
    runtime.log(`Onchain execution disabled; report payload bytes=${reportBytes.length}`);
    const executionOutcome = resolveExecutionOutcome({
      action: executionPlan.action,
      shouldHedge,
      executeOnchain,
      directExecuteSucceeded: false,
      reportWriteSucceeded: false,
    });
    runtime.log(`Hedge Execution Outcome: ${executionOutcome}`);
    runtime.log(`Hedge Decision Computed: ${shouldHedge}`);
    return executionOutcome;
  }
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    runtime.log(`kyute-agent failure: ${message}`);
    throw error;
  }
};

const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({
    configParser: (raw) => JSON.parse(new TextDecoder().decode(raw)) as Config,
  });
  await runner.run(initWorkflow);
}
