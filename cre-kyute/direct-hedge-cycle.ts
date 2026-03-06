import dotenv from "dotenv";
import fs from "node:fs";
import path from "path";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  http,
  isAddress,
  parseEther,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createClient } from "@supabase/supabase-js";
import {
  computeHedgePolicy,
  type HedgeMode,
  type PositionSide,
} from "./hedge-policy.js";
import { buildHedgeExecutionPlan } from "./hedge-execution-plan.js";
import { fetchBorosImpliedAprQuote } from "./boros.js";
import { resolveUserHedgeMode } from "./strategy-config.js";
import { readWalletBridgeRecord, resolveWalletUserId } from "./wallet-bridge.js";

dotenv.config({ path: path.resolve(process.cwd(), "../contracts/.env"), quiet: true });

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_RPC_URL = "http://127.0.0.1:8545";
const DEFAULT_USER_ID = 123n;
const DEFAULT_YU_TOKEN = "0x0000000000000000000000000000000000000001";
const DEFAULT_PREDICTED_APR_BP = 10_000n;
const DEFAULT_CONFIDENCE_BP = 10_000n;
const FEE_BUFFER_BP = 10;
const MIN_CONFIDENCE_BP = 6_000;
const DEFAULT_PROOF_HASH = `0x${"11".repeat(32)}` as const;
const HL_MAINNET_INFO_URL = "https://api.hyperliquid.xyz/info";
const HL_TESTNET_INFO_URL = "https://api.hyperliquid-testnet.xyz/info";
const DEFAULT_HL_COIN = "ETH";
const DEFAULT_REBALANCE_THRESHOLD_BP = 100n; // 1.00%
const DEFAULT_MIN_REBALANCE_DELTA_WEI = 10_000_000_000_000_000n; // 0.01 ETH
const DEFAULT_ENTRY_THRESHOLD_BP = 40;
const DEFAULT_EXIT_THRESHOLD_BP = 10;
const DEFAULT_BOROS_OI_FEE_BP = 10;

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
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
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
  {
    type: "function",
    name: "borosRouter",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

type HyperliquidMetaAndCtxs = [
  { universe: Array<{ name: string }> },
  Array<{ markPx?: string; midPx?: string }>,
];

type HyperliquidFundingEntry = {
  fundingRate?: number | string;
  funding?: number | string;
  rate?: number | string;
  time?: number | string;
  timestamp?: number | string;
  t?: number | string;
};

const postJson = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json() as Promise<T>;
};

const ensureRpcReachable = async (rpcUrl: string): Promise<void> => {
  try {
    await postJson<{ result?: string }>(rpcUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_chainId",
      params: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `RPC unreachable at ${rpcUrl}. Start Anvil (e.g. 'anvil --port 8545') or set ANVIL_RPC_URL/DEMO_RPC_URL. Details: ${message}`,
    );
  }
};

const ensureContractDeployed = async (
  publicClient: any,
  address: Address,
  rpcUrl: string,
  label: string,
): Promise<void> => {
  const code = await publicClient.getBytecode({ address });
  if (!code || code === "0x") {
    throw new Error(
      `${label} ${address} has no bytecode on ${rpcUrl}. ` +
      "This usually means Anvil was restarted and contracts were not redeployed on this instance.",
    );
  }
};

const readRequiredAddress = (value: string | undefined, name: string): Address => {
  const candidate = String(value ?? "").trim();
  if (!isAddress(candidate)) throw new Error(`Missing or invalid ${name}: ${candidate || "<empty>"}`);
  return candidate;
};

const readOptionalAddress = (value: string | undefined): Address | null => {
  const candidate = String(value ?? "").trim();
  if (!candidate) return null;
  if (!isAddress(candidate)) {
    throw new Error(`Invalid address: ${candidate}`);
  }
  return candidate as Address;
};

