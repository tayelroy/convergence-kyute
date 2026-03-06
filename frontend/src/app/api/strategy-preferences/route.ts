import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isAddress, type Address } from "viem";
import {
  normalizeStrategyPreferences,
  resolvePrimaryStrategyId,
  type StrategyPreferences,
} from "@/lib/strategy-preferences";

export const runtime = "nodejs";

const STRATEGY_TABLE = "kyute_user_strategies";
const USER_WALLET_TABLE = "kyute_user_wallets";

type StrategyDbRow = {
  user_id: number | null;
  wallet_address: string;
  vault_address: string | null;
  market_key?: string | null;
  asset_symbol?: string | null;
  venue?: string | null;
  boros_market_address?: string | null;
  primary_strategy_id: string | null;
  enabled_strategies: unknown;
  ai_prompt: string | null;
  codex_tokens: number | null;
  updated_at: string;
};

const DEFAULT_ASSET_SYMBOL = "ETH";
const DEFAULT_VENUE = "HlPerp";

const resolveDefaultBorosMarketAddress = (): string | null => {
  const value =
    process.env.BOROS_MARKET_ADDRESS ??
    process.env.NEXT_PUBLIC_BOROS_MARKET_ADDRESS ??
    null;
  return value && isAddress(value) ? value.toLowerCase() : null;
};

const resolveMarketContext = (input?: {
  marketKey?: string | null;
  assetSymbol?: string | null;
  venue?: string | null;
  borosMarketAddress?: string | null;
}) => {
  const assetSymbol = String(input?.assetSymbol ?? DEFAULT_ASSET_SYMBOL).trim().toUpperCase();
  const venue = String(input?.venue ?? DEFAULT_VENUE).trim();
  const borosMarketAddressRaw = String(
    input?.borosMarketAddress ?? resolveDefaultBorosMarketAddress() ?? "",
  )
    .trim()
    .toLowerCase();
  const borosMarketAddress =
    borosMarketAddressRaw && isAddress(borosMarketAddressRaw) ? borosMarketAddressRaw : null;
  const marketKey =
    String(input?.marketKey ?? "")
      .trim()
      .toLowerCase() || `${assetSymbol.toLowerCase()}:${venue.toLowerCase()}:${borosMarketAddress ?? "default"}`;

  return {
    marketKey,
    assetSymbol,
    venue,
    borosMarketAddress,
  };
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

const parseEnabledStrategies = (value: unknown): StrategyPreferences["enabled"] => {
  if (Array.isArray(value)) {
    return normalizeStrategyPreferences({ enabled: value as StrategyPreferences["enabled"] }).enabled;
  }
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? normalizeStrategyPreferences({ enabled: parsed as StrategyPreferences["enabled"] }).enabled
        : [];
    } catch {
      return [];
    }
  }
  return [];
};

const mapRowToPreferences = (row: StrategyDbRow): StrategyPreferences =>
  normalizeStrategyPreferences({
    enabled: parseEnabledStrategies(row.enabled_strategies),
    aiPrompt: row.ai_prompt ?? undefined,
    codexTokens: row.codex_tokens ?? undefined,
  });

const sortStrategyRows = (
  rows: StrategyDbRow[],
  market: ReturnType<typeof resolveMarketContext>,
): StrategyDbRow[] =>
  [...rows].sort((left, right) => {
    const leftMarketKey = String(left.market_key ?? "").trim().toLowerCase();
    const rightMarketKey = String(right.market_key ?? "").trim().toLowerCase();
    const leftExactMarket = leftMarketKey !== "" && leftMarketKey === market.marketKey;
    const rightExactMarket = rightMarketKey !== "" && rightMarketKey === market.marketKey;
    if (leftExactMarket !== rightExactMarket) return leftExactMarket ? -1 : 1;

    const leftExactBorosMarket =
      !!market.borosMarketAddress &&
      String(left.boros_market_address ?? "").trim().toLowerCase() === market.borosMarketAddress;
    const rightExactBorosMarket =
      !!market.borosMarketAddress &&
      String(right.boros_market_address ?? "").trim().toLowerCase() === market.borosMarketAddress;
    if (leftExactBorosMarket !== rightExactBorosMarket) return leftExactBorosMarket ? -1 : 1;

    const leftAssetVenue =
      String(left.asset_symbol ?? "").trim().toUpperCase() === market.assetSymbol &&
      String(left.venue ?? "").trim().toUpperCase() === market.venue.toUpperCase();
    const rightAssetVenue =
      String(right.asset_symbol ?? "").trim().toUpperCase() === market.assetSymbol &&
      String(right.venue ?? "").trim().toUpperCase() === market.venue.toUpperCase();
    if (leftAssetVenue !== rightAssetVenue) return leftAssetVenue ? -1 : 1;

    return new Date(String(right.updated_at ?? 0)).getTime() - new Date(String(left.updated_at ?? 0)).getTime();
  });

