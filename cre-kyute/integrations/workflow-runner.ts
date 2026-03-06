import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  parseEther,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  computeHedgePolicy,
  type HedgeMode,
  type PositionSide,
} from "../hedge-policy.js";

const PAIR = "ETHUSDC";
const HL_COIN = "ETH";
const WINDOW_HOURS = 1;
const DEFAULT_CHAIN_ID = 42161;
const MIN_CONFIDENCE_BP = 6000;
const DEFAULT_ENTRY_THRESHOLD_BP = 40;
const DEFAULT_EXIT_THRESHOLD_BP = 10;
const DEFAULT_BOROS_OI_FEE_BP = 10;
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
      { name: "oracleTimestamp", type: "uint256" },
      { name: "proofHash", type: "bytes32" },
    ],
    outputs: [],
  },
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
  entryThresholdBp?: number;
  exitThresholdBp?: number;
  hedgeMode?: HedgeMode;
  borosOiFeeBp?: number;
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
  targetHedgeIsLong: boolean;
  exposure: string;
  edgeBp: number;
  proofHash: Hex;
  proofSignature: Hex;
  txHash?: Hex;
};

type Logger = (message: string) => void;

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

const resolveOracleTimestamp = (points: HyperliquidFundingPoint[]): bigint => {
  if (points.length === 0) return BigInt(Math.floor(Date.now() / 1000));

  let latestMs = points[0].timestamp;
  for (const point of points) {
    if (point.timestamp > latestMs) latestMs = point.timestamp;
  }
  return BigInt(Math.floor(latestMs / 1000));
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
  const hedgeNotional = hlSize;

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

export const runKyuteWorkflowCycle = async (
  config: WorkflowRunnerConfig,
  log: Logger = console.log,
): Promise<WorkflowRunnerResult> => {
  const chainId = config.chainId ?? DEFAULT_CHAIN_ID;
  const entryThresholdBp = config.entryThresholdBp ?? config.thresholdBp ?? DEFAULT_ENTRY_THRESHOLD_BP;
  const exitThresholdBp = config.exitThresholdBp ?? DEFAULT_EXIT_THRESHOLD_BP;
  const windowHours = config.windowHours ?? WINDOW_HOURS;
  const baseUrl = config.hlBaseUrl ?? (config.hlTestnet ? HL_TESTNET_URL : HL_MAINNET_URL);
  const hedgeMode = config.hedgeMode ?? "adverse_only";
  const borosOiFeeBp = config.borosOiFeeBp ?? DEFAULT_BOROS_OI_FEE_BP;

  const funding = await fetchHyperliquidFundingHistoryApr(HL_COIN, baseUrl, windowHours);
  const position = await fetchHyperliquidPositionSnapshot(config.hlAddress, baseUrl);
  const borosApr = await fetchBorosImpliedApr(config.subgraphUrl, config.borosMarketAddress);
  const hlAprBp = toAprBp(funding.apr);
  const borosAprBp = toAprBp(borosApr);
  const confidenceBp = 10_000;   // 100% confidence
  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({ chain: undefined, transport });
  const mappedUser = (await publicClient.readContract({
    address: config.vaultAddress,
    abi: KYUTE_VAULT_ABI,
    functionName: "userIdToAddress",
    args: [config.userId],
  } as any)) as Address;
  const hasMappedUser = mappedUser.toLowerCase() !== "0x0000000000000000000000000000000000000000";
  const positionState = hasMappedUser
    ? ((await publicClient.readContract({
        address: config.vaultAddress,
        abi: KYUTE_VAULT_ABI,
        functionName: "userPositions",
        args: [mappedUser],
      } as any)) as readonly [Address, boolean, bigint, bigint, boolean, Address, bigint, bigint, bigint, boolean, boolean])
    : null;

  const decision = computeHedgePolicy({
    positionSide: position.positionSide,
    borosImpliedAprBp: borosAprBp,
    confidenceBp,
    averageFundingBp: hlAprBp,
    hasExistingHedge: Boolean(positionState?.[4]),
    existingHedgeIsLong: Boolean(positionState?.[9]),
    entryThresholdBp,
    exitThresholdBp,
    minConfidenceBp: MIN_CONFIDENCE_BP,
    oiFeeBp: borosOiFeeBp,
    mode: hedgeMode,
  });
  const shouldHedge = decision.shouldHedge;
  const predictedAprBp = Math.round(decision.carrySourceAprBp);
  const contractBorosAprBp = Math.round(decision.carryCostAprBp);
  const targetHedgeIsLong = decision.targetHedgeIsLong;

  const account = privateKeyToAccount(config.callbackPrivateKey);
  const proofPayload = buildProofPayload({
    userId: config.userId,
    pair: PAIR,
    vaultAddress: config.vaultAddress,
    yuToken: config.yuToken,
    windowHours,
    thresholdBp: entryThresholdBp,
    averageFundingBp: hlAprBp,
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
  const oracleTimestamp = resolveOracleTimestamp(funding.points);

  log(
    `Decision for ${PAIR}: funding1h=${hlAprBp}bp, exposure=${decision.exposure}, side=${position.positionSide}, size=${position.hlSize.toFixed(6)} ETH, hedgeNotional=${position.hedgeNotional.toFixed(6)}, borosImpliedAprBp=${borosAprBp}, edge=${decision.edgeBp}bp, targetHedgeIsLong=${targetHedgeIsLong}, confidence=${confidenceBp}bp -> shouldHedge=${shouldHedge}`,
  );

  let txHash: Hex | undefined;

  if (config.executeOnchain !== false) {
    const walletClient = createWalletClient({ chain: undefined, account, transport });

    const registeredOperator = (await publicClient.readContract({
      address: config.vaultAddress,
      abi: KYUTE_VAULT_ABI,
      functionName: "creCallbackOperator",
    } as any)) as Address;

    if (registeredOperator.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error(
        `Callback signer ${account.address} does not match vault creCallbackOperator ${registeredOperator}`,
      );
    }

    if (!hasMappedUser || positionState == null) {
      throw new Error(`userId=${config.userId} is not mapped in vault ${config.vaultAddress}`);
    }

    const targetHedgeNotionalWei = parseEther(position.hedgeNotional.toFixed(18));
    const syncNeeded =
      Boolean(positionState[0] !== "0x0000000000000000000000000000000000000000") &&
      (
        Boolean(positionState[1]) !== (position.positionSide === "long") ||
        positionState[2] !== targetHedgeNotionalWei ||
        positionState[7] !== (shouldHedge ? targetHedgeNotionalWei : 0n) ||
        Boolean(positionState[10]) !== targetHedgeIsLong
      );
    if (syncNeeded) {
      const syncData = encodeFunctionData({
        abi: KYUTE_VAULT_ABI,
        functionName: "syncHyperliquidPosition",
        args: [
          config.userId,
          position.positionSide === "long",
          targetHedgeNotionalWei,
          positionState[3],
          shouldHedge ? targetHedgeNotionalWei : 0n,
          targetHedgeIsLong,
          oracleTimestamp,
        ],
      });
      const syncTxHash = await walletClient.sendTransaction({
        account,
        chain: null,
        to: config.vaultAddress,
        data: syncData,
      } as any);
      await publicClient.waitForTransactionReceipt({ hash: syncTxHash });
      log(`syncHyperliquidPosition submitted: ${syncTxHash}`);
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
        BigInt(contractBorosAprBp),
        shouldHedge ? targetHedgeNotionalWei : 0n,
        oracleTimestamp,
        proofHash,
      ],
    });

    txHash = await walletClient.sendTransaction({
      account,
      chain: null,
      to: config.vaultAddress,
      data,
    } as any);

    await publicClient.waitForTransactionReceipt({ hash: txHash });
    log(`executeHedge submitted: ${txHash}`);
  } else {
    log("Onchain execution disabled: generated signed proof only.");
  }

  return {
    pair: PAIR,
    averageFundingBp: hlAprBp,
    positionSide: position.positionSide,
    hlSize: position.hlSize,
    markPrice: position.markPrice,
    hedgeNotional: position.hedgeNotional,
    hlAprBp,
    borosApr,
    predictedAprBp,
    borosAprBp: contractBorosAprBp,
    confidenceBp,
    shouldHedge,
    targetHedgeIsLong,
    exposure: decision.exposure,
    edgeBp: decision.edgeBp,
    proofHash,
    proofSignature,
    txHash,
  };
};
