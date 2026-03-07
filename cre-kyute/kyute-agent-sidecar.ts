import dotenv from "dotenv";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { HedgeMode, PositionSide } from "./hedge-policy.js";
import {
  DEFAULT_BOROS_CORE_API_BASE_URL,
  DEFAULT_BOROS_MARKET_ID,
  type BorosAprSnapshot,
} from "./boros-core-api.js";
import { resolveUserHedgeMode } from "./strategy-config.js";
import { resolveRequiredWalletIdentity } from "./wallet-bridge.js";

dotenv.config({ path: path.resolve(import.meta.dir, "../.env"), quiet: true });
dotenv.config({ path: path.resolve(import.meta.dir, "../contracts/.env"), quiet: true });

const PORT = Number(process.env.KYUTE_AGENT_SIDECAR_PORT ?? 8791);
const HOST = process.env.KYUTE_AGENT_SIDECAR_HOST?.trim() || "127.0.0.1";
const DEFAULT_RPC_URL = process.env.ANVIL_RPC_URL?.trim() || "http://127.0.0.1:8545";
const DEFAULT_YU_TOKEN = "0x0000000000000000000000000000000000000001";
const DEFAULT_CALLBACK_PRIVATE_KEY =
  (process.env.CRE_SIM_PRIVATE_KEY?.trim() ||
    process.env.ANVIL_PRIVATE_KEY?.trim() ||
    process.env.PRIVATE_KEY?.trim() ||
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d") as `0x${string}`;
const DEFAULT_HL_COIN = "ETH";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const DEFAULT_ETH_YU_TOKEN = "0x0000000000000000000000000000000000000001" as const;
const DEFAULT_BTC_YU_TOKEN = "0x0000000000000000000000000000000000000002" as const;

const KYUTE_VAULT_ABI = [
  {
    type: "function",
    name: "syncHyperliquidPositionForMarket",
    stateMutability: "nonpayable",
    inputs: [
      { name: "userId", type: "uint256" },
      { name: "yuToken", type: "address" },
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
    name: "userIdToAddress",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
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
    name: "userMarketPositions",
    stateMutability: "view",
    inputs: [
      { name: "", type: "address" },
      { name: "", type: "address" },
    ],
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

const getDefaultYuTokenForCoin = (coin: string): Address => {
  switch (coin.toUpperCase()) {
    case "BTC":
      return DEFAULT_BTC_YU_TOKEN;
    case "ETH":
    default:
      return DEFAULT_ETH_YU_TOKEN;
  }
};

type HyperliquidMetaAndCtxs = [
  { universe: Array<{ name: string }> },
  Array<{ markPx?: string; midPx?: string }>,
];

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

type AgentSnapshotPayload = {
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

type ExecuteHedgePayload = {
  vaultAddress: Address;
  userId: string;
  walletAddress: Address;
  yuToken: Address;
  predictedAprBp: string;
  confidenceBp: string;
  contractBorosAprBp: string;
  targetHedgeNotionalWei: string;
  oracleTimestampSec: string;
  proofHash: `0x${string}`;
  livePositionNotionalWei: string;
  positionSide: PositionSide;
  targetHedgeIsLong: boolean;
  shouldHedge: boolean;
  rpcUrl?: string;
  callbackPrivateKey?: `0x${string}`;
};

const json = (body: unknown, init?: ResponseInit) =>
  Response.json(body, {
    headers: {
      "cache-control": "no-store",
    },
    ...init,
  });

const fail = (status: number, message: string) => json({ ok: false, error: message }, { status });

const getRequiredAddress = (value: string | null, name: string): Address => {
  if (!value || !isAddress(value)) throw new Error(`Missing or invalid ${name}`);
  return value as Address;
};

const getOptionalAddress = (value: string | null): Address | undefined => {
  if (!value) return undefined;
  if (!isAddress(value)) throw new Error(`Invalid address: ${value}`);
  return value as Address;
};

const getOptionalString = (value: string | null): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const getBoolean = (value: string | null, fallback = false): boolean => {
  if (!value) return fallback;
  return value === "true";
};

const getNumber = (value: string | null, fallback: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const getHedgeMode = (value: string | null): HedgeMode =>
  value === "lock_fixed" ? "lock_fixed" : "adverse_only";

const postJson = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
};

const normalizeAprDecimal = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 3 ? numeric / 100 : numeric;
};

const fetchPredictedFundingBpNative = async (coin: string, baseUrl: string): Promise<number> => {
  const data = await postJson<any[]>(baseUrl, { type: "predictedFundings" });
  const coinData = data.find((item) => Array.isArray(item) && item[0] === coin);
  if (!coinData) return 0;
  const venues = coinData[1] as any[];
  const hlPerpEntry = venues.find((entry) => Array.isArray(entry) && entry[0] === "HlPerp");
  if (!hlPerpEntry) return 0;
  const fundingRate = Number(hlPerpEntry[1]?.fundingRate ?? hlPerpEntry[1]?.funding ?? 0);
  if (!Number.isFinite(fundingRate)) return 0;
  return Math.round(fundingRate * 24 * 365 * 10_000);
};

const fetchAverageFundingBpNative = async (baseUrl: string, windowHours: number, coin: string) => {
  const startTime = Date.now() - windowHours * 60 * 60 * 1000;
  const data = await postJson<FundingHistoryEntry[]>(baseUrl, {
    type: "fundingHistory",
    coin,
    startTime,
  });

  const points = (data ?? [])
    .map((entry) => ({
      rate: Number(entry.fundingRate ?? entry.funding ?? entry.rate ?? NaN),
      timestampMs: Number(entry.time ?? entry.timestamp ?? entry.t ?? Date.now()),
    }))
    .filter((point) => Number.isFinite(point.rate));

  if (points.length === 0) {
    return {
      averageFundingBp: await fetchPredictedFundingBpNative(coin, baseUrl),
      observedFundingPoints: 0,
      latestFundingTimestampMs: Date.now(),
    };
  }

  const averageRate = points.reduce((sum, point) => sum + point.rate, 0) / points.length;
  const latestFundingTimestampMs = points.reduce(
    (latest, point) => (point.timestampMs > latest ? point.timestampMs : latest),
    Date.now(),
  );

  return {
    averageFundingBp: Math.round(averageRate * 24 * 365 * 10_000),
    observedFundingPoints: points.length,
    latestFundingTimestampMs,
  };
};

const fetchHlPositionSnapshotNative = async (
  baseUrl: string,
  userAddress: string,
  coin: string,
  useMarkPrice: boolean,
) => {
  const [metaAndCtxs, state] = await Promise.all([
    postJson<HyperliquidMetaAndCtxs>(baseUrl, { type: "metaAndAssetCtxs" }),
    postJson<{ assetPositions?: Array<{ position?: Record<string, unknown> }> }>(baseUrl, {
      type: "clearinghouseState",
      user: userAddress,
    }),
  ]);

  const [meta, contexts] = metaAndCtxs;
  const pair = `${coin}USDC`;
  const coinIndex = meta.universe.findIndex((entry) => entry.name === coin);
  if (coinIndex < 0) throw new Error(`Unable to locate ${coin} in Hyperliquid universe`);

  const markPxRaw = contexts[coinIndex]?.markPx ?? contexts[coinIndex]?.midPx;
  const markPrice = Number(markPxRaw ?? 0);
  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    throw new Error(`Invalid mark price for ${pair}: ${String(markPxRaw)}`);
  }

  const positionEntry = (state.assetPositions ?? []).find((entry) => {
    const coinSymbol = String(entry.position?.coin ?? "");
    return coinSymbol.toUpperCase() === coin.toUpperCase();
  });

  const signedSize = Number(positionEntry?.position?.szi ?? 0);
  const hlSize = Math.abs(signedSize);
  const positionSide: PositionSide = signedSize < 0 ? "short" : "long";
  const hedgeNotional = useMarkPrice ? hlSize * markPrice : hlSize;

  return { positionSide, hlSize, markPrice, hedgeNotional };
};

const fetchBorosAprSnapshotNative = async (
  baseUrl: string,
  marketId: number,
): Promise<BorosAprSnapshot> => {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const url = /\/markets\/\d+$/.test(trimmed) ? trimmed : `${trimmed}/markets/${marketId}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Boros APR fetch failed: ${response.status}`);
  }

  const json = (await response.json()) as {
    state?: string;
    data?: {
      markApr?: number | string | null;
      midApr?: number | string | null;
      lastTradedApr?: number | string | null;
      floatingApr?: number | string | null;
    };
  };
  const data = json?.data ?? {};

  return {
    marketId,
    apr: normalizeAprDecimal(data.markApr),
    field: "markApr",
    midApr: normalizeAprDecimal(data.midApr),
    lastTradedApr: normalizeAprDecimal(data.lastTradedApr),
    floatingApr: normalizeAprDecimal(data.floatingApr),
    state: json.state,
    source: "boros-core-api",
    asOf: Math.floor(Date.now() / 1000) * 1000,
  };
};

const emptyPosition = (): SerializedVaultPosition => ({
  asset: ZERO_ADDRESS,
  isLong: false,
  notional: "0",
  leverage: "0",
  hasBorosHedge: false,
  yuToken: ZERO_ADDRESS,
  lastUpdateTimestamp: "0",
  targetHedgeNotional: "0",
  currentHedgeNotional: "0",
  currentHedgeIsLong: false,
  targetHedgeIsLong: false,
});

const serializePosition = (
  position:
    | readonly [Address, boolean, bigint, bigint, boolean, Address, bigint, bigint, bigint, boolean, boolean]
    | null,
): SerializedVaultPosition => {
  if (!position) return emptyPosition();
  return {
    asset: position[0],
    isLong: position[1],
    notional: position[2].toString(),
    leverage: position[3].toString(),
    hasBorosHedge: position[4],
    yuToken: position[5],
    lastUpdateTimestamp: position[6].toString(),
    targetHedgeNotional: position[7].toString(),
    currentHedgeNotional: position[8].toString(),
    currentHedgeIsLong: position[9],
    targetHedgeIsLong: position[10],
  };
};

const parseBigIntField = (value: string, name: string): bigint => {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`Invalid bigint field: ${name}`);
  }
};

