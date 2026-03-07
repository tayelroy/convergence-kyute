import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isAddress, type Address } from "viem";
import {
  DEFAULT_STRATEGY_PREFERENCES,
  STRATEGY_MARKETS,
  normalizeStrategyPreferences,
  resolvePrimaryStrategyId,
  type MarketId,
  type StrategyPreferences,
} from "@/lib/strategy-preferences";

export const runtime = "nodejs";

const STRATEGY_TABLE = "kyute_user_strategies";
const USER_WALLET_TABLE = "kyute_user_wallets";
const DEFAULT_ETH_BOROS_MARKET_ID = 41;
const DEFAULT_BTC_BOROS_MARKET_ID = 61;

type StrategyDbRow = {
  id?: number;
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
  market_enabled?: boolean | null;
  entry_threshold_bp?: number | null;
  exit_threshold_bp?: number | null;
  updated_at: string;
};

const DEFAULT_VENUE = "HlPerp";

const resolveMarketKey = (assetSymbol: string, marketAddress: string | null, marketId: number): string =>
  `${assetSymbol.toLowerCase()}:hlperp:${marketAddress?.toLowerCase() ?? `market-${marketId}`}`;

const DEFAULT_MARKET_METADATA: Record<
  MarketId,
  { assetSymbol: string; marketKey: string; borosMarketAddress: string | null }
> = {
  ETHUSDC: {
    assetSymbol: "ETH",
    borosMarketAddress: normalizeAddress(
      process.env.NEXT_PUBLIC_BOROS_MARKET_ADDRESS ??
        process.env.BOROS_MARKET_ADDRESS ??
        "",
    ),
    get marketKey() {
      return resolveMarketKey("ETH", this.borosMarketAddress, DEFAULT_ETH_BOROS_MARKET_ID);
    },
  },
  BTCUSDC: {
    assetSymbol: "BTC",
    borosMarketAddress: null,
    get marketKey() {
      return resolveMarketKey("BTC", this.borosMarketAddress, DEFAULT_BTC_BOROS_MARKET_ID);
    },
  },
};

function normalizeAddress(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim().toLowerCase();
  return trimmed && isAddress(trimmed) ? trimmed : null;
}

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

const inferMarketId = (row: StrategyDbRow): MarketId | null => {
  const asset = String(row.asset_symbol ?? "").trim().toUpperCase();
  if (asset === "ETH") return "ETHUSDC";
  if (asset === "BTC") return "BTCUSDC";
  return null;
};

const mapRowsToPreferences = (rows: StrategyDbRow[]): StrategyPreferences => {
  const base = normalizeStrategyPreferences(null);

  for (const row of rows) {
    const marketId = inferMarketId(row);
    if (!marketId) continue;
    const next = base.markets[marketId];
    next.enabled = typeof row.market_enabled === "boolean" ? row.market_enabled : next.enabled;
    next.mode =
      row.primary_strategy_id === "dynamic_regime_hedge" || row.primary_strategy_id === "short_perp_fixed_lock"
        ? "dynamic_regime_hedge"
        : "default_hedge";
    if (typeof row.entry_threshold_bp === "number" && Number.isFinite(row.entry_threshold_bp)) {
      next.entryThresholdBp = Math.max(0, Math.round(row.entry_threshold_bp));
    }
    if (typeof row.exit_threshold_bp === "number" && Number.isFinite(row.exit_threshold_bp)) {
      next.exitThresholdBp = Math.max(0, Math.round(row.exit_threshold_bp));
    }
    if (typeof row.ai_prompt === "string" && row.ai_prompt.trim().length > 0) {
      base.aiPrompt = row.ai_prompt;
    }
    if (typeof row.codex_tokens === "number" && Number.isFinite(row.codex_tokens) && row.codex_tokens > 0) {
      base.codexTokens = row.codex_tokens;
    }
  }

  return base;
};

const findExistingMarketRow = (rows: StrategyDbRow[], marketId: MarketId): StrategyDbRow | null => {
  return rows.find((row) => inferMarketId(row) === marketId && typeof row.id === "number") ?? null;
};

export async function GET(request: Request) {
  try {
    const supabase = resolveSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Missing Supabase configuration." }, { status: 500 });
    }

    const url = new URL(request.url);
    const walletAddress = String(url.searchParams.get("walletAddress") ?? "").trim().toLowerCase();
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
    const preferences = rows.length > 0 ? mapRowsToPreferences(rows) : DEFAULT_STRATEGY_PREFERENCES;

    return NextResponse.json(
      {
        ok: true,
        preferences,
        updatedAt: rows[0]?.updated_at ?? null,
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
      preferences?: Partial<StrategyPreferences>;
    };

    const walletAddress = String(body.walletAddress ?? "").trim().toLowerCase();
    const vaultAddressRaw = String(body.vaultAddress ?? "").trim().toLowerCase();
    if (!isAddress(walletAddress)) {
      return NextResponse.json({ ok: false, error: "Invalid walletAddress." }, { status: 400 });
    }
    if (vaultAddressRaw && !isAddress(vaultAddressRaw)) {
      return NextResponse.json({ ok: false, error: "Invalid vaultAddress." }, { status: 400 });
    }

    const preferences = normalizeStrategyPreferences(body.preferences);
    const userId = await resolveLinkedUserId(supabase, walletAddress as Address);
    const updatedAt = new Date().toISOString();

    const existingRowsResult = await supabase
      .from(STRATEGY_TABLE)
      .select("*")
      .eq("wallet_address", walletAddress)
      .order("updated_at", { ascending: false })
      .limit(20);

    if (existingRowsResult.error) {
      throw new Error(
        `Supabase kyute_user_strategies existing-row lookup failed: ${existingRowsResult.error.message}`,
      );
    }

    const existingRows = Array.isArray(existingRowsResult.data)
      ? (existingRowsResult.data as StrategyDbRow[])
      : [];

    for (const marketId of STRATEGY_MARKETS) {
      const metadata = DEFAULT_MARKET_METADATA[marketId];
      const market = preferences.markets[marketId];
      const payload = {
        user_id: userId,
        wallet_address: walletAddress,
        vault_address: vaultAddressRaw || null,
        market_key: metadata.marketKey,
        asset_symbol: metadata.assetSymbol,
        venue: DEFAULT_VENUE,
        boros_market_address: metadata.borosMarketAddress,
        primary_strategy_id: resolvePrimaryStrategyId(preferences, marketId),
        enabled_strategies: market.enabled ? [market.mode] : [],
        ai_prompt: preferences.aiPrompt,
        codex_tokens: preferences.codexTokens,
        market_enabled: market.enabled,
        entry_threshold_bp: market.entryThresholdBp,
        exit_threshold_bp: market.exitThresholdBp,
        updated_at: updatedAt,
      };

      const existingRow = findExistingMarketRow(existingRows, marketId);
      if (existingRow?.id) {
        const updateResult = await supabase
          .from(STRATEGY_TABLE)
          .update(payload)
          .eq("id", existingRow.id)
          .select("*")
          .single();

        if (updateResult.error) {
          throw new Error(
            `Supabase kyute_user_strategies update failed for ${marketId}: ${updateResult.error.message}`,
          );
        }
      } else {
        const insertResult = await supabase
          .from(STRATEGY_TABLE)
          .insert(payload)
          .select("*")
          .single();

        if (insertResult.error) {
          throw new Error(
            `Supabase kyute_user_strategies insert failed for ${marketId}: ${insertResult.error.message}`,
          );
        }
      }
    }

    return NextResponse.json(
      {
        ok: true,
        preferences,
        updatedAt,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown strategy preferences error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
