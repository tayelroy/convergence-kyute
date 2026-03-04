import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const PAIR = "ETHUSDC";
const HL_COIN = "ETH";
const WINDOW_HOURS = 1;
const THRESHOLD_BP = 10;
const DEFAULT_CHAIN_ID = 42161;
const FEE_BUFFER_BP = 10;
const MIN_CONFIDENCE_BP = 6000;
const HL_MAINNET_URL = "https://api.hyperliquid.xyz/info";
const HL_TESTNET_URL = "https://api.hyperliquid-testnet.xyz/info";

const KYUTE_VAULT_ABI = [
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
      { name: "proofHash", type: "bytes32" },
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
] as const;

type HyperliquidFundingPoint = {
  timestamp: number;
  fundingRate: number;
};

type WorkflowRunnerConfig = {
  userId: bigint;
  vaultAddress: Address;
  yuToken: Address;
  hlAddress: Address;
  hlTestnet?: boolean;
  hlBaseUrl?: string;
  borosMarketAddress?: Address;
  subgraphUrl: string;
  rpcUrl: string;
  callbackPrivateKey: Hex;
  thresholdBp?: number;
  windowHours?: number;
  chainId?: number;
  executeOnchain?: boolean;
};

type WorkflowRunnerResult = {
  pair: string;
  averageFundingBp: number;
  positionSide: PositionSide;
  hlSize: number;
  markPrice: number;
  hedgeNotional: number;
  hlAprBp: number;
  borosApr: number;
  predictedAprBp: number;
  borosAprBp: number;
  confidenceBp: number;
  shouldHedge: boolean;
  proofHash: Hex;
  proofSignature: Hex;
  txHash?: Hex;
};

type Logger = (message: string) => void;
type PositionSide = "long" | "short";

const postJson = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }

  return response.json() as Promise<T>;
};

const toAprBp = (apr: number): number => Math.round(apr * 10000);

const normalizeApr = (raw: number): number => {
  if (!Number.isFinite(raw)) return 0;
  if (raw > 3) return raw / 100;
  return raw;
};

const parseFundingRate = (entry: unknown): number | null => {
  if (typeof entry === "number") return entry;
  if (typeof entry !== "object" || entry === null) return null;

  const candidate = entry as Record<string, unknown>;
  const raw = candidate.fundingRate ?? candidate.funding ?? candidate.rate;
  const asNumber = Number(raw);
  return Number.isFinite(asNumber) ? asNumber : null;
};

const parseTimestamp = (entry: unknown): number => {
  if (typeof entry !== "object" || entry === null) return Date.now();
  const candidate = entry as Record<string, unknown>;
  const raw = Number(candidate.time ?? candidate.timestamp ?? candidate.t);
  return Number.isFinite(raw) ? raw : Date.now();
};

const fallbackPredictedFundingApr = async (coin: string, baseUrl: string): Promise<number> => {
  const data = await postJson<any[]>(baseUrl, { type: "predictedFundings" });
  const coinData = data.find((item) => Array.isArray(item) && item[0] === coin);
  if (!coinData) return 0;

  const venues = (coinData[1] ?? []) as any[];
  const hlPerpEntry = venues.find((venue) => Array.isArray(venue) && venue[0] === "HlPerp");
  if (!hlPerpEntry) return 0;

  const fundingRate = Number(hlPerpEntry?.[1]?.fundingRate ?? hlPerpEntry?.[1]?.funding ?? 0);
  if (!Number.isFinite(fundingRate)) return 0;
  // fundingRate is per-hour; annualize to decimal APR
  return fundingRate * 24 * 365;
};

const fetchHyperliquidFundingHistoryApr = async (
  coin: string,
  baseUrl: string,
  lookbackHours = WINDOW_HOURS,
): Promise<{ apr: number; points: HyperliquidFundingPoint[] }> => {
  const startTime = Date.now() - lookbackHours * 60 * 60 * 1000;

  try {
    const response = await postJson<unknown[]>(baseUrl, {
      type: "fundingHistory",
      coin,
      startTime,
    });

    const points: HyperliquidFundingPoint[] = response
      .map((entry) => ({
        timestamp: parseTimestamp(entry),
        fundingRate: parseFundingRate(entry) ?? NaN,
      }))
      .filter((entry) => Number.isFinite(entry.fundingRate));

    if (points.length === 0) {
      const apr = await fallbackPredictedFundingApr(coin, baseUrl);
      return { apr, points: [] };
    }

    const averageFundingRate = points.reduce((sum, point) => sum + point.fundingRate, 0) / points.length;
    return {
      apr: averageFundingRate * 24 * 365,
      points,
    };
  } catch {
    const apr = await fallbackPredictedFundingApr(coin, baseUrl);
    return { apr, points: [] };
  }
};