const findLatestRunJson = (scriptDirName: string): string | null => {
  const broadcastRoot = path.resolve(process.cwd(), "../contracts/broadcast", scriptDirName);
  if (!fs.existsSync(broadcastRoot)) return null;

  let newestFile: string | null = null;
  let newestMtime = -1;
  for (const entry of fs.readdirSync(broadcastRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runLatest = path.join(broadcastRoot, entry.name, "run-latest.json");
    if (!fs.existsSync(runLatest)) continue;
    const mtime = fs.statSync(runLatest).mtimeMs;
    if (mtime > newestMtime) {
      newestMtime = mtime;
      newestFile = runLatest;
    }
  }
  return newestFile;
};

const parseVaultAddressFromRunJson = (runFile: string): Address | null => {
  try {
    const raw = fs.readFileSync(runFile, "utf8");
    const json = JSON.parse(raw) as {
      transactions?: Array<{ contractName?: string; contractAddress?: string; transactionType?: string }>;
      receipts?: Array<{ contractAddress?: string }>;
    };

    const txs = json.transactions ?? [];
    const preferredNames = new Set(["kYUteVault", "KyuteVault", "StabilityVault"]);
    const namedTx = txs.find((tx) => preferredNames.has(String(tx.contractName ?? "")) && isAddress(String(tx.contractAddress ?? "")));
    if (namedTx && isAddress(String(namedTx.contractAddress))) {
      return namedTx.contractAddress as Address;
    }

    const createTx = [...txs]
      .reverse()
      .find((tx) => String(tx.transactionType ?? "").toUpperCase() === "CREATE" && isAddress(String(tx.contractAddress ?? "")));
    if (createTx && isAddress(String(createTx.contractAddress))) {
      return createTx.contractAddress as Address;
    }

    const receiptAddr = [...(json.receipts ?? [])]
      .reverse()
      .find((receipt) => isAddress(String(receipt.contractAddress ?? "")));
    if (receiptAddr && isAddress(String(receiptAddr.contractAddress))) {
      return receiptAddr.contractAddress as Address;
    }
    return null;
  } catch {
    return null;
  }
};

const resolveVaultAddress = (): Address => {
  const explicitEnvCandidates: Array<[string, string | undefined]> = [
    ["KYUTE_VAULT_ADDRESS", process.env.KYUTE_VAULT_ADDRESS],
    ["VAULT_ADDRESS", process.env.VAULT_ADDRESS],
    ["KYUTE_VAULT_ADDRESS_OVERRIDE", process.env.KYUTE_VAULT_ADDRESS_OVERRIDE],
  ];
  for (const [key, value] of explicitEnvCandidates) {
    const candidate = String(value ?? "").trim();
    if (isAddress(candidate)) {
      console.log(`[direct-hedge] using vault from ${key}: ${candidate}`);
      return candidate as Address;
    }
  }

  const deployScriptDirs = ["DeployKyuteVault.s.sol", "DeployStabilityVault.s.sol"];
  for (const scriptDirName of deployScriptDirs) {
    const runFile = findLatestRunJson(scriptDirName);
    if (!runFile) continue;
    const discovered = parseVaultAddressFromRunJson(runFile);
    if (discovered) {
      console.log(`[direct-hedge] auto-discovered vault from ${path.relative(process.cwd(), runFile)}: ${discovered}`);
      return discovered;
    }
  }

  const stabilityVault = String(process.env.STABILITY_VAULT_ADDRESS ?? "").trim();
  if (isAddress(stabilityVault)) {
    console.log(`[direct-hedge] using vault from STABILITY_VAULT_ADDRESS: ${stabilityVault}`);
    return stabilityVault as Address;
  }

  throw new Error(
    "Missing KYUTE_VAULT_ADDRESS/VAULT_ADDRESS and could not auto-discover from contracts/broadcast/*/run-latest.json",
  );
};

const parseBigIntEnv = (name: string, fallback: bigint): bigint => {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return fallback;
  try {
    return BigInt(raw.trim());
  } catch {
    throw new Error(`Invalid bigint env ${name}: ${raw}`);
  }
};

const parseBoolEnv = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return fallback;
  return raw.trim().toLowerCase() === "true";
};

const parseOptionalBoolEnv = (name: string): boolean | null => {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return null;
  return raw.trim().toLowerCase() === "true";
};

const parseNumberEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return fallback;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid numeric env ${name}: ${raw}`);
  }
  return value;
};

const parseOptionalSignedNumberEnv = (name: string): number | null => {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return null;
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric env ${name}: ${raw}`);
  }
  return value;
};

const toWeiFromDecimal = (value: number): bigint => {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  // keep precision stable before parsing into a uint256 amount
  return parseEther(value.toFixed(18));
};

const resolveHyperliquidInfoUrl = (kind: "funding" | "position"): string => {
  const specificBaseUrl =
    kind === "funding"
      ? process.env.DEMO_HL_FUNDING_BASE_URL?.trim()
      : process.env.DEMO_HL_POSITION_BASE_URL?.trim();
  if (specificBaseUrl) return specificBaseUrl;

  const specificTestnet =
    kind === "funding"
      ? parseOptionalBoolEnv("DEMO_HL_FUNDING_TESTNET")
      : parseOptionalBoolEnv("DEMO_HL_POSITION_TESTNET");
  if (specificTestnet !== null) {
    return specificTestnet ? HL_TESTNET_INFO_URL : HL_MAINNET_INFO_URL;
  }

  if (process.env.DEMO_HL_BASE_URL?.trim()) return process.env.DEMO_HL_BASE_URL.trim();

  const legacyTestnet = parseOptionalBoolEnv("DEMO_HL_TESTNET");
  if (legacyTestnet !== null) {
    return legacyTestnet ? HL_TESTNET_INFO_URL : HL_MAINNET_INFO_URL;
  }

  return HL_MAINNET_INFO_URL;
};

const resolveConfiguredHedgeMode = (): HedgeMode => {
  const raw = (process.env.KYUTE_HEDGE_MODE ?? process.env.DEMO_HEDGE_MODE ?? "adverse_only")
    .trim()
    .toLowerCase();
  if (raw === "lock_fixed") return "lock_fixed";
  return "adverse_only";
};

const resolveLiveHyperliquidAddress = async (params: {
  userId?: bigint;
  vaultAddress: Address;
  mappedUser: Address;
}): Promise<{ address: Address | null; source: string }> => {
  const bridged = await readWalletBridgeRecord({
    userId: params.userId,
  });
  if (bridged) {
    return { address: bridged.walletAddress, source: "frontend_bridge" };
  }

  const allowDemoOverride = parseBoolEnv("KYUTE_ALLOW_DEMO_HL_ADDRESS", false);
  if (allowDemoOverride) {
    const envAddress = readOptionalAddress(process.env.HL_ADDRESS ?? process.env.DEMO_HL_ADDRESS);
    if (envAddress) {
      return { address: envAddress, source: "env_demo_override" };
    }
  }

  if (params.mappedUser.toLowerCase() !== ZERO_ADDRESS.toLowerCase()) {
    return { address: params.mappedUser, source: "vault_mapping" };
  }

  return { address: null, source: "unresolved" };
};