const getClients = (rpcUrl: string, privateKey?: `0x${string}`) => {
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ transport });
  const account = privateKey ? privateKeyToAccount(privateKey) : null;
  const walletClient = account ? createWalletClient({ account, transport, chain: undefined }) : null;
  return { publicClient, walletClient, account };
};

const buildSnapshot = async (request: Request): Promise<AgentSnapshotPayload> => {
  const url = new URL(request.url);
  const coin = (getOptionalString(url.searchParams.get("coin")) ?? DEFAULT_HL_COIN).toUpperCase();
  const walletAddress = getRequiredAddress(url.searchParams.get("walletAddress"), "walletAddress");
  const vaultAddress = getOptionalAddress(url.searchParams.get("vaultAddress"));
  const borosMarketAddress = getOptionalAddress(url.searchParams.get("borosMarketAddress"));
  const fallbackMode = getHedgeMode(url.searchParams.get("fallbackMode"));
  const rpcUrl = getOptionalString(url.searchParams.get("rpcUrl")) ?? DEFAULT_RPC_URL;
  const hlFundingUrl = getOptionalString(url.searchParams.get("hlFundingUrl")) ?? "https://api.hyperliquid.xyz/info";
  const hlPositionUrl =
    getOptionalString(url.searchParams.get("hlPositionUrl")) ?? "https://api.hyperliquid-testnet.xyz/info";
  const useMarkPrice = getBoolean(url.searchParams.get("useMarkPrice"), false);
  const windowHours = getNumber(url.searchParams.get("windowHours"), 1);
  const marketKey = getOptionalString(url.searchParams.get("marketKey"));
  const assetSymbol = getOptionalString(url.searchParams.get("assetSymbol")) ?? coin;
  const yuToken = getOptionalAddress(url.searchParams.get("yuToken")) ?? getDefaultYuTokenForCoin(coin);
  const venue = getOptionalString(url.searchParams.get("venue")) ?? "HlPerp";
  const borosMarketId = Math.max(1, Math.floor(getNumber(url.searchParams.get("borosMarketId"), DEFAULT_BOROS_MARKET_ID)));
  const borosCoreApiBaseUrl =
    getOptionalString(url.searchParams.get("borosCoreApiBaseUrl")) ?? DEFAULT_BOROS_CORE_API_BASE_URL;

  const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.CRE_SUPABASE_URL?.trim();
  const supabaseKey =
    process.env.CRE_SUPABASE_KEY?.trim() ||
    process.env.SUPABASE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase URL/key unavailable in sidecar environment");
  }

  const identity = await resolveRequiredWalletIdentity({
    walletAddress,
    vaultAddress,
    supabaseUrl,
    supabaseKey,
  });

  const { publicClient } = getClients(rpcUrl);
  const userId = BigInt(identity.record.userId);
  const [mappedUser, positionState, strategy, funding, borosQuote, position] = await Promise.all([
    vaultAddress
      ? publicClient.readContract({
          address: vaultAddress,
          abi: KYUTE_VAULT_ABI,
          functionName: "userIdToAddress",
          args: [userId],
        })
      : Promise.resolve(ZERO_ADDRESS),
    vaultAddress
      ? publicClient.readContract({
          address: vaultAddress,
          abi: KYUTE_VAULT_ABI,
          functionName: "userMarketPositions",
          args: [identity.record.walletAddress, yuToken],
        })
      : Promise.resolve(null),
    resolveUserHedgeMode({
      userId,
      walletAddress: identity.record.walletAddress,
      vaultAddress,
      marketKey,
      assetSymbol,
      venue,
      borosMarketAddress,
      fallbackMode,
      supabaseUrl,
      supabaseKey,
    }),
    fetchAverageFundingBpNative(hlFundingUrl, windowHours, coin),
    fetchBorosAprSnapshotNative(borosCoreApiBaseUrl, borosMarketId),
    fetchHlPositionSnapshotNative(hlPositionUrl, identity.record.walletAddress, coin, useMarkPrice),
  ]);

  return {
    identity: {
      userId: userId.toString(),
      walletAddress: identity.record.walletAddress,
      source: identity.source,
    },
    strategy: {
      enabled: strategy.enabled,
      mode: strategy.mode,
      entryThresholdBp: strategy.entryThresholdBp ?? undefined,
      exitThresholdBp: strategy.exitThresholdBp ?? undefined,
      source: strategy.source,
      ...(strategy.warning ? { warning: strategy.warning } : {}),
    },
    vault: {
      mappedUser: mappedUser as Address,
      position: serializePosition(positionState as typeof positionState),
    },
    funding,
    borosQuote,
    position,
  };
};

