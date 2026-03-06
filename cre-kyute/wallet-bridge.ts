import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isAddress, type Address } from "viem";

export type WalletBridgeRecord = {
  userId: string | number;
  walletAddress: Address;
  vaultAddress?: Address;
  chainId?: number | null;
  testnet?: boolean;
  signature?: `0x${string}`;
  message?: string;
  issuedAt: string;
  expiresAt: string;
  updatedAt: string;
};

type WalletBridgeStore = {
  records?: WalletBridgeRecord[];
};

type WalletBridgeDbRow = {
  user_id: number;
  wallet_address: string;
  vault_address: string | null;
  chain_id: number | null;
  testnet: boolean | null;
  issued_at: string | null;
  expires_at: string | null;
  signature: string | null;
  updated_at: string;
};

const DEFAULT_BRIDGE_FILE = "/tmp/kyute-wallet-bridge.json";
const USER_WALLET_TABLE = "kyute_user_wallets";

const toMillis = (value: string | undefined): number => {
  if (!value) return 0;
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
};

const resolveBridgeFile = (): string => {
  const configured = process.env.KYUTE_WALLET_BRIDGE_FILE?.trim();
  if (!configured || configured.length === 0) return DEFAULT_BRIDGE_FILE;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), "..", configured);
};

const isValidRecord = (record: unknown): record is WalletBridgeRecord => {
  if (!record || typeof record !== "object") return false;
  const candidate = record as WalletBridgeRecord;
  if (!/^\d+$/.test(String(candidate.userId ?? ""))) return false;
  if (!isAddress(String(candidate.walletAddress ?? ""))) return false;
  if (candidate.vaultAddress && !isAddress(String(candidate.vaultAddress))) return false;
  if (toMillis(candidate.expiresAt) <= Date.now()) return false;
  return true;
};

const mapDbRowToRecord = (row: WalletBridgeDbRow): WalletBridgeRecord => ({
  userId: row.user_id,
  walletAddress: row.wallet_address as Address,
  vaultAddress: row.vault_address ? (row.vault_address as Address) : undefined,
  chainId: row.chain_id,
  testnet: row.testnet ?? undefined,
  signature: row.signature ? (row.signature as `0x${string}`) : undefined,
  issuedAt: row.issued_at ?? new Date().toISOString(),
  expiresAt: row.expires_at ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  updatedAt: row.updated_at,
});

const readFileStore = (): WalletBridgeStore => {
  const bridgeFile = resolveBridgeFile();
  if (!fs.existsSync(bridgeFile)) {
    return { records: [] };
  }

  try {
    const raw = fs.readFileSync(bridgeFile, "utf8");
    const parsed = JSON.parse(raw) as WalletBridgeStore;
    return parsed;
  } catch {
    return { records: [] };
  }
};

const readFileRecord = (params: {
  userId?: bigint;
  walletAddress?: Address;
  vaultAddress?: Address;
}): WalletBridgeRecord | null => {
  const targetUserId = params.userId?.toString();
  const targetWallet = params.walletAddress?.toLowerCase();
  const targetVault = params.vaultAddress?.toLowerCase();

  const matches = (readFileStore().records ?? [])
    .filter(isValidRecord)
    .filter((record) => (targetUserId ? String(record.userId) === targetUserId : true))
    .filter((record) => (targetWallet ? record.walletAddress.toLowerCase() === targetWallet : true))
    .sort((left, right) => {
      const leftExactVault =
        !!targetVault &&
        !!left.vaultAddress &&
        left.vaultAddress.toLowerCase() === targetVault;
      const rightExactVault =
        !!targetVault &&
        !!right.vaultAddress &&
        right.vaultAddress.toLowerCase() === targetVault;
      if (leftExactVault !== rightExactVault) return leftExactVault ? -1 : 1;

      const leftUnscoped = !!targetVault && !left.vaultAddress;
      const rightUnscoped = !!targetVault && !right.vaultAddress;
      if (leftUnscoped !== rightUnscoped) return leftUnscoped ? -1 : 1;

      return toMillis(right.updatedAt) - toMillis(left.updatedAt);
    });

  return matches[0] ?? null;
};

const resolveSupabaseClient = () => {
  const supabaseUrl =
    process.env.CRE_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.CRE_SUPABASE_KEY ??
    process.env.SUPABASE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
};

export const readWalletBridgeRecord = async (params: {
  userId?: bigint;
  walletAddress?: Address;
  vaultAddress?: Address;
}): Promise<WalletBridgeRecord | null> => {
  const supabase = resolveSupabaseClient();
  if (!supabase) {
    return readFileRecord(params);
  }

  let query = supabase
    .from(USER_WALLET_TABLE)
    .select("user_id,wallet_address,vault_address,chain_id,testnet,issued_at,expires_at,signature,updated_at")
    .order("updated_at", { ascending: false })
    .limit(25);

  if (params.userId) {
    query = query.eq("user_id", Number(params.userId));
  }
  if (params.walletAddress) {
    query = query.eq("wallet_address", params.walletAddress.toLowerCase());
  }
  const { data, error } = await query;
  if (error) {
    console.error(`[wallet-bridge] Supabase read failed: ${error.message}`);
    return readFileRecord(params);
  }

  const records = (data ?? [])
    .map((row) => mapDbRowToRecord(row as WalletBridgeDbRow))
    .filter(isValidRecord)
    .sort((left, right) => {
      const targetVault = params.vaultAddress?.toLowerCase();
      const leftExactVault =
        !!targetVault &&
        !!left.vaultAddress &&
        left.vaultAddress.toLowerCase() === targetVault;
      const rightExactVault =
        !!targetVault &&
        !!right.vaultAddress &&
        right.vaultAddress.toLowerCase() === targetVault;
      if (leftExactVault !== rightExactVault) return leftExactVault ? -1 : 1;

      const leftUnscoped = !!targetVault && !left.vaultAddress;
      const rightUnscoped = !!targetVault && !right.vaultAddress;
      if (leftUnscoped !== rightUnscoped) return leftUnscoped ? -1 : 1;

      return toMillis(right.updatedAt) - toMillis(left.updatedAt);
    });

  return records[0] ?? readFileRecord(params);
};

export const resolveWalletUserId = async (params: {
  walletAddress: Address;
  vaultAddress?: Address;
}): Promise<bigint | null> => {
  const record = await readWalletBridgeRecord({
    walletAddress: params.walletAddress,
    vaultAddress: params.vaultAddress,
  });
  if (!record) return null;
  return BigInt(record.userId);
};