const resolveExecutionUserId = async (vaultAddress: Address): Promise<bigint> => {
  const envWallet = readOptionalAddress(process.env.HL_ADDRESS ?? process.env.DEMO_HL_ADDRESS);
  if (envWallet) {
    const bridgedUserId = await resolveWalletUserId({
      walletAddress: envWallet,
    });
    if (bridgedUserId !== null) {
      return bridgedUserId;
    }
  }

  const explicitUserId = process.env.DEMO_USER_ID?.trim();
  if (explicitUserId) {
    return parseBigIntEnv("DEMO_USER_ID", DEFAULT_USER_ID);
  }

  const latestBridgeRecord = await readWalletBridgeRecord({ vaultAddress });
  if (latestBridgeRecord) {
    return BigInt(latestBridgeRecord.userId);
  }

  const anyBridgeRecord = await readWalletBridgeRecord({});
  if (anyBridgeRecord) {
    return BigInt(anyBridgeRecord.userId);
  }

  return DEFAULT_USER_ID;
};

const fetchHyperliquidFundingBp = async (
  baseUrl: string,
  coin: string,
  lookbackHours: number,
): Promise<{ averageFundingBp: number; observedPoints: number; oracleTimestampSec: bigint }> => {
  const startTime = Date.now() - lookbackHours * 60 * 60 * 1000;
  const entries = await postJson<HyperliquidFundingEntry[]>(baseUrl, {
    type: "fundingHistory",
    coin,
    startTime,
  }).catch(async (): Promise<HyperliquidFundingEntry[]> => {
    const predicted = await postJson<any[]>(baseUrl, { type: "predictedFundings" });
    const coinData = predicted.find((item) => Array.isArray(item) && item[0] === coin);
    const venues = (coinData?.[1] ?? []) as any[];
    const hlPerpEntry = venues.find((venue) => Array.isArray(venue) && venue[0] === "HlPerp");
    const fundingRate = Number(hlPerpEntry?.[1]?.fundingRate ?? hlPerpEntry?.[1]?.funding ?? 0);
    return [{
      fundingRate,
      timestamp: Date.now(),
    }];
  });

  const points = entries
    .map((entry) => ({
      rate: Number(entry.fundingRate ?? entry.funding ?? entry.rate ?? NaN),
      timestampMs: Number(entry.time ?? entry.timestamp ?? entry.t ?? Date.now()),
    }))
    .filter((point) => Number.isFinite(point.rate));

  console.log(
    `[direct-hedge] funding fetch coin=${coin} windowHours=${lookbackHours} startMs=${startTime} entries=${entries.length} validPoints=${points.length}`,
  );

  if (points.length === 0) {
    console.log("[direct-hedge] funding fetch produced zero valid points; defaulting averageFundingBp=0");
    return {
      averageFundingBp: 0,
      observedPoints: 0,
      oracleTimestampSec: BigInt(Math.floor(Date.now() / 1000)),
    };
  }

  const averageFundingRate = points.reduce((sum, point) => sum + point.rate, 0) / points.length;
  const latestTimestampMs = points.reduce(
    (latest, point) => (point.timestampMs > latest ? point.timestampMs : latest),
    Date.now(),
  );
  const annualizedFundingBp = Math.round(averageFundingRate * 24 * 365 * 10_000);
  console.log(
    `[direct-hedge] funding computed coin=${coin} avgRatePerHour=${averageFundingRate} annualizedBp=${annualizedFundingBp} latestTsSec=${Math.floor(latestTimestampMs / 1000)}`,
  );

  return {
    averageFundingBp: annualizedFundingBp,
    observedPoints: points.length,
    oracleTimestampSec: BigInt(Math.floor(latestTimestampMs / 1000)),
  };
};

const fetchHyperliquidPositionSnapshot = async (
  userAddress: Address,
  baseUrl: string,
  coin: string,
): Promise<{ hlSize: number; markPrice: number; side: "long" | "short" }> => {
  const [metaAndCtxs, state] = await Promise.all([
    postJson<HyperliquidMetaAndCtxs>(baseUrl, { type: "metaAndAssetCtxs" }),
    postJson<{ assetPositions?: Array<{ position?: Record<string, unknown> }> }>(baseUrl, {
      type: "clearinghouseState",
      user: userAddress,
    }),
  ]);

  const [meta, assetCtxs] = metaAndCtxs;
  const coinUpper = coin.toUpperCase();
  const assetIndex = meta.universe.findIndex((asset) => String(asset.name ?? "").toUpperCase() === coinUpper);
  if (assetIndex < 0) {
    throw new Error(`Unable to locate ${coinUpper} in Hyperliquid universe`);
  }

  const markRaw = assetCtxs[assetIndex]?.markPx ?? assetCtxs[assetIndex]?.midPx;
  const markPrice = Number(markRaw ?? 0);
  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    throw new Error(`Unable to resolve valid mark price for ${coinUpper}`);
  }

  const positionEntry = (state.assetPositions ?? []).find((entry) => {
    const positionCoin = String(entry.position?.coin ?? "");
    return positionCoin.toUpperCase() === coinUpper;
  });
  const signedSize = Number(positionEntry?.position?.szi ?? 0);
  const hlSize = Math.abs(signedSize);
  const side: "long" | "short" = signedSize < 0 ? "short" : "long";

  return { hlSize, markPrice, side };
};