const resolveLinkedUserId = async (
  supabase: SupabaseClient,
  walletAddress: Address,
): Promise<number | null> => {
  const { data, error } = await supabase
    .from(USER_WALLET_TABLE)
    .select("user_id")
    .eq("wallet_address", walletAddress.toLowerCase())
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase kyute_user_wallets lookup failed: ${error.message}`);
  }

  const row = data as { user_id?: unknown } | null;
  return typeof row?.user_id === "number" ? row.user_id : null;
};

export async function GET(request: Request) {
  try {
    const supabase = resolveSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Missing Supabase configuration." }, { status: 500 });
    }

    const url = new URL(request.url);
    const walletAddress = String(url.searchParams.get("walletAddress") ?? "").trim().toLowerCase();
    const market = resolveMarketContext({
      marketKey: url.searchParams.get("marketKey"),
      assetSymbol: url.searchParams.get("assetSymbol"),
      venue: url.searchParams.get("venue"),
      borosMarketAddress: url.searchParams.get("borosMarketAddress"),
    });
    if (!isAddress(walletAddress)) {
      return NextResponse.json({ ok: false, error: "Invalid walletAddress." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from(STRATEGY_TABLE)
      .select("*")
      .eq("wallet_address", walletAddress)
      .order("updated_at", { ascending: false })
      .limit(20);

    if (error) {
      throw new Error(`Supabase kyute_user_strategies read failed: ${error.message}`);
    }

    const rows = Array.isArray(data) ? (data as StrategyDbRow[]) : [];
    const selected = sortStrategyRows(rows, market)[0] ?? null;

    if (!selected) {
      return NextResponse.json({ ok: true, preferences: null, updatedAt: null }, { status: 200 });
    }

    return NextResponse.json(
      {
        ok: true,
        preferences: mapRowToPreferences(selected),
        updatedAt: selected.updated_at,
        market,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown strategy preferences error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = resolveSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Missing Supabase configuration." }, { status: 500 });
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      vaultAddress?: string | null;
      marketKey?: string | null;
      assetSymbol?: string | null;
      venue?: string | null;
      borosMarketAddress?: string | null;
      preferences?: Partial<StrategyPreferences>;
    };

    const walletAddress = String(body.walletAddress ?? "").trim().toLowerCase();
    const vaultAddressRaw = String(body.vaultAddress ?? "").trim().toLowerCase();
    const market = resolveMarketContext(body);
    if (!isAddress(walletAddress)) {
      return NextResponse.json({ ok: false, error: "Invalid walletAddress." }, { status: 400 });
    }
    if (vaultAddressRaw && !isAddress(vaultAddressRaw)) {
      return NextResponse.json({ ok: false, error: "Invalid vaultAddress." }, { status: 400 });
    }

    const preferences = normalizeStrategyPreferences(body.preferences);
    const userId = await resolveLinkedUserId(supabase, walletAddress as Address);
    const updatedAt = new Date().toISOString();

    const payload = {
      user_id: userId,
      wallet_address: walletAddress,
      vault_address: vaultAddressRaw || null,
      market_key: market.marketKey,
      asset_symbol: market.assetSymbol,
      venue: market.venue,
      boros_market_address: market.borosMarketAddress,
      primary_strategy_id: resolvePrimaryStrategyId(preferences),
      enabled_strategies: preferences.enabled,
      ai_prompt: preferences.aiPrompt,
      codex_tokens: preferences.codexTokens,
      updated_at: updatedAt,
    };

    let data: StrategyDbRow | null = null;
    let error: Error | null = null;

    const marketScopedWrite = await supabase
      .from(STRATEGY_TABLE)
      .upsert(payload, { onConflict: "wallet_address,market_key" })
      .select("*")
      .single();

    if (marketScopedWrite.error) {
      const legacyWrite = await supabase
        .from(STRATEGY_TABLE)
        .upsert(
          {
            user_id: payload.user_id,
            wallet_address: payload.wallet_address,
            vault_address: payload.vault_address,
            primary_strategy_id: payload.primary_strategy_id,
            enabled_strategies: payload.enabled_strategies,
            ai_prompt: payload.ai_prompt,
            codex_tokens: payload.codex_tokens,
            updated_at: payload.updated_at,
          },
          { onConflict: "wallet_address" },
        )
        .select("*")
        .single();

      if (legacyWrite.error) {
        error = new Error(`Supabase kyute_user_strategies upsert failed: ${legacyWrite.error.message}`);
      } else {
        data = legacyWrite.data as StrategyDbRow;
      }
    } else {
      data = marketScopedWrite.data as StrategyDbRow;
    }

    if (error || !data) {
      throw error ?? new Error("Supabase kyute_user_strategies upsert returned no data.");
    }

    return NextResponse.json(
      {
        ok: true,
        preferences: mapRowToPreferences(data),
        updatedAt: data.updated_at,
        market,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown strategy preferences error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
