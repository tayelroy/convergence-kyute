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
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  parseEther,
  http as viemHttp,
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
import { fetchBorosImpliedAprQuote } from "../boros.js";
import { readWalletBridgeRecord, resolveWalletUserId } from "../wallet-bridge.js";

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
  userId?: number;
  yuToken?: string;
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

const PAIR = "ETHUSDC";
const HL_COIN = "ETH";
const WINDOW_HOURS = 1;
const MIN_CONFIDENCE_BP = 6000;
const DEFAULT_ENTRY_THRESHOLD_BP = 40;
const DEFAULT_EXIT_THRESHOLD_BP = 10;
const DEFAULT_BOROS_OI_FEE_BP = 10;
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
  return String(process.env.DEMO_HEDGE_NOTIONAL_USE_MARK_PRICE ?? "").trim().toLowerCase() === "true";
};

const resolveHyperliquidWalletAddress = async (params: {
  config: Config;
  userId: bigint;
  vaultAddress?: Address;
  mappedUser: Address;
}): Promise<{ address: Address; source: string }> => {
  const bridged = await readWalletBridgeRecord({
    userId: params.userId,
    vaultAddress: params.vaultAddress,
  });
  if (bridged) {
    return { address: bridged.walletAddress, source: "frontend_bridge" };
  }

  if (params.config.hlAddress && /^0x[0-9a-fA-F]{40}$/.test(params.config.hlAddress)) {
    return { address: params.config.hlAddress as Address, source: "config" };
  }

  if (params.mappedUser !== ZERO_ADDRESS) {
    return { address: params.mappedUser, source: "vault_mapping" };
  }

  throw new Error("Missing Hyperliquid wallet address in config, bridge registration, and vault mapping");
};

