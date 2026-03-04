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
import { encodeAbiParameters, keccak256, toBytes } from "viem";

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
  thresholdBp?: number;
  windowHours?: number;
  executeOnchain?: boolean;
};

type FundingHistoryEntry = {
  fundingRate?: number | string;
  funding?: number | string;
  rate?: number | string;
};

type PositionSide = "long" | "short";

const PAIR = "ETHUSDC";
const HL_COIN = "ETH";
const THRESHOLD_BP = 10;
const WINDOW_HOURS = 1;
const FEE_BUFFER_BP = 10;
const MIN_CONFIDENCE_BP = 6000;
const HL_MAINNET_URL = "https://api.hyperliquid.xyz/info";
const HL_TESTNET_URL = "https://api.hyperliquid-testnet.xyz/info";

const estimateBorosApr = (_requester: HTTPSendRequester, coin: string): number => {
  const aprByCoin: Record<string, number> = {
    ETH: 0.06,
    BTC: 0.05,
    SOL: 0.08,
  };

  return aprByCoin[coin.toUpperCase()] ?? 0.05;
};

const resolveHlUrl = (config: Config): string => {
  if (config.hlBaseUrl) return config.hlBaseUrl;
  return config.hlTestnet ? HL_TESTNET_URL : HL_MAINNET_URL;
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
): { averageFundingBp: number; observedFundingPoints: number } => {
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

  const rates = data
    .map((entry) => Number(entry.fundingRate ?? entry.funding ?? entry.rate ?? NaN))
    .filter((value) => Number.isFinite(value));

  if (rates.length === 0) {
    const fallbackBp = fetchPredictedFundingBp(requester, HL_COIN, baseUrl);
    return { averageFundingBp: fallbackBp, observedFundingPoints: 0 };
  }

  const averageRate = rates.reduce((sum, value) => sum + value, 0) / rates.length;
  // fundingRate entries are per-hour; annualize to bp
  return {
    averageFundingBp: Math.round(averageRate * 24 * 365 * 10_000),
    observedFundingPoints: rates.length,
  };
};

const fetchHlPositionSnapshot = (
  requester: HTTPSendRequester,
  baseUrl: string,
  userAddress: string,
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
  const hedgeNotional = hlSize * markPrice;

  return { positionSide, hlSize, markPrice, hedgeNotional };
};

const computeShouldHedge = (params: {
  averageFundingBp: number;
  positionSide: PositionSide;
  thresholdBp: number;
  predictedAprBp: number;
  borosAprBp: number;
  confidenceBp: number;
}): boolean => {
  const unfavorableFundingBp =
    params.positionSide === "long" ? params.averageFundingBp : -params.averageFundingBp;
  const fundingUnfavorable = unfavorableFundingBp >= params.thresholdBp;
  return (
    fundingUnfavorable &&
    params.predictedAprBp > params.borosAprBp + FEE_BUFFER_BP &&
    params.confidenceBp >= MIN_CONFIDENCE_BP
  );
};

const onCronTrigger = async (runtime: Runtime<Config>) => {
  const http = new HTTPClient();
  const config = runtime.config;
  const thresholdBp = config.thresholdBp ?? THRESHOLD_BP;
  const windowHours = config.windowHours ?? WINDOW_HOURS;
  const hlUrl = resolveHlUrl(config);

  if (!config.hlAddress) {
    throw new Error("Missing hlAddress in config for Hyperliquid position lookup");
  }

  const funding = http
    .sendRequest(runtime, fetchAverageFundingBp, consensusIdenticalAggregation())(hlUrl, windowHours)
    .result();

  // DEMO OVERRIDE: force funding to be unfavorable so hedge opens.
  funding.averageFundingBp = 500; // +5% APR equivalent
  const borosApr = http.sendRequest(runtime, estimateBorosApr, consensusIdenticalAggregation())(HL_COIN).result();
  const position = http
    .sendRequest(runtime, fetchHlPositionSnapshot, consensusIdenticalAggregation())(hlUrl, config.hlAddress)
    .result();

  const hlApr = funding.averageFundingBp / 10_000 / 100; // bp to decimal APR
  runtime.log(`Boros APR: ${(borosApr * 100).toFixed(2)}%`);
  runtime.log(`HL 1h avg funding (annualized): ${funding.averageFundingBp} bp`);
  runtime.log(`HL position side=${position.positionSide}, size=${position.hlSize.toFixed(6)} ETH, mark=${position.markPrice.toFixed(4)}, hedgeNotional=${position.hedgeNotional.toFixed(4)}`);

  // DEMO OVERRIDE: force APRs to drive hedge open
  const predictedAprBp = 10_000; // 100% APR
  const borosAprBp = 0;          // 0% comparator
  const confidenceBp = 10_000;   // 100% confidence
  const shouldHedge = computeShouldHedge({
    averageFundingBp: funding.averageFundingBp,
    positionSide: position.positionSide,
    thresholdBp,
    predictedAprBp,
    borosAprBp,
    confidenceBp,
  });
  const userId = BigInt(config.userId ?? 123);
  const yuToken = (config.yuToken ?? "0x0000000000000000000000000000000000000001") as `0x${string}`;
  const executeOnchain = config.executeOnchain ?? false;

  const proofPayload = JSON.stringify({
    type: "kYUteMvpNodeModeProof",
    version: 2,
    generatedAt: new Date().toISOString(),
    chainId: 0,
    userId: userId.toString(),
    pair: PAIR,
    vaultAddress: config.vaultAddress,
    yuToken,
    inputs: {
      windowHours,
      thresholdBp,
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
      { type: "bytes32" }
    ],
    [
      userId,
      shouldHedge,
      yuToken,
      BigInt(predictedAprBp),
      BigInt(confidenceBp),
      BigInt(borosAprBp),
      position.positionSide === "long" ? 1 : 2,
      BigInt(Math.round(position.hedgeNotional)),
      proofHash
    ],
  )

  if (executeOnchain) {
    const signedReport = runtime.report({
      encodedPayload: hexToBase64(reportBytes),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    }).result();

    const evmClient = new EVMClient(4949039107694359620n);
    const receiver = new Uint8Array(Buffer.from(config.vaultAddress.slice(2), "hex"));

    if (config.vaultAddress !== "0x0000000000000000000000000000000000000000") {
      evmClient.writeReport(runtime, {
        $report: true,
        receiver,
        report: signedReport,
      }).result();
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