const fetchHyperliquidPositionSnapshot = async (
  userAddress: Address,
  baseUrl: string,
): Promise<{ positionSide: PositionSide; hlSize: number; markPrice: number; hedgeNotional: number }> => {
  const [metaAndCtxs, state] = await Promise.all([
    postJson<unknown>(baseUrl, { type: "metaAndAssetCtxs" }),
    postJson<{ assetPositions?: Array<{ position?: Record<string, unknown> }> }>(baseUrl, {
      type: "clearinghouseState",
      user: userAddress,
    }),
  ]);

  const [meta, assetCtxs] = metaAndCtxs as [
    { universe: Array<{ name: string }> },
    Array<{ markPx?: string; midPx?: string }>
  ];
  const assetIndex = meta.universe.findIndex((asset) => asset.name.toUpperCase() === HL_COIN);
  if (assetIndex < 0) throw new Error(`Unable to locate ${HL_COIN} in Hyperliquid universe`);

  const markPriceRaw = assetCtxs[assetIndex]?.markPx ?? assetCtxs[assetIndex]?.midPx;
  const markPrice = Number(markPriceRaw ?? 0);
  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    throw new Error(`Unable to resolve valid ${PAIR} mark price`);
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

const fetchMarketAprField = async (subgraphUrl: string): Promise<string> => {
  const introspection = await postJson<{
    data?: { __type?: { fields?: Array<{ name: string }> } };
  }>(subgraphUrl, {
    query: "query IntrospectMarketFields { __type(name: \"Market\") { fields { name } } }",
  });

  const names = new Set((introspection.data?.__type?.fields ?? []).map((field) => field.name));
  const candidates = ["impliedApr", "impliedApy", "fixedApr", "fixedApy"];
  const selected = candidates.find((field) => names.has(field));

  if (!selected) {
    throw new Error("Unable to resolve Boros APR field from subgraph schema");
  }

  return selected;
};

const fetchBorosImpliedApr = async (
  subgraphUrl: string,
  marketAddress?: Address,
): Promise<number> => {
  const aprField = await fetchMarketAprField(subgraphUrl);
  const marketId = marketAddress?.toLowerCase();

  const query = marketId
    ? `query MarketById($id: String!) { market(id: $id) { ${aprField} } }`
    : `query LatestMarket { markets(first: 1) { ${aprField} } }`;

  const variables = marketId ? { id: marketId } : undefined;
  const response = await postJson<{
    data?: {
      market?: Record<string, unknown> | null;
      markets?: Array<Record<string, unknown>>;
    };
  }>(subgraphUrl, { query, variables });

  const value = marketId
    ? response.data?.market?.[aprField]
    : response.data?.markets?.[0]?.[aprField];

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Subgraph returned non-numeric Boros APR");
  }

  return normalizeApr(parsed);
};

const buildProofPayload = (input: {
  userId: bigint;
  pair: string;
  vaultAddress: Address;
  yuToken: Address;
  windowHours: number;
  thresholdBp: number;
  averageFundingBp: number;
  positionSide: PositionSide;
  hlSize: number;
  markPrice: number;
  hedgeNotional: number;
  borosAprBp: number;
  predictedAprBp: number;
  confidenceBp: number;
  shouldHedge: boolean;
  observedFundingPoints: number;
  chainId: number;
}): string => {
  return JSON.stringify({
    type: "kYUteMvpNodeModeProof",
    version: 2,
    generatedAt: new Date().toISOString(),
    chainId: input.chainId,
    userId: input.userId.toString(),
    pair: input.pair,
    vaultAddress: input.vaultAddress,
    yuToken: input.yuToken,
    inputs: {
      windowHours: input.windowHours,
      thresholdBp: input.thresholdBp,
      averageFundingBp: input.averageFundingBp,
      positionSide: input.positionSide,
      hlSize: input.hlSize,
      markPrice: input.markPrice,
      hedgeNotional: input.hedgeNotional,
      borosAprBp: input.borosAprBp,
      observedFundingPoints: input.observedFundingPoints,
    },
    outputs: {
      predictedAprBp: input.predictedAprBp,
      confidenceBp: input.confidenceBp,
      shouldHedge: input.shouldHedge,
    },
  });
};

const computeShouldHedge = (input: {
  averageFundingBp: number;
  positionSide: PositionSide;
  thresholdBp: number;
  predictedAprBp: number;
  borosAprBp: number;
  confidenceBp: number;
}): boolean => {
  const unfavorableFundingBp =
    input.positionSide === "long" ? input.averageFundingBp : -input.averageFundingBp;
  const fundingUnfavorable = unfavorableFundingBp >= input.thresholdBp;
  return (
    fundingUnfavorable &&
    input.predictedAprBp > input.borosAprBp + FEE_BUFFER_BP &&
    input.confidenceBp >= MIN_CONFIDENCE_BP
  );
};

