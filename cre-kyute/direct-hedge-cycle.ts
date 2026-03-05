import dotenv from "dotenv";
import path from "path";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  http,
  isAddress,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(process.cwd(), "../contracts/.env"), quiet: true });

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_RPC_URL = "http://127.0.0.1:8545";
const DEFAULT_USER_ID = 123n;
const DEFAULT_YU_TOKEN = "0x0000000000000000000000000000000000000001";
const DEFAULT_HEDGE_NOTIONAL_WEI = 1_000_000_000_000_000_000n; // 1 ETH
const DEFAULT_PREDICTED_APR_BP = 10_000n;
const DEFAULT_CONFIDENCE_BP = 10_000n;
const DEFAULT_BOROS_APR_BP = 0n;
const DEFAULT_PROOF_HASH = `0x${"11".repeat(32)}` as const;

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

const readRequiredAddress = (value: string | undefined, name: string): Address => {
  const candidate = String(value ?? "").trim();
  if (!isAddress(candidate)) throw new Error(`Missing or invalid ${name}: ${candidate || "<empty>"}`);
  return candidate;
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

const pushSupabaseEvent = async (payload: {
  eventType: "snapshot" | "hedge";
  status: "success" | "failed" | "skipped";
  reason: string;
  action?: string;
  amountEth: number;
  vaultBalanceEth: number;
  spreadBps: number;
  marketAddress: Address;
}) => {
  const supabaseUrl = process.env.CRE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const supabaseKey = process.env.CRE_SUPABASE_KEY ?? process.env.SUPABASE_KEY ?? "";
  if (!supabaseUrl || !supabaseKey) return;

  const supabase = createClient(supabaseUrl, supabaseKey);
  const row = {
    timestamp: new Date().toISOString(),
    asset_symbol: "ETH",
    event_type: payload.eventType,
    boros_apr: Number(DEFAULT_BOROS_APR_BP) / 100,
    hl_apr: Number(DEFAULT_PREDICTED_APR_BP) / 100,
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

  const vaultAddress = readRequiredAddress(
    process.env.KYUTE_VAULT_ADDRESS ?? process.env.VAULT_ADDRESS ?? process.env.KYUTE_VAULT_ADDRESS_OVERRIDE,
    "KYUTE_VAULT_ADDRESS",
  );
  const yuToken = readRequiredAddress(process.env.BOROS_YU_TOKEN ?? DEFAULT_YU_TOKEN, "BOROS_YU_TOKEN");

  const userId = parseBigIntEnv("DEMO_USER_ID", DEFAULT_USER_ID);
  const hedgeNotionalWei = parseBigIntEnv("DEMO_HEDGE_NOTIONAL_WEI", DEFAULT_HEDGE_NOTIONAL_WEI);
  const predictedAprBp = parseBigIntEnv("DEMO_PREDICTED_APR_BP", DEFAULT_PREDICTED_APR_BP);
  const confidenceBp = parseBigIntEnv("DEMO_CONFIDENCE_BP", DEFAULT_CONFIDENCE_BP);
  const borosAprBp = parseBigIntEnv("DEMO_BOROS_APR_BP", DEFAULT_BOROS_APR_BP);
  const oracleTimestamp = parseBigIntEnv("DEMO_ORACLE_TIMESTAMP", BigInt(Math.floor(Date.now() / 1000)));
  const shouldHedge = parseBoolEnv("DEMO_SHOULD_HEDGE", true);
  const proofHash = (process.env.DEMO_PROOF_HASH ?? DEFAULT_PROOF_HASH) as `0x${string}`;

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, transport: http(rpcUrl), chain: undefined });

  const mappedUser = (await publicClient.readContract({
    address: vaultAddress,
    abi: KYUTE_VAULT_ABI,
    functionName: "userIdToAddress",
    args: [userId],
  } as any)) as Address;

  if (mappedUser.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
    console.log(`[direct-hedge] userId=${userId} not mapped; skipping`);
    return;
  }

  const positionBefore = (await publicClient.readContract({
    address: vaultAddress,
    abi: KYUTE_VAULT_ABI,
    functionName: "userPositions",
    args: [mappedUser],
  } as any)) as readonly [Address, boolean, bigint, bigint, boolean, Address, bigint];
  const hasBorosHedgeBefore = Boolean(positionBefore[4]);

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

  if (shouldHedge === hasBorosHedgeBefore) {
    console.log(
      `[direct-hedge] skip user=${mappedUser} shouldHedge=${shouldHedge} hasBorosHedge=${hasBorosHedgeBefore} vaultBalanceEth=${vaultBalanceEthBefore.toFixed(4)}`,
    );
    await pushSupabaseEvent({
      eventType: "snapshot",
      status: "skipped",
      reason: `no_state_transition shouldHedge=${shouldHedge} hasBorosHedge=${hasBorosHedgeBefore}`,
      amountEth: 0,
      vaultBalanceEth: vaultBalanceEthBefore,
      spreadBps: Number(predictedAprBp - borosAprBp),
      marketAddress: routerAddress,
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
      predictedAprBp,
      confidenceBp,
      borosAprBp,
      hedgeNotionalWei,
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

  const positionAfter = (await publicClient.readContract({
    address: vaultAddress,
    abi: KYUTE_VAULT_ABI,
    functionName: "userPositions",
    args: [mappedUser],
  } as any)) as readonly [Address, boolean, bigint, bigint, boolean, Address, bigint];
  const hasBorosHedgeAfter = Boolean(positionAfter[4]);
  const stateChanged = hasBorosHedgeAfter !== hasBorosHedgeBefore;

  const vaultBalanceWei = (await publicClient.readContract({
    address: vaultAddress,
    abi: KYUTE_VAULT_ABI,
    functionName: "totalAssets",
  } as any)) as bigint;
  const amountEth = Number(formatEther(hedgeNotionalWei));
  const vaultBalanceEth = Number(formatEther(vaultBalanceWei));
  const reason = `tx=${txHash} stateChanged=${stateChanged}`;
  const status = receipt.status === "success" ? "success" : "failed";

  console.log(
    `[direct-hedge] executeHedge ${status} tx=${txHash} user=${mappedUser} shouldHedge=${shouldHedge} before=${hasBorosHedgeBefore} after=${hasBorosHedgeAfter} amountEth=${amountEth.toFixed(4)} vaultBalanceEth=${vaultBalanceEth.toFixed(4)}`,
  );

  if (stateChanged) {
    await pushSupabaseEvent({
      eventType: "hedge",
      status,
      reason: `tx=${txHash} shouldHedge=${shouldHedge} before=${hasBorosHedgeBefore} after=${hasBorosHedgeAfter} stateChanged=${stateChanged}`,
      action: shouldHedge ? "OPEN_HEDGE" : "CLOSE_HEDGE",
      amountEth,
      vaultBalanceEth,
      spreadBps: Number(predictedAprBp - borosAprBp),
      marketAddress: routerAddress,
    });
  }

  await pushSupabaseEvent({
    eventType: "snapshot",
    status: "success",
    reason: `vault_balance_update tx=${txHash}`,
    amountEth: 0,
    vaultBalanceEth,
    spreadBps: Number(predictedAprBp - borosAprBp),
    marketAddress: routerAddress,
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[direct-hedge] cycle failed: ${message}`);
  process.exit(1);
});