const executeHedge = async (request: Request): Promise<Response> => {
  const payload = (await request.json()) as ExecuteHedgePayload;
  const rpcUrl = payload.rpcUrl?.trim() || DEFAULT_RPC_URL;
  const callbackPrivateKey = payload.callbackPrivateKey ?? DEFAULT_CALLBACK_PRIVATE_KEY;
  const { publicClient, walletClient, account } = getClients(rpcUrl, callbackPrivateKey);

  if (!walletClient || !account) {
    throw new Error("Callback private key unavailable for execute sidecar");
  }

  const userId = parseBigIntField(payload.userId, "userId");
  const targetHedgeNotionalWei = parseBigIntField(payload.targetHedgeNotionalWei, "targetHedgeNotionalWei");
  const livePositionNotionalWei = parseBigIntField(payload.livePositionNotionalWei, "livePositionNotionalWei");
  const oracleTimestampSec = parseBigIntField(payload.oracleTimestampSec, "oracleTimestampSec");
  const predictedAprBp = parseBigIntField(payload.predictedAprBp, "predictedAprBp");
  const confidenceBp = parseBigIntField(payload.confidenceBp, "confidenceBp");
  const contractBorosAprBp = parseBigIntField(payload.contractBorosAprBp, "contractBorosAprBp");

  const [mappedUser, creCallbackOperator, positionState] = await Promise.all([
    publicClient.readContract({
      address: payload.vaultAddress,
      abi: KYUTE_VAULT_ABI,
      functionName: "userIdToAddress",
      args: [userId],
    }),
    publicClient.readContract({
      address: payload.vaultAddress,
      abi: KYUTE_VAULT_ABI,
      functionName: "creCallbackOperator",
      args: [],
    }),
    publicClient.readContract({
      address: payload.vaultAddress,
      abi: KYUTE_VAULT_ABI,
      functionName: "userMarketPositions",
      args: [payload.walletAddress, payload.yuToken],
    }),
  ]);

  if ((creCallbackOperator as Address).toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `Callback signer ${account.address} does not match vault creCallbackOperator ${creCallbackOperator as Address}`,
    );
  }
  if ((mappedUser as Address).toLowerCase() !== payload.walletAddress.toLowerCase()) {
    throw new Error(
      `Vault mapping mismatch for userId=${userId.toString()}: onchain=${mappedUser as Address} request=${payload.walletAddress}`,
    );
  }

  const leverageForSync = positionState[3] > 0n ? positionState[3] : 1n;
  const syncNeeded =
    (positionState[0] === ZERO_ADDRESS && livePositionNotionalWei > 0n) ||
    (
      positionState[0] !== ZERO_ADDRESS &&
      (
        Boolean(positionState[1]) !== (payload.positionSide === "long") ||
        positionState[2] !== livePositionNotionalWei ||
        positionState[7] !== targetHedgeNotionalWei ||
        Boolean(positionState[10]) !== payload.targetHedgeIsLong
      )
    );

  let syncTxHash: Hex | null = null;
  if (syncNeeded) {
    syncTxHash = await walletClient.sendTransaction({
      account,
      to: payload.vaultAddress,
      data: encodeFunctionData({
        abi: KYUTE_VAULT_ABI,
        functionName: "syncHyperliquidPositionForMarket",
        args: [
          userId,
          payload.yuToken,
          payload.positionSide === "long",
          livePositionNotionalWei,
          leverageForSync,
          targetHedgeNotionalWei,
          payload.targetHedgeIsLong,
          oracleTimestampSec,
        ],
      }),
    });
    await publicClient.waitForTransactionReceipt({ hash: syncTxHash });
  }

  const executeTxHash = await walletClient.sendTransaction({
    account,
    to: payload.vaultAddress,
    data: encodeFunctionData({
      abi: KYUTE_VAULT_ABI,
      functionName: "executeHedge",
      args: [
        userId,
        payload.shouldHedge,
        payload.yuToken,
        predictedAprBp,
        confidenceBp,
        contractBorosAprBp,
        targetHedgeNotionalWei,
        oracleTimestampSec,
        payload.proofHash,
      ],
    }),
  });
  await publicClient.waitForTransactionReceipt({ hash: executeTxHash });

  return json({
    ok: true,
    syncTxHash,
    executeTxHash,
  });
};

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(request) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/health") {
        return json({ ok: true, service: "kyute-agent-sidecar" });
      }

      if (url.pathname === "/internal/agent-snapshot" && request.method === "GET") {
        const snapshot = await buildSnapshot(request);
        return json({ ok: true, snapshot });
      }

      if (url.pathname === "/internal/execute-hedge" && request.method === "POST") {
        return await executeHedge(request);
      }

      return fail(404, "Not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[kyute-agent-sidecar] ${request.method} ${url.pathname} failed: ${message}`);
      return fail(500, message);
    }
  },
});

console.log(`[kyute-agent-sidecar] listening on http://${HOST}:${PORT}`);
console.log(`[kyute-agent-sidecar] defaults rpc=${DEFAULT_RPC_URL} walletKey=${DEFAULT_CALLBACK_PRIVATE_KEY.slice(0, 10)}...`);

export default server;