const resolveAgentUserId = async (config: Config, vaultAddress?: Address): Promise<bigint> => {
  if (config.hlAddress && /^0x[0-9a-fA-F]{40}$/.test(config.hlAddress)) {
    const bridgedUserId = await resolveWalletUserId({
      walletAddress: config.hlAddress as Address,
    });
    if (bridgedUserId !== null) {
      return bridgedUserId;
    }
  }

  if (typeof config.userId === "number" && Number.isFinite(config.userId) && config.userId > 0) {
    return BigInt(Math.floor(config.userId));
  }

  const latestBridgeRecord = await readWalletBridgeRecord({ vaultAddress });
  if (latestBridgeRecord) {
    return BigInt(latestBridgeRecord.userId);
  }

  const anyBridgeRecord = await readWalletBridgeRecord({});
  if (anyBridgeRecord) {
    return BigInt(anyBridgeRecord.userId);
  }

  return 123n;
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

const onCronTrigger = async (runtime: Runtime<Config>) => {
  const http = new HTTPClient();
  const config = runtime.config;
  const entryThresholdBp = config.entryThresholdBp ?? config.thresholdBp ?? DEFAULT_ENTRY_THRESHOLD_BP;
  const exitThresholdBp = config.exitThresholdBp ?? DEFAULT_EXIT_THRESHOLD_BP;
  const windowHours = config.windowHours ?? WINDOW_HOURS;
  const hedgeMode = config.hedgeMode ?? "adverse_only";
  const borosOiFeeBp = config.borosOiFeeBp ?? DEFAULT_BOROS_OI_FEE_BP;
  const useMarkPrice = resolveUseMarkPrice(config);
  const hlFundingUrl = resolveHlUrl(config, "funding");
  const hlPositionUrl = resolveHlUrl(config, "position");
  const yuToken = (config.yuToken ?? "0x0000000000000000000000000000000000000001") as `0x${string}`;
  const executeOnchain = config.executeOnchain ?? false;
  const enableReportWrite = config.enableReportWrite ?? false;
  const rpcUrl = config.rpcUrl ?? DEFAULT_ANVIL_RPC_URL;
  const vaultAddress = config.vaultAddress as `0x${string}`;

  const publicClient = createPublicClient({
    transport: viemHttp(rpcUrl, { timeout: 10_000 }),
    chain: undefined,
  });
  const hasVaultAddress =
    /^0x[0-9a-fA-F]{40}$/.test(vaultAddress) &&
    vaultAddress !== "0x0000000000000000000000000000000000000000";
  const userId = await resolveAgentUserId(config, hasVaultAddress ? vaultAddress : undefined);
  let mappedUser = hasVaultAddress
    ? ((await publicClient.readContract({
        address: vaultAddress,
        abi: KYUTE_VAULT_ABI,
        functionName: "userIdToAddress",
        args: [userId],
      } as any)) as Address)
    : ("0x0000000000000000000000000000000000000000" as Address);
  const signerPk = config.callbackPrivateKey ?? DEFAULT_ANVIL_PRIVATE_KEY;
  const canUseDirectSigner = executeOnchain && hasVaultAddress && /^0x[0-9a-fA-F]{64}$/.test(signerPk);
  const directAccount = canUseDirectSigner ? privateKeyToAccount(signerPk as `0x${string}`) : null;
  const directWalletClient = directAccount
    ? createWalletClient({
        account: directAccount,
        transport: viemHttp(rpcUrl, { timeout: 10_000 }),
        chain: undefined,
      })
    : null;
  const hlWallet = await resolveHyperliquidWalletAddress({
    config,
    userId,
    vaultAddress: hasVaultAddress ? vaultAddress : undefined,
    mappedUser,
  });
  if (
    hasVaultAddress &&
    directAccount &&
    directWalletClient &&
    hlWallet.address.toLowerCase() !== mappedUser.toLowerCase()
  ) {
    const registeredOperator = (await publicClient.readContract({
      address: vaultAddress,
      abi: KYUTE_VAULT_ABI,
      functionName: "creCallbackOperator",
    } as any)) as Address;

    if (registeredOperator.toLowerCase() !== directAccount.address.toLowerCase()) {
      runtime.log(
        `Skipping syncUserAddress because callback signer ${directAccount.address} does not match vault creCallbackOperator ${registeredOperator}`,
      );
    } else {
      const syncUserData = encodeFunctionData({
        abi: KYUTE_VAULT_ABI,
        functionName: "syncUserAddress",
        args: [userId, hlWallet.address],
      });
      const syncUserTxHash = await directWalletClient.sendTransaction({
        account: directAccount,
        chain: undefined,
        to: vaultAddress,
        data: syncUserData,
      } as any);
      const syncUserReceipt = await publicClient.waitForTransactionReceipt({ hash: syncUserTxHash });
      if (syncUserReceipt.status !== "success") {
        throw new Error(`syncUserAddress failed tx=${syncUserTxHash}`);
      }
      runtime.log(`Direct syncUserAddress tx confirmed: ${syncUserTxHash}`);
      mappedUser = hlWallet.address;
    }
  }
  const hasMappedUser = mappedUser !== "0x0000000000000000000000000000000000000000";
  if (hlFundingUrl !== hlPositionUrl) {
    runtime.log(`Using separate HL endpoints fundingUrl=${hlFundingUrl} positionUrl=${hlPositionUrl}`);
  }
  const [funding, borosQuote, position] = await Promise.all([
    http
      .sendRequest(runtime, fetchAverageFundingBp, consensusIdenticalAggregation())(hlFundingUrl, windowHours)
      .result(),
    fetchBorosImpliedAprQuote(HL_COIN, {
      marketAddress: config.borosMarketAddress,
      coreApiUrl: config.borosCoreApiUrl,
    }),
    http
      .sendRequest(runtime, fetchHlPositionSnapshot, consensusIdenticalAggregation())(hlPositionUrl, hlWallet.address, useMarkPrice)
      .result(),
  ]);
  const oracleTimestamp = BigInt(Math.floor(funding.latestFundingTimestampMs / 1000));
  const borosAprBp = borosQuote.aprBp;
  const borosApr = borosQuote.aprDecimal;
  const positionState = hasMappedUser
    ? ((await publicClient.readContract({
        address: vaultAddress,
        abi: KYUTE_VAULT_ABI,
        functionName: "userPositions",
        args: [mappedUser],
      } as any)) as readonly [Address, boolean, bigint, bigint, boolean, Address, bigint, bigint, bigint, boolean, boolean])
    : null;

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
  const shouldHedge = decision.shouldHedge && livePositionNotionalWei > 0n;
  const targetHedgeIsLong = decision.targetHedgeIsLong;
  const targetHedgeNotionalWei = shouldHedge ? livePositionNotionalWei : 0n;

  runtime.log(`Boros APR: ${(borosApr * 100).toFixed(2)}% market=${borosQuote.marketAddress ?? "auto"}`);
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
      oracleTimestamp,
      proofHash
    ],
  )

  if (executeOnchain) {
    let directExecuteSucceeded = false;

    if (directAccount && directWalletClient && hasVaultAddress) {
      try {
        runtime.log(`Submitting direct executeHedge to vault=${vaultAddress} via rpc=${rpcUrl}`);
        const registeredOperator = (await publicClient.readContract({
          address: vaultAddress,
          abi: KYUTE_VAULT_ABI,
          functionName: "creCallbackOperator",
        } as any)) as Address;
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
              oracleTimestamp,
            ],
          });
          const syncTxHash = await directWalletClient.sendTransaction({
            account: directAccount,
            chain: undefined,
            to: vaultAddress,
            data: syncData,
          } as any);
          const syncReceipt = await publicClient.waitForTransactionReceipt({ hash: syncTxHash });
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
            oracleTimestamp,
            proofHash,
          ],
        });

        const txHash = await directWalletClient.sendTransaction({
          account: directAccount,
          chain: undefined,
          to: vaultAddress,
          data,
        } as any);
        runtime.log(`Direct executeHedge tx submitted: ${txHash}`);
        directExecuteSucceeded = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtime.log(`Direct executeHedge failed (${message})`);
      }
    }

    if (!enableReportWrite) {
      runtime.log("CRE report write disabled in demo mode; direct execute path only.");
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
      }
    }
  } else {
    runtime.log(`Onchain execution disabled; report payload bytes=${reportBytes.length}`);
  }

  runtime.log(`Hedge Decision Computed: ${shouldHedge}`);
  return shouldHedge ? "HEDGED_APPLIED_TO_VAULT" : "HEDGE_SKIPPED";
};

const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