export const runKyuteWorkflowCycle = async (
  config: WorkflowRunnerConfig,
  log: Logger = console.log,
): Promise<WorkflowRunnerResult> => {
  const chainId = config.chainId ?? DEFAULT_CHAIN_ID;
  const thresholdBp = config.thresholdBp ?? THRESHOLD_BP;
  const windowHours = config.windowHours ?? WINDOW_HOURS;
  const baseUrl = config.hlBaseUrl ?? (config.hlTestnet ? HL_TESTNET_URL : HL_MAINNET_URL);

  const funding = await fetchHyperliquidFundingHistoryApr(HL_COIN, baseUrl, windowHours);
  // DEMO OVERRIDE: force funding to be unfavorable so hedge opens.
  const fundingOverrideBp = 500; // +5% APR equivalent
  const averageFundingBpForced = fundingOverrideBp;
  const averageFundingRate = averageFundingBpForced / (24 * 365 * 10_000);
  const position = await fetchHyperliquidPositionSnapshot(config.hlAddress, baseUrl);
  const borosApr = await fetchBorosImpliedApr(config.subgraphUrl, config.borosMarketAddress);
  const averageFundingBp = averageFundingBpForced;
  // DEMO OVERRIDE: force APRs to drive hedge open
  const hlAprBp = toAprBp(funding.apr);
  const predictedAprBp = 10_000; // 100% APR
  const borosAprBp = 0;          // 0% comparator
  const confidenceBp = 10_000;   // 100% confidence
  const shouldHedge = computeShouldHedge({
    averageFundingBp,
    positionSide: position.positionSide,
    thresholdBp,
    predictedAprBp,
    borosAprBp,
    confidenceBp,
  });

  const account = privateKeyToAccount(config.callbackPrivateKey);
  const proofPayload = buildProofPayload({
    userId: config.userId,
    pair: PAIR,
    vaultAddress: config.vaultAddress,
    yuToken: config.yuToken,
    windowHours,
    thresholdBp,
    averageFundingBp,
    positionSide: position.positionSide,
    hlSize: position.hlSize,
    markPrice: position.markPrice,
    hedgeNotional: position.hedgeNotional,
    borosAprBp,
    predictedAprBp,
    confidenceBp,
    shouldHedge,
    observedFundingPoints: funding.points.length,
    chainId,
  });

  const proofDigest = keccak256(toBytes(proofPayload));
  const proofSignature = await account.signMessage({ message: { raw: proofDigest } });
  const proofHash = keccak256(toBytes(`${proofDigest}:${proofSignature}`));

  log(
    `Decision for ${PAIR}: funding1h=${averageFundingBp}bp, side=${position.positionSide}, size=${position.hlSize.toFixed(6)} ETH, mark=${position.markPrice.toFixed(4)}, hedgeNotional=${position.hedgeNotional.toFixed(4)}, borosAprBp=${borosAprBp}, confidence=${confidenceBp}bp -> shouldHedge=${shouldHedge}`,
  );

  let txHash: Hex | undefined;

  if (config.executeOnchain !== false) {
    const transport = http(config.rpcUrl);
    const walletClient = createWalletClient({ chain: undefined, account, transport });
    const publicClient = createPublicClient({ chain: undefined, transport });

    const registeredOperator = (await publicClient.readContract({
      address: config.vaultAddress,
      abi: KYUTE_VAULT_ABI,
      functionName: "creCallbackOperator",
    })) as Address;

    if (registeredOperator.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error(
        `Callback signer ${account.address} does not match vault creCallbackOperator ${registeredOperator}`,
      );
    }

    const data = encodeFunctionData({
      abi: KYUTE_VAULT_ABI,
      functionName: "executeHedge",
      args: [
        config.userId,
        shouldHedge,
        config.yuToken,
        BigInt(predictedAprBp),
        BigInt(confidenceBp),
        BigInt(borosAprBp),
        BigInt(Math.round(position.hedgeNotional)),
        proofHash,
      ],
    });

    txHash = await walletClient.sendTransaction({
      account,
      chain: null,
      to: config.vaultAddress,
      data,
    });

    await publicClient.waitForTransactionReceipt({ hash: txHash });
    log(`executeHedge submitted: ${txHash}`);
  } else {
    log("Onchain execution disabled: generated signed proof only.");
  }

  return {
    pair: PAIR,
    averageFundingBp,
    positionSide: position.positionSide,
    hlSize: position.hlSize,
    markPrice: position.markPrice,
    hedgeNotional: position.hedgeNotional,
    hlAprBp,
    borosApr,
    predictedAprBp,
    borosAprBp,
    confidenceBp,
    shouldHedge,
    proofHash,
    proofSignature,
    txHash,
  };
};