const pushSupabaseEvent = async (payload: {
  eventType: "snapshot" | "hedge";
  status: "success" | "failed" | "skipped";
  reason: string;
  action?: string;
  amountEth: number;
  vaultBalanceEth: number;
  spreadBps: number;
  marketAddress: Address;
  borosAprBp?: number;
  hlAprBp?: number;
}) => {
  const supabaseUrl = process.env.CRE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const supabaseKey = process.env.CRE_SUPABASE_KEY ?? process.env.SUPABASE_KEY ?? "";
  if (!supabaseUrl || !supabaseKey) return;

  const supabase = createClient(supabaseUrl, supabaseKey);
  const row = {
    timestamp: new Date().toISOString(),
    asset_symbol: "ETH",
    event_type: payload.eventType,
    boros_apr: Number(payload.borosAprBp ?? 0) / 100,
    hl_apr: Number(payload.hlAprBp ?? DEFAULT_PREDICTED_APR_BP) / 100,
    spread_bps: payload.spreadBps,
    vault_balance_eth: payload.vaultBalanceEth,
    amount_eth: payload.amountEth,
    market_address: payload.marketAddress,
    status: payload.status,
    reason: payload.reason,
    action:
      payload.action ??
      (payload.eventType === "snapshot"
        ? "SNAPSHOT"
        : payload.status === "success"
          ? "HEDGE"
          : "SKIP"),
  };

  const { error } = await supabase.from("kyute_events").insert(row);
  if (error) {
    console.error(`[direct-hedge] Supabase insert failed: ${error.message}`);
  }
};

