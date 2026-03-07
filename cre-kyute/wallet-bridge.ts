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
  throwOnSupabaseError?: boolean;
  logger?: (message: string) => void;
}): Promise<WalletBridgeRecord | null> => {
  const supabaseConfig = resolveSupabaseRestConfig({
    supabaseUrl: params.supabaseUrl,
    supabaseKey: params.supabaseKey,
  });
  if (!supabaseConfig) {
    if (params.throwOnSupabaseError) {
      throw new Error("Supabase identity lookup unavailable: missing supabaseUrl or supabaseKey");
    }
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
    params.logger?.(`[wallet-bridge] Supabase read failed: ${message}`);
    console.error(`[wallet-bridge] Supabase read failed: ${message}`);
    if (params.throwOnSupabaseError) {
      throw new Error(`Supabase wallet bridge read failed: ${message}`);
    }
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

export const resolveRequiredWalletIdentity = async (params: {
  walletAddress?: Address | null;
  userId?: bigint | null;
  vaultAddress?: Address;
  supabaseUrl?: string;
  supabaseKey?: string;
  supabaseFetch?: SupabaseRestFetch;
  logger?: (message: string) => void;
}): Promise<{ record: WalletBridgeRecord; source: string }> => {
  const config = resolveSupabaseRestConfig({
    supabaseUrl: params.supabaseUrl,
    supabaseKey: params.supabaseKey,
  });
  if (!config) {
    throw new Error("Supabase identity lookup unavailable: missing supabaseUrl or supabaseKey");
  }

  const baseOptions = {
    vaultAddress: params.vaultAddress,
    supabaseUrl: config.supabaseUrl,
    supabaseKey: config.supabaseKey,
    disableFileFallback: true,
    supabaseFetch: params.supabaseFetch,
    throwOnSupabaseError: true,
    logger: params.logger,
  } as const;

  let walletRecord: WalletBridgeRecord | null = null;
  if (params.walletAddress) {
    walletRecord = await readWalletBridgeRecord({
      walletAddress: params.walletAddress,
      ...baseOptions,
    });
    if (!walletRecord) {
      throw new Error(
        `No Supabase identity mapping found for wallet ${params.walletAddress}. Register the wallet from the frontend first.`,
      );
    }
  }

  let userRecord: WalletBridgeRecord | null = null;
  if (params.userId !== null && params.userId !== undefined) {
    userRecord = await readWalletBridgeRecord({
      userId: params.userId,
      ...baseOptions,
    });
    if (!userRecord) {
      throw new Error(
        `No Supabase identity mapping found for userId=${params.userId.toString()}. Register the wallet from the frontend first.`,
      );
    }
  }

  if (
    walletRecord &&
    userRecord &&
    (
      String(walletRecord.userId) !== String(userRecord.userId) ||
      walletRecord.walletAddress.toLowerCase() !== userRecord.walletAddress.toLowerCase()
    )
  ) {
    throw new Error(
      `Supabase identity mismatch: wallet ${walletRecord.walletAddress} maps to userId=${String(walletRecord.userId)} but requested userId=${params.userId?.toString()}`,
    );
  }

  if (walletRecord) return { record: walletRecord, source: "supabase_wallet" };
  if (userRecord) return { record: userRecord, source: "supabase_user" };

  const latestVaultRecord = await readWalletBridgeRecord(baseOptions);
  if (latestVaultRecord) {
    return { record: latestVaultRecord, source: "supabase_latest_vault" };
  }

  const latestRecord = await readWalletBridgeRecord({
    supabaseUrl: params.supabaseUrl,
    supabaseKey: params.supabaseKey,
    disableFileFallback: true,
    supabaseFetch: params.supabaseFetch,
  });
  if (latestRecord) {
    return { record: latestRecord, source: "supabase_latest" };
  }

  throw new Error(
    "No Supabase identity mapping found. Register a wallet from the frontend before running the hedge workflow.",
  );
};
