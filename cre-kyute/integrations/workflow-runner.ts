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
import { predictFundingFromAprs } from "../ai/model";

const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
const DEFAULT_LOOKBACK_HOURS = 72;
const DEFAULT_CHAIN_ID = 42161;
const FEE_BUFFER_BP = 10;
const MIN_CONFIDENCE_BP = 6000;

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
  coin: string;
  userId: bigint;
  vaultAddress: Address;
  yuToken: Address;
  borosMarketAddress?: Address;
  subgraphUrl: string;
  rpcUrl: string;
  callbackPrivateKey: Hex;
  chainId?: number;
  executeOnchain?: boolean;
};

type WorkflowRunnerResult = {
  hlApr: number;
  borosApr: number;
  predictedApr: number;
  predictedAprBp: number;
  borosAprBp: number;
  confidenceBp: number;
  shouldHedge: boolean;
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

const fallbackPredictedFundingApr = async (coin: string): Promise<number> => {
  const data = await postJson<any[]>(HYPERLIQUID_INFO_URL, { type: "predictedFundings" });
  const coinData = data.find((item) => Array.isArray(item) && item[0] === coin);
  if (!coinData) return 0;

  const venues = (coinData[1] ?? []) as any[];
  const hlPerpEntry = venues.find((venue) => Array.isArray(venue) && venue[0] === "HlPerp");
  if (!hlPerpEntry) return 0;

  const fundingRate = Number(hlPerpEntry?.[1]?.fundingRate ?? hlPerpEntry?.[1]?.funding ?? 0);
  if (!Number.isFinite(fundingRate)) return 0;
  return fundingRate * 24 * 365;
};

const fetchHyperliquidFundingHistoryApr = async (
  coin: string,
  lookbackHours = DEFAULT_LOOKBACK_HOURS,
): Promise<{ apr: number; points: HyperliquidFundingPoint[] }> => {
  const startTime = Date.now() - lookbackHours * 60 * 60 * 1000;

  try {
    const response = await postJson<unknown[]>(HYPERLIQUID_INFO_URL, {
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
      const apr = await fallbackPredictedFundingApr(coin);
      return { apr, points: [] };
    }

    const averageFundingRate = points.reduce((sum, point) => sum + point.fundingRate, 0) / points.length;
    return {
      apr: averageFundingRate * 24 * 365,
      points,
    };
  } catch {
    const apr = await fallbackPredictedFundingApr(coin);
    return { apr, points: [] };
  }
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
  coin: string;
  vaultAddress: Address;
  yuToken: Address;
  hlApr: number;
  borosApr: number;
  predictedApr: number;
  confidenceBp: number;
  shouldHedge: boolean;
  observedFundingPoints: number;
  chainId: number;
}): string => {
  return JSON.stringify({
    type: "kYUteMvpNodeModeProof",
    version: 1,
    generatedAt: new Date().toISOString(),
    chainId: input.chainId,
    userId: input.userId.toString(),
    coin: input.coin,
    vaultAddress: input.vaultAddress,
    yuToken: input.yuToken,
    inputs: {
      hlApr: input.hlApr,
      borosApr: input.borosApr,
      observedFundingPoints: input.observedFundingPoints,
    },
    outputs: {
      predictedApr: input.predictedApr,
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

  const funding = await fetchHyperliquidFundingHistoryApr(config.coin);
  const borosApr = await fetchBorosImpliedApr(config.subgraphUrl, config.borosMarketAddress);
  const prediction = predictFundingFromAprs(funding.apr, borosApr);

  const confidenceBp = Math.floor(prediction.confidence);
  const predictedAprBp = toAprBp(prediction.apr);
  const borosAprBp = toAprBp(borosApr);
  const shouldHedge = predictedAprBp > borosAprBp + FEE_BUFFER_BP && confidenceBp >= MIN_CONFIDENCE_BP;

  const account = privateKeyToAccount(config.callbackPrivateKey);
  const proofPayload = buildProofPayload({
    userId: config.userId,
    coin: config.coin,
    vaultAddress: config.vaultAddress,
    yuToken: config.yuToken,
    hlApr: funding.apr,
    borosApr,
    predictedApr: prediction.apr,
    confidenceBp,
    shouldHedge,
    observedFundingPoints: funding.points.length,
    chainId,
  });

  const proofDigest = keccak256(toBytes(proofPayload));
  const proofSignature = await account.signMessage({ message: { raw: proofDigest } });
  const proofHash = keccak256(toBytes(`${proofDigest}:${proofSignature}`));

  log(
    `Decision for ${config.coin}: HL APR ${(funding.apr * 100).toFixed(3)}%, Boros APR ${(borosApr * 100).toFixed(3)}%, predicted ${(prediction.apr * 100).toFixed(3)}%, confidence ${confidenceBp}bp -> shouldHedge=${shouldHedge}`,
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
    hlApr: funding.apr,
    borosApr,
    predictedApr: prediction.apr,
    predictedAprBp,
    borosAprBp,
    confidenceBp,
    shouldHedge,
    proofHash,
    proofSignature,
    txHash,
  };
};
