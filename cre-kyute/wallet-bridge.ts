import fs from "node:fs";
import path from "node:path";
import { isAddress, type Address } from "viem";
import {
  resolveSupabaseRestConfig,
  type SupabaseRestFetch,
  selectSupabaseRows,
} from "./supabase-rest.js";

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

type SupabaseResolverOptions = {
  supabaseUrl?: string;
  supabaseKey?: string;
  disableFileFallback?: boolean;
  supabaseFetch?: SupabaseRestFetch;
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

export const readWalletBridgeRecord = async (params: {
  userId?: bigint;
  walletAddress?: Address;
  vaultAddress?: Address;
  supabaseUrl?: string;
  supabaseKey?: string;
  disableFileFallback?: boolean;
  supabaseFetch?: SupabaseRestFetch;
}): Promise<WalletBridgeRecord | null> => {
  const supabaseConfig = resolveSupabaseRestConfig({
    supabaseUrl: params.supabaseUrl,
    supabaseKey: params.supabaseKey,
  });
  if (!supabaseConfig) {
    return params.disableFileFallback ? null : readFileRecord(params);
  }

  const query: Record<string, string> = {
    select: "user_id,wallet_address,vault_address,chain_id,testnet,issued_at,expires_at,signature,updated_at",
    order: "updated_at.desc",
    limit: "25",
  };
  if (params.userId) query.user_id = `eq.${Number(params.userId)}`;
  if (params.walletAddress) query.wallet_address = `eq.${params.walletAddress.toLowerCase()}`;

  let data: WalletBridgeDbRow[];
  try {
    data = await selectSupabaseRows<WalletBridgeDbRow>({
      table: USER_WALLET_TABLE,
      query,
      supabaseUrl: supabaseConfig.supabaseUrl,
      supabaseKey: supabaseConfig.supabaseKey,
      fetcher: params.supabaseFetch,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[wallet-bridge] Supabase read failed: ${message}`);
    return params.disableFileFallback ? null : readFileRecord(params);
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

  return records[0] ?? (params.disableFileFallback ? null : readFileRecord(params));
};

export const resolveWalletUserId = async (params: {
  walletAddress: Address;
  vaultAddress?: Address;
  supabaseUrl?: string;
  supabaseKey?: string;
  disableFileFallback?: boolean;
  supabaseFetch?: SupabaseRestFetch;
}): Promise<bigint | null> => {
  const record = await readWalletBridgeRecord({
    walletAddress: params.walletAddress,
    vaultAddress: params.vaultAddress,
    supabaseUrl: params.supabaseUrl,
    supabaseKey: params.supabaseKey,
    disableFileFallback: params.disableFileFallback,
    supabaseFetch: params.supabaseFetch,
  });
  if (!record) return null;
  return BigInt(record.userId);
};
