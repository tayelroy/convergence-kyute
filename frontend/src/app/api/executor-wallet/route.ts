import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAddress, verifyMessage, type Address } from "viem";
import {
  buildExecutorWalletBridgeMessage,
  type ExecutorWalletBridgePayload,
} from "@/lib/executor-wallet-bridge";

type WalletBridgeRecord = ExecutorWalletBridgePayload & {
  updatedAt: string;
};

type WalletBridgeStore = {
  records: WalletBridgeRecord[];
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
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const USER_WALLET_TABLE = "kyute_user_wallets";

const resolveBridgeFile = () => {
  const configured = String(process.env.KYUTE_WALLET_BRIDGE_FILE ?? "").trim();
  if (!configured) return DEFAULT_BRIDGE_FILE;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), "..", configured);
};

const readStore = (bridgeFile: string): WalletBridgeStore => {
  if (!fs.existsSync(bridgeFile)) {
    return { records: [] };
  }

  try {
    const raw = fs.readFileSync(bridgeFile, "utf8");
    const parsed = JSON.parse(raw) as WalletBridgeStore;
    return { records: Array.isArray(parsed.records) ? parsed.records : [] };
  } catch {
    return { records: [] };
  }
};

const writeStore = (bridgeFile: string, store: WalletBridgeStore) => {
  fs.mkdirSync(path.dirname(bridgeFile), { recursive: true });
  const tempFile = `${bridgeFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(store, null, 2) + "\n", "utf8");
  fs.renameSync(tempFile, bridgeFile);
};

const isValidTimestamp = (value: string) => {
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : NaN;
};

const resolveSupabaseClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
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

const mapDbRowToRecord = (row: WalletBridgeDbRow): WalletBridgeRecord => ({
  userId: row.user_id,
  walletAddress: row.wallet_address as Address,
  vaultAddress: row.vault_address ? (row.vault_address as Address) : undefined,
  chainId: row.chain_id ?? 31337,
  testnet: row.testnet ?? true,
  issuedAt: row.issued_at ?? new Date().toISOString(),
  expiresAt: row.expires_at ?? new Date(Date.now() + MAX_TTL_MS).toISOString(),
  signature: (row.signature ?? "0x") as `0x${string}`,
  updatedAt: row.updated_at,
});

const upsertSupabaseUserWallet = async (payload: {
  walletAddress: Address;
  vaultAddress?: Address;
  chainId: number;
  testnet: boolean;
  issuedAt: string;
  expiresAt: string;
  signature: `0x${string}`;
}): Promise<WalletBridgeRecord> => {
  const supabase = resolveSupabaseClient();
  if (!supabase) {
    throw new Error("Missing Supabase configuration for executor wallet bridge");
  }

  const walletAddress = payload.walletAddress.toLowerCase();
  const vaultAddress = payload.vaultAddress?.toLowerCase() ?? null;

  const { data: existing, error: existingError } = await supabase
    .from(USER_WALLET_TABLE)
    .select("user_id,wallet_address,vault_address,chain_id,testnet,issued_at,expires_at,signature,updated_at")
    .eq("wallet_address", walletAddress)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Supabase kyute_user_wallets read failed: ${existingError.message}`);
  }

  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from(USER_WALLET_TABLE)
      .update({
        vault_address: vaultAddress,
        chain_id: payload.chainId,
        testnet: payload.testnet,
        issued_at: payload.issuedAt,
        expires_at: payload.expiresAt,
        signature: payload.signature,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", existing.user_id)
      .select("user_id,wallet_address,vault_address,chain_id,testnet,issued_at,expires_at,signature,updated_at")
      .single();

    if (updateError) {
      throw new Error(`Supabase kyute_user_wallets update failed: ${updateError.message}`);
    }
    return mapDbRowToRecord(updated as WalletBridgeDbRow);
  }

  const { data: inserted, error: insertError } = await supabase
    .from(USER_WALLET_TABLE)
    .insert({
      wallet_address: walletAddress,
      vault_address: vaultAddress,
      chain_id: payload.chainId,
      testnet: payload.testnet,
      issued_at: payload.issuedAt,
      expires_at: payload.expiresAt,
      signature: payload.signature,
      updated_at: new Date().toISOString(),
    })
    .select("user_id,wallet_address,vault_address,chain_id,testnet,issued_at,expires_at,signature,updated_at")
    .single();

  if (insertError) {
    throw new Error(`Supabase kyute_user_wallets insert failed: ${insertError.message}`);
  }

  return mapDbRowToRecord(inserted as WalletBridgeDbRow);
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<ExecutorWalletBridgePayload>;
    const walletAddress = String(body.walletAddress ?? "").trim();
    const vaultAddressRaw = String(body.vaultAddress ?? "").trim();
    const chainId = Number(body.chainId ?? NaN);
    const testnet = body.testnet === true;
    const issuedAt = String(body.issuedAt ?? "").trim();
    const expiresAt = String(body.expiresAt ?? "").trim();
    const signature = String(body.signature ?? "").trim();

    if (!isAddress(walletAddress)) {
      return NextResponse.json({ ok: false, error: "Invalid walletAddress" }, { status: 400 });
    }
    if (vaultAddressRaw && !isAddress(vaultAddressRaw)) {
      return NextResponse.json({ ok: false, error: "Invalid vaultAddress" }, { status: 400 });
    }
    if (!Number.isFinite(chainId) || chainId <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid chainId" }, { status: 400 });
    }
    if (!/^0x[0-9a-fA-F]+$/.test(signature)) {
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 400 });
    }

    const issuedAtMs = isValidTimestamp(issuedAt);
    const expiresAtMs = isValidTimestamp(expiresAt);
    if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= issuedAtMs) {
      return NextResponse.json({ ok: false, error: "Invalid issuedAt/expiresAt window" }, { status: 400 });
    }
    if (expiresAtMs - issuedAtMs > MAX_TTL_MS) {
      return NextResponse.json({ ok: false, error: "Bridge TTL exceeds maximum allowed window" }, { status: 400 });
    }
    if (expiresAtMs <= Date.now()) {
      return NextResponse.json({ ok: false, error: "Bridge registration already expired" }, { status: 400 });
    }

    const normalizedVault = vaultAddressRaw.length > 0 ? (vaultAddressRaw as Address) : undefined;
    const message = buildExecutorWalletBridgeMessage({
      walletAddress,
      vaultAddress: normalizedVault,
      chainId: Math.floor(chainId),
      testnet,
      issuedAt,
      expiresAt,
    });
    const verified = await verifyMessage({
      address: walletAddress as Address,
      message,
      signature: signature as `0x${string}`,
    });
    if (!verified) {
      return NextResponse.json({ ok: false, error: "Wallet signature verification failed" }, { status: 401 });
    }

    const supabaseRecord = await upsertSupabaseUserWallet({
      walletAddress: walletAddress as Address,
      vaultAddress: normalizedVault,
      chainId: Math.floor(chainId),
      testnet,
      issuedAt,
      expiresAt,
      signature: signature as `0x${string}`,
    });

    const bridgeFile = resolveBridgeFile();
    const store = readStore(bridgeFile);
    const updatedRecord: WalletBridgeRecord = {
      userId: supabaseRecord.userId,
      walletAddress: walletAddress as Address,
      vaultAddress: normalizedVault,
      chainId: Math.floor(chainId),
      testnet,
      issuedAt,
      expiresAt,
      signature,
      updatedAt: new Date().toISOString(),
    };

    const nextRecords = (store.records ?? []).filter((record) => {
      const sameWallet = record.walletAddress.toLowerCase() === updatedRecord.walletAddress.toLowerCase();
      const sameUser = Number(record.userId) === updatedRecord.userId;
      const sameVault = (record.vaultAddress ?? "").toLowerCase() === (updatedRecord.vaultAddress ?? "").toLowerCase();
      return !(sameWallet || (sameUser && sameVault));
    });
    nextRecords.push(updatedRecord);
    writeStore(bridgeFile, { records: nextRecords });

    return NextResponse.json({
      ok: true,
      walletAddress: updatedRecord.walletAddress,
      userId: Number(updatedRecord.userId),
      vaultAddress: updatedRecord.vaultAddress ?? null,
      expiresAt: updatedRecord.expiresAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown executor wallet bridge error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