async function main() {
  const rpcUrl = process.env.DEMO_RPC_URL ?? process.env.ANVIL_RPC_URL ?? DEFAULT_RPC_URL;
  const privateKey = (process.env.CRE_SIM_PRIVATE_KEY ?? process.env.ANVIL_PRIVATE_KEY ?? process.env.PRIVATE_KEY ?? "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("Missing CRE_SIM_PRIVATE_KEY/ANVIL_PRIVATE_KEY/PRIVATE_KEY");
  }

  await ensureRpcReachable(rpcUrl);
  const vaultAddress = resolveVaultAddress();
  const yuToken = readRequiredAddress(process.env.BOROS_YU_TOKEN ?? DEFAULT_YU_TOKEN, "BOROS_YU_TOKEN");

  const userId = await resolveExecutionUserId(vaultAddress);
  const confidenceBp = parseBigIntEnv("DEMO_CONFIDENCE_BP", DEFAULT_CONFIDENCE_BP);
  const oracleTimestampOverride = process.env.DEMO_ORACLE_TIMESTAMP?.trim()
    ? parseBigIntEnv("DEMO_ORACLE_TIMESTAMP", BigInt(Math.floor(Date.now() / 1000)))
    : null;
  const forceHedgeOverride = parseOptionalBoolEnv("DEMO_FORCE_HEDGE") ?? parseOptionalBoolEnv("DEMO_SHOULD_HEDGE");
  const proofHash = (process.env.DEMO_PROOF_HASH ?? DEFAULT_PROOF_HASH) as `0x${string}`;
  const rebalanceThresholdBp = parseBigIntEnv("DEMO_REBALANCE_THRESHOLD_BP", DEFAULT_REBALANCE_THRESHOLD_BP);
  const minRebalanceDeltaWei = parseBigIntEnv("DEMO_MIN_REBALANCE_DELTA_WEI", DEFAULT_MIN_REBALANCE_DELTA_WEI);
  const fundingWindowHours = parseNumberEnv("DEMO_HL_WINDOW_HOURS", 1);
  const entryThresholdBp = parseNumberEnv("DEMO_ENTRY_THRESHOLD_BP", DEFAULT_ENTRY_THRESHOLD_BP);
  const exitThresholdBp = parseNumberEnv("DEMO_EXIT_THRESHOLD_BP", DEFAULT_EXIT_THRESHOLD_BP);
  const borosOiFeeBp = parseNumberEnv("DEMO_BOROS_OI_FEE_BP", DEFAULT_BOROS_OI_FEE_BP);
  const configuredHedgeMode = resolveConfiguredHedgeMode();

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, transport: http(rpcUrl), chain: undefined });
  await ensureContractDeployed(publicClient, vaultAddress, rpcUrl, "Vault");

  let mappedUser = (await publicClient.readContract({
    address: vaultAddress,
    abi: KYUTE_VAULT_ABI,
    functionName: "userIdToAddress",
    args: [userId],
  } as any)) as Address;
  const hlCoinDefault = (process.env.DEMO_HL_COIN ?? DEFAULT_HL_COIN).trim().toUpperCase();
  const hlFundingUrl = resolveHyperliquidInfoUrl("funding");
  const hlPositionUrl = resolveHyperliquidInfoUrl("position");
  const useMarkPrice = parseBoolEnv("DEMO_HEDGE_NOTIONAL_USE_MARK_PRICE", false);
  const notionalRatio = parseNumberEnv("DEMO_HEDGE_NOTIONAL_RATIO", 1);
  const hlAddressResolution = await resolveLiveHyperliquidAddress({
    userId,
    vaultAddress,
    mappedUser,
  });
  if (hlFundingUrl !== hlPositionUrl) {
    console.log(
      `[direct-hedge] using separate HL endpoints fundingUrl=${hlFundingUrl} positionUrl=${hlPositionUrl}`,
    );
  }
  const hlLookupAddress = hlAddressResolution.address;
  if (!hlLookupAddress && mappedUser.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
    console.log(`[direct-hedge] userId=${userId} has no registered wallet; skipping`);
    return;
  }
  if (hlLookupAddress && mappedUser.toLowerCase() !== hlLookupAddress.toLowerCase()) {
    const syncUserData = encodeFunctionData({
      abi: KYUTE_VAULT_ABI,
      functionName: "syncUserAddress",
      args: [userId, hlLookupAddress],
    });
    const syncUserTxHash = await walletClient.sendTransaction({
      account,
      to: vaultAddress,
      data: syncUserData,
      chain: undefined,
    } as any);
    const syncUserReceipt = await publicClient.waitForTransactionReceipt({ hash: syncUserTxHash });
    if (syncUserReceipt.status !== "success") {
      throw new Error(`syncUserAddress failed tx=${syncUserTxHash}`);
    }
    mappedUser = hlLookupAddress;
    console.log(`[direct-hedge] synced user mapping tx=${syncUserTxHash} userId=${userId} wallet=${hlLookupAddress}`);
  }

  const positionBefore = mappedUser.toLowerCase() === ZERO_ADDRESS.toLowerCase()
    ? ([ZERO_ADDRESS, false, 0n, 0n, false, ZERO_ADDRESS, 0n, 0n, 0n, false, false] as const)
    : ((await publicClient.readContract({
        address: vaultAddress,
        abi: KYUTE_VAULT_ABI,
        functionName: "userPositions",
        args: [mappedUser],
      } as any)) as readonly [Address, boolean, bigint, bigint, boolean, Address, bigint, bigint, bigint, boolean, boolean]);
  const positionAsset = positionBefore[0];
  const storedIsLong = Boolean(positionBefore[1]);
  const storedNotionalWei = positionBefore[2];
  const storedLeverage = positionBefore[3];
  const hasBorosHedgeBefore = Boolean(positionBefore[4]);
  const storedYuToken = positionBefore[5];
  const storedTargetHedgeNotionalWei = positionBefore[7];
  const storedCurrentHedgeNotionalWei = positionBefore[8];
  const storedCurrentHedgeIsLong = Boolean(positionBefore[9]);
  const storedTargetHedgeIsLong = Boolean(positionBefore[10]);

  const vaultBalanceWeiBefore = (await publicClient.readContract({
    address: vaultAddress,
    abi: KYUTE_VAULT_ABI,
    functionName: "totalAssets",
  } as any)) as bigint;
  const routerAddress = (await publicClient.readContract({
    address: vaultAddress,
    abi: KYUTE_VAULT_ABI,
    functionName: "borosRouter",
  } as any)) as Address;
  const vaultBalanceEthBefore = Number(formatEther(vaultBalanceWeiBefore));

  const allowStoredPositionFallback = parseBoolEnv("KYUTE_ALLOW_STORED_POSITION_FALLBACK", false);
  const manualNotional = allowStoredPositionFallback ? process.env.DEMO_HEDGE_NOTIONAL_WEI?.trim() : "";
  let hlPositionNotionalWei = 0n;
  let proposedTargetHedgeNotionalWei = 0n;
  let hlPositionIsLong = storedIsLong;
  let hlSize = 0;
  let hlMarkPrice = 0;
  let hlSide: PositionSide = storedIsLong ? "long" : "short";
  let targetSource = "unresolved";
  const envFundingOverride = parseOptionalSignedNumberEnv("DEMO_HL_FUNDING_BP");
  let averageFundingBp = envFundingOverride ?? 0;
  const borosQuote = await fetchBorosImpliedAprQuote(hlCoinDefault, {
    marketAddress: process.env.BOROS_MARKET_ADDRESS,
    coreApiUrl: process.env.BOROS_CORE_API_URL,
  });
  const borosImpliedAprBp = borosQuote.aprBp;
  const borosMarketAddress = readOptionalAddress(borosQuote.marketAddress ?? undefined) ?? routerAddress;
  let oracleTimestamp = oracleTimestampOverride ?? BigInt(Math.floor(Date.now() / 1000));
  console.log(
    `[direct-hedge] boros apr source=live coin=${hlCoinDefault} market=${borosMarketAddress} aprBp=${borosImpliedAprBp}`,
  );
  if (hlLookupAddress) {
    const snapshot = await fetchHyperliquidPositionSnapshot(hlLookupAddress, hlPositionUrl, hlCoinDefault);
    const funding = averageFundingBp === 0
      ? await fetchHyperliquidFundingBp(hlFundingUrl, hlCoinDefault, fundingWindowHours)
      : null;
    if (envFundingOverride !== null) {
      console.log(`[direct-hedge] using DEMO_HL_FUNDING_BP override=${envFundingOverride}; skipping HL funding fetch`);
    }
    hlSize = snapshot.hlSize;
    hlMarkPrice = snapshot.markPrice;
    hlSide = snapshot.side;
    hlPositionIsLong = snapshot.side === "long";
    const positionNotional = (useMarkPrice ? hlSize * hlMarkPrice : hlSize) * notionalRatio;
    hlPositionNotionalWei = toWeiFromDecimal(positionNotional);
    proposedTargetHedgeNotionalWei = hlPositionNotionalWei;
    if (funding) {
      averageFundingBp = funding.averageFundingBp;
      if (oracleTimestampOverride == null) {
        oracleTimestamp = funding.oracleTimestampSec;
      }
      console.log(
        `[direct-hedge] funding selected source=hyperliquid averageFundingBp=${averageFundingBp} observedPoints=${funding.observedPoints} oracleTs=${oracleTimestamp}`,
      );
    } else {
      console.log(
        `[direct-hedge] funding selected source=env_or_default averageFundingBp=${averageFundingBp} oracleTs=${oracleTimestamp}`,
      );
    }

    targetSource = `hyperliquid_${hlAddressResolution.source}`;
    console.log(
      `[direct-hedge] derived target from HL: wallet=${hlLookupAddress} source=${hlAddressResolution.source} size=${hlSize.toFixed(6)} coin=${hlCoinDefault} mark=${hlMarkPrice.toFixed(4)} side=${hlSide} fundingBp=${averageFundingBp} useMark=${useMarkPrice} ratio=${notionalRatio} targetWei=${proposedTargetHedgeNotionalWei}`,
    );
  } else if (manualNotional && manualNotional.length > 0) {
    hlPositionNotionalWei = BigInt(manualNotional);
    proposedTargetHedgeNotionalWei = hlPositionNotionalWei;
    targetSource = "manual_fallback";
    console.log(`[direct-hedge] using manual DEMO_HEDGE_NOTIONAL_WEI=${proposedTargetHedgeNotionalWei}`);
  } else if (allowStoredPositionFallback) {
    hlPositionNotionalWei = storedNotionalWei;
    proposedTargetHedgeNotionalWei = storedTargetHedgeNotionalWei > 0n ? storedTargetHedgeNotionalWei : storedNotionalWei;
    targetSource = "stored_fallback";
    console.log(
      `[direct-hedge] no live HL wallet resolved; using stored fallback mappedUser=${mappedUser} storedNotionalWei=${storedNotionalWei} storedTargetWei=${storedTargetHedgeNotionalWei}`,
    );
  } else {
    throw new Error(
      `No live Hyperliquid wallet resolved for userId=${userId} vault=${vaultAddress}. Register from frontend or map the wallet on-chain.`,
    );
  }

  // If we didn't fetch funding from HL (no address) and no env override, fetch public funding to avoid silent zero.
  if (averageFundingBp === 0 && envFundingOverride === null) {
    try {
      const funding = await fetchHyperliquidFundingBp(hlFundingUrl, hlCoinDefault, fundingWindowHours);
      averageFundingBp = funding.averageFundingBp;
      if (oracleTimestampOverride == null) {
        oracleTimestamp = funding.oracleTimestampSec;
      }
      console.log(
        `[direct-hedge] funding selected source=hyperliquid_public averageFundingBp=${averageFundingBp} observedPoints=${funding.observedPoints} oracleTs=${oracleTimestamp} coin=${hlCoinDefault}`,
      );
    } catch (error) {
      console.log(`[direct-hedge] funding public fetch failed; continuing with averageFundingBp=0 reason=${(error as Error).message}`);
    }
  }

  const strategyMode = await resolveUserHedgeMode({
    userId,
    walletAddress: hlLookupAddress ?? (mappedUser.toLowerCase() === ZERO_ADDRESS.toLowerCase() ? null : mappedUser),
    vaultAddress,
    fallbackMode: configuredHedgeMode,
    logger: (message) => console.log(`[direct-hedge] ${message}`),
  });
  const hedgeMode = strategyMode.mode;
  console.log(
    `[direct-hedge] strategy mode source=${strategyMode.source} mode=${hedgeMode} wallet=${hlLookupAddress ?? mappedUser} userId=${userId}`,
  );
  if (strategyMode.warning) {
    console.log(`[direct-hedge] strategy mode warning=${strategyMode.warning}`);
  }

  console.log(
    `[direct-hedge] policy inputs side=${hlSide} averageFundingBp=${averageFundingBp} borosImpliedAprBp=${borosImpliedAprBp} confidenceBp=${confidenceBp} mode=${hedgeMode} entryBp=${entryThresholdBp} exitBp=${exitThresholdBp} oiFeeBp=${borosOiFeeBp}`,
  );

  const decision = computeHedgePolicy({
    positionSide: hlSide,
    averageFundingBp,
    borosImpliedAprBp,
    confidenceBp: Number(confidenceBp),
    hasExistingHedge: hasBorosHedgeBefore,
    existingHedgeIsLong: storedCurrentHedgeIsLong,
    entryThresholdBp,
    exitThresholdBp,
    minConfidenceBp: MIN_CONFIDENCE_BP,
    oiFeeBp: borosOiFeeBp,
    mode: hedgeMode,
  });
  if (forceHedgeOverride !== null) {
    targetSource = `${targetSource}+forced`;
  }
  const executionPlan = buildHedgeExecutionPlan({
    decision,
    proposedTargetHedgeNotionalWei,
    currentHedgeWei: storedCurrentHedgeNotionalWei,
    hasExistingHedge: hasBorosHedgeBefore,
    currentHedgeIsLong: storedCurrentHedgeIsLong,
    rebalanceThresholdBp,
    minRebalanceDeltaWei,
    forceHedgeOverride,
  });
  const targetHedgeIsLong = executionPlan.targetHedgeIsLong;
  const targetHedgeNotionalWei = executionPlan.targetHedgeNotionalWei;
  const shouldHedge = executionPlan.shouldHedge;
  if (targetHedgeNotionalWei === 0n) {
    console.log("[direct-hedge] target notional is zero; forcing shouldHedge=false for this cycle");
  }

  const currentHedgeWei = storedCurrentHedgeNotionalWei;
  const proposedDeltaWei = executionPlan.proposedDeltaWei;
  const requiredDeltaWei = executionPlan.requiredDeltaWei;
  const driftBelowThreshold = executionPlan.driftBelowThreshold;
  const targetDeltaWei = executionPlan.targetDeltaWei;

  const leverageForSync = storedLeverage > 0n ? storedLeverage : 1n;
  const syncNeeded =
    (positionAsset == ZERO_ADDRESS && hlPositionNotionalWei > 0n) ||
    (
      positionAsset != ZERO_ADDRESS &&
      (
        hlPositionIsLong !== storedIsLong ||
        hlPositionNotionalWei !== storedNotionalWei ||
        targetHedgeNotionalWei !== storedTargetHedgeNotionalWei ||
        targetHedgeIsLong !== storedTargetHedgeIsLong
      )
    );

  if (syncNeeded) {
    const syncData = encodeFunctionData({
      abi: KYUTE_VAULT_ABI,
      functionName: "syncHyperliquidPosition",
      args: [
        userId,
        hlPositionIsLong,
        hlPositionNotionalWei,
        leverageForSync,
        targetHedgeNotionalWei,
        targetHedgeIsLong,
        oracleTimestamp,
      ],
    });
    const syncTxHash = await walletClient.sendTransaction({
      account,
      to: vaultAddress,
      data: syncData,
      chain: undefined,
    } as any);
    const syncReceipt = await publicClient.waitForTransactionReceipt({ hash: syncTxHash });
    if (syncReceipt.status !== "success") {
      throw new Error(`syncHyperliquidPosition failed tx=${syncTxHash}`);
    }
    console.log(
      `[direct-hedge] synced HL state tx=${syncTxHash} source=${targetSource} hlIsLong=${hlPositionIsLong} targetHedgeIsLong=${targetHedgeIsLong} notional=${formatEther(hlPositionNotionalWei)} target=${formatEther(targetHedgeNotionalWei)}`,
    );
  }

  const hedgeAlreadyMatches =
    executionPlan.hedgeAlreadyMatches &&
    storedYuToken.toLowerCase() === yuToken.toLowerCase();
  const executeNeeded =
    (!shouldHedge && hasBorosHedgeBefore) ||
    (shouldHedge && (!hasBorosHedgeBefore || !hedgeAlreadyMatches));

  let contractPredictedAprBp = BigInt(Math.round(decision.carrySourceAprBp));
  const contractBorosAprBp = BigInt(Math.round(decision.carryCostAprBp));
  if (
    shouldHedge &&
    forceHedgeOverride === true &&
    contractPredictedAprBp <= contractBorosAprBp + BigInt(Number(FEE_BUFFER_BP))
  ) {
    contractPredictedAprBp = contractBorosAprBp + BigInt(Math.max(entryThresholdBp, Number(FEE_BUFFER_BP) + 1));
  }

  let lastTxHash: `0x${string}` | null = null;
  if (!executeNeeded) {
    console.log(
      `[direct-hedge] skip user=${mappedUser} shouldHedge=${shouldHedge} hasHedge=${hasBorosHedgeBefore} ` +
      `currentWei=${currentHedgeWei} targetWei=${targetHedgeNotionalWei} targetDeltaWei=${targetDeltaWei} requiredDeltaWei=${requiredDeltaWei} ` +
      `exposure=${decision.exposure} edge=${decision.edgeBp}bp reason=${decision.reason}`,
    );
    await pushSupabaseEvent({
      eventType: "snapshot",
      status: "skipped",
      reason:
        `no_state_transition shouldHedge=${shouldHedge} hasBorosHedge=${hasBorosHedgeBefore} currentWei=${currentHedgeWei} ` +
        `targetWei=${targetHedgeNotionalWei} targetDeltaWei=${targetDeltaWei} requiredDeltaWei=${requiredDeltaWei} ` +
        `source=${targetSource} driftBelowThreshold=${driftBelowThreshold} exposure=${decision.exposure} ` +
        `targetHedgeIsLong=${targetHedgeIsLong} averageFundingBp=${averageFundingBp} edgeBp=${decision.edgeBp} ` +
        `reason=${decision.reason} vault=${vaultAddress}`,
      amountEth: 0,
      vaultBalanceEth: vaultBalanceEthBefore,
      spreadBps: decision.edgeBp,
      marketAddress: borosMarketAddress,
      borosAprBp: borosImpliedAprBp,
      hlAprBp: averageFundingBp,
    });
    return;
  }

  const txData = encodeFunctionData({
    abi: KYUTE_VAULT_ABI,
    functionName: "executeHedge",
    args: [
      userId,
      shouldHedge,
      yuToken,
      contractPredictedAprBp,
      confidenceBp,
      contractBorosAprBp,
      targetHedgeNotionalWei,
      oracleTimestamp,
      proofHash,
    ],
  });
  const txHash = await walletClient.sendTransaction({
    account,
    to: vaultAddress,
    data: txData,
    chain: undefined,
  } as any);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  lastTxHash = txHash;
  const status = receipt.status === "success" ? "success" : "failed";
  if (status !== "success") {
    throw new Error(`executeHedge failed tx=${txHash}`);
  }

  const positionAfter = (await publicClient.readContract({
    address: vaultAddress,
    abi: KYUTE_VAULT_ABI,
    functionName: "userPositions",
    args: [mappedUser],
  } as any)) as readonly [Address, boolean, bigint, bigint, boolean, Address, bigint, bigint, bigint, boolean, boolean];
  const hasBorosHedgeAfter = Boolean(positionAfter[4]);
  const yuTokenAfter = positionAfter[5];
  const currentHedgeWeiAfter = positionAfter[8];
  const currentHedgeIsLongAfter = Boolean(positionAfter[9]);
  const vaultBalanceWei = (await publicClient.readContract({
    address: vaultAddress,
    abi: KYUTE_VAULT_ABI,
    functionName: "totalAssets",
  } as any)) as bigint;
  const vaultBalanceEth = Number(formatEther(vaultBalanceWei));

  let action = shouldHedge ? "OPEN_HEDGE" : "CLOSE_HEDGE";
  let eventAmountWei = shouldHedge ? currentHedgeWeiAfter : currentHedgeWei;
  if (hasBorosHedgeBefore && hasBorosHedgeAfter) {
    action = "REBALANCE_HEDGE";
    eventAmountWei = currentHedgeWeiAfter;
  }

  console.log(
    `[direct-hedge] executeHedge ${status} tx=${txHash} user=${mappedUser} shouldHedge=${shouldHedge} before=${hasBorosHedgeBefore} after=${hasBorosHedgeAfter} amountEth=${Number(formatEther(eventAmountWei)).toFixed(4)} vaultBalanceEth=${vaultBalanceEth.toFixed(4)} action=${action}`,
  );

  await pushSupabaseEvent({
    eventType: "hedge",
    status,
    reason:
      `tx=${txHash} shouldHedge=${shouldHedge} before=${hasBorosHedgeBefore} after=${hasBorosHedgeAfter} ` +
      `hlPositionIsLong=${hlPositionIsLong} targetHedgeIsLong=${targetHedgeIsLong} currentWeiBefore=${currentHedgeWei} currentWeiAfter=${currentHedgeWeiAfter} ` +
      `targetWei=${targetHedgeNotionalWei} targetDeltaWei=${targetDeltaWei} source=${targetSource} exposure=${decision.exposure} ` +
      `averageFundingBp=${averageFundingBp} edgeBp=${decision.edgeBp} carrySourceBp=${decision.carrySourceAprBp} carryCostBp=${decision.carryCostAprBp} ` +
      `yuTokenBefore=${storedYuToken} yuTokenAfter=${yuTokenAfter} hedgeSideAfter=${currentHedgeIsLongAfter} vault=${vaultAddress}`,
    action,
    amountEth: Number(formatEther(eventAmountWei)),
    vaultBalanceEth,
    spreadBps: decision.edgeBp,
    marketAddress: borosMarketAddress,
    borosAprBp: borosImpliedAprBp,
    hlAprBp: averageFundingBp,
  });

  const finalVaultBalanceWei = (await publicClient.readContract({
    address: vaultAddress,
    abi: KYUTE_VAULT_ABI,
    functionName: "totalAssets",
  } as any)) as bigint;
  const finalVaultBalanceEth = Number(formatEther(finalVaultBalanceWei));
  await pushSupabaseEvent({
    eventType: "snapshot",
    status: "success",
    reason:
      `vault_balance_update tx=${lastTxHash ?? "none"} shouldHedge=${shouldHedge} currentWei=${currentHedgeWei} ` +
      `targetWei=${targetHedgeNotionalWei} targetDeltaWei=${targetDeltaWei} source=${targetSource} ` +
      `targetHedgeIsLong=${targetHedgeIsLong} averageFundingBp=${averageFundingBp} edgeBp=${decision.edgeBp} vault=${vaultAddress}`,
    amountEth: 0,
    vaultBalanceEth: finalVaultBalanceEth,
    spreadBps: decision.edgeBp,
    marketAddress: borosMarketAddress,
    borosAprBp: borosImpliedAprBp,
    hlAprBp: averageFundingBp,
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[direct-hedge] cycle failed: ${message}`);
  process.exit(1);
});
