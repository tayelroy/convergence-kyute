import { isAddress, type Address } from "viem";
import type { HedgeMode } from "./hedge-policy.js";
import {
  resolveSupabaseRestConfig,
  type SupabaseRestFetch,
  selectSupabaseRows,
} from "./supabase-rest.js";

export type StoredStrategyId =
  | "default_hedge"
  | "dynamic_regime_hedge"
  | "short_perp_fixed_lock"
  | "ai_custom";

export type StrategyConfigRecord = {
  userId: number | null;
  walletAddress: Address;
  vaultAddress?: Address;
  marketKey?: string | null;
  assetSymbol?: string | null;
  venue?: string | null;
  borosMarketAddress?: Address;
  marketEnabled: boolean;
  entryThresholdBp?: number | null;
  exitThresholdBp?: number | null;
  primaryStrategyId: string | null;
  enabledStrategies: StoredStrategyId[];
  aiPrompt?: string | null;
  codexTokens?: number | null;
  updatedAt: string;
};

type StrategyDbRow = {
  user_id: number | null;
  wallet_address: string;
  vault_address: string | null;
  market_key?: string | null;
  asset_symbol?: string | null;
  venue?: string | null;
  boros_market_address?: string | null;
  market_enabled?: boolean | null;
  entry_threshold_bp?: number | null;
  exit_threshold_bp?: number | null;
  primary_strategy_id: string | null;
  enabled_strategies: unknown;
  ai_prompt: string | null;
  codex_tokens: number | null;
  updated_at: string;
};

type ResolveUserHedgeModeParams = {
  userId?: bigint;
  walletAddress?: Address | null;
  vaultAddress?: Address;
  marketKey?: string;
  assetSymbol?: string;
  venue?: string;
  borosMarketAddress?: Address;
  fallbackMode?: HedgeMode;
  logger?: (message: string) => void;
  supabaseUrl?: string;
  supabaseKey?: string;
  supabaseFetch?: SupabaseRestFetch;
};

export type ResolvedUserHedgeMode = {
  enabled: boolean;
  mode: HedgeMode;
  entryThresholdBp?: number | null;
  exitThresholdBp?: number | null;
  source: string;
  record: StrategyConfigRecord | null;
  warning?: string;
};

const STRATEGY_TABLE = "kyute_user_strategies";
const DEFAULT_FALLBACK_MODE: HedgeMode = "adverse_only";

const VALID_STRATEGY_IDS: StoredStrategyId[] = [
  "default_hedge",
  "dynamic_regime_hedge",
  "short_perp_fixed_lock",
  "ai_custom",
];

const toMillis = (value: string | undefined): number => {
  if (!value) return 0;
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
};

const isStoredStrategyId = (value: unknown): value is StoredStrategyId =>
  typeof value === "string" && VALID_STRATEGY_IDS.includes(value as StoredStrategyId);

const parseEnabledStrategies = (value: unknown): StoredStrategyId[] => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is StoredStrategyId => isStoredStrategyId(entry));
  }
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is StoredStrategyId => isStoredStrategyId(entry))
        : [];
    } catch {
      return [];
    }
  }
  return [];
};

const mapDbRowToRecord = (row: StrategyDbRow): StrategyConfigRecord | null => {
  if (!isAddress(row.wallet_address)) {
    return null;
  }
  if (row.vault_address && !isAddress(row.vault_address)) {
    return null;
  }
  if (row.boros_market_address && !isAddress(row.boros_market_address)) {
    return null;
  }

  return {
    userId: typeof row.user_id === "number" ? row.user_id : null,
    walletAddress: row.wallet_address as Address,
    vaultAddress: row.vault_address ? (row.vault_address as Address) : undefined,
    marketKey: typeof row.market_key === "string" ? row.market_key : null,
    assetSymbol: typeof row.asset_symbol === "string" ? row.asset_symbol : null,
    venue: typeof row.venue === "string" ? row.venue : null,
    borosMarketAddress: row.boros_market_address ? (row.boros_market_address as Address) : undefined,
    marketEnabled: typeof row.market_enabled === "boolean" ? row.market_enabled : true,
    entryThresholdBp:
      typeof row.entry_threshold_bp === "number" && Number.isFinite(row.entry_threshold_bp)
        ? row.entry_threshold_bp
        : null,
    exitThresholdBp:
      typeof row.exit_threshold_bp === "number" && Number.isFinite(row.exit_threshold_bp)
        ? row.exit_threshold_bp
        : null,
    primaryStrategyId: row.primary_strategy_id,
    enabledStrategies: parseEnabledStrategies(row.enabled_strategies),
    aiPrompt: row.ai_prompt,
    codexTokens: row.codex_tokens,
    updatedAt: row.updated_at,
  };
};

const sortRecords = (
  records: StrategyConfigRecord[],
  params: {
    vaultAddress?: Address;
    userId?: bigint;
    marketKey?: string;
    assetSymbol?: string;
    venue?: string;
    borosMarketAddress?: Address;
  },
): StrategyConfigRecord[] => {
  const targetVault = params.vaultAddress?.toLowerCase();
  const targetUserId = params.userId?.toString();
  const targetMarketKey = params.marketKey?.trim().toLowerCase();
  const targetAssetSymbol = params.assetSymbol?.trim().toUpperCase();
  const targetVenue = params.venue?.trim().toUpperCase();
  const targetBorosMarketAddress = params.borosMarketAddress?.toLowerCase();

  return [...records].sort((left, right) => {
    const leftExactMarketKey =
      !!targetMarketKey &&
      !!left.marketKey &&
      left.marketKey.trim().toLowerCase() === targetMarketKey;
    const rightExactMarketKey =
      !!targetMarketKey &&
      !!right.marketKey &&
      right.marketKey.trim().toLowerCase() === targetMarketKey;
    if (leftExactMarketKey !== rightExactMarketKey) return leftExactMarketKey ? -1 : 1;

    const leftExactBorosMarket =
      !!targetBorosMarketAddress &&
      !!left.borosMarketAddress &&
      left.borosMarketAddress.toLowerCase() === targetBorosMarketAddress;
    const rightExactBorosMarket =
      !!targetBorosMarketAddress &&
      !!right.borosMarketAddress &&
      right.borosMarketAddress.toLowerCase() === targetBorosMarketAddress;
    if (leftExactBorosMarket !== rightExactBorosMarket) return leftExactBorosMarket ? -1 : 1;

    const leftMatchingAssetVenue =
      !!targetAssetSymbol &&
      !!targetVenue &&
      left.assetSymbol?.trim().toUpperCase() === targetAssetSymbol &&
      left.venue?.trim().toUpperCase() === targetVenue;
    const rightMatchingAssetVenue =
      !!targetAssetSymbol &&
      !!targetVenue &&
      right.assetSymbol?.trim().toUpperCase() === targetAssetSymbol &&
      right.venue?.trim().toUpperCase() === targetVenue;
    if (leftMatchingAssetVenue !== rightMatchingAssetVenue) return leftMatchingAssetVenue ? -1 : 1;

    const leftExactVault =
      !!targetVault &&
      !!left.vaultAddress &&
      left.vaultAddress.toLowerCase() === targetVault;
    const rightExactVault =
      !!targetVault &&
      !!right.vaultAddress &&
      right.vaultAddress.toLowerCase() === targetVault;
    if (leftExactVault !== rightExactVault) return leftExactVault ? -1 : 1;

    const leftMatchingUser = !!targetUserId && String(left.userId ?? "") === targetUserId;
    const rightMatchingUser = !!targetUserId && String(right.userId ?? "") === targetUserId;
    if (leftMatchingUser !== rightMatchingUser) return leftMatchingUser ? -1 : 1;

    return toMillis(right.updatedAt) - toMillis(left.updatedAt);
  });
};

const readStrategyRecordsByUserId = async (
  userId: bigint,
  options?: { supabaseUrl?: string; supabaseKey?: string; supabaseFetch?: SupabaseRestFetch },
): Promise<StrategyConfigRecord[]> => {
  const data = await selectSupabaseRows<StrategyDbRow>({
    table: STRATEGY_TABLE,
    query: {
      select: "*",
      user_id: `eq.${Number(userId)}`,
      order: "updated_at.desc",
      limit: "10",
    },
    supabaseUrl: options?.supabaseUrl,
    supabaseKey: options?.supabaseKey,
    fetcher: options?.supabaseFetch,
  });

  return (data ?? [])
    .map((row) => mapDbRowToRecord(row as StrategyDbRow))
    .filter((row): row is StrategyConfigRecord => row !== null);
};

const readStrategyRecordsByWallet = async (
  walletAddress: Address,
  options?: { supabaseUrl?: string; supabaseKey?: string; supabaseFetch?: SupabaseRestFetch },
): Promise<StrategyConfigRecord[]> => {
  const data = await selectSupabaseRows<StrategyDbRow>({
    table: STRATEGY_TABLE,
    query: {
      select: "*",
      wallet_address: `eq.${walletAddress.toLowerCase()}`,
      order: "updated_at.desc",
      limit: "10",
    },
    supabaseUrl: options?.supabaseUrl,
    supabaseKey: options?.supabaseKey,
    fetcher: options?.supabaseFetch,
  });

  return (data ?? [])
    .map((row) => mapDbRowToRecord(row as StrategyDbRow))
    .filter((row): row is StrategyConfigRecord => row !== null);
};

export const mapFrontendStrategyToHedgeMode = (strategy: string | null | undefined): HedgeMode | null => {
  const normalized = String(strategy ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (!normalized) return null;
  if (
    normalized === "dynamic_regime_hedge" ||
    normalized === "prefer_fixed_when_receive_floating" ||
    normalized === "short_perp_fixed_lock" ||
    normalized === "receive_floating_lock"
  ) {
    return "lock_fixed";
  }
  if (normalized === "default_hedge" || normalized === "default") {
    return "adverse_only";
  }
  return null;
};

export const resolveStrategyModeFromRecord = (
  record: StrategyConfigRecord | null,
): {
  enabled: boolean;
  mode: HedgeMode | null;
  entryThresholdBp?: number | null;
  exitThresholdBp?: number | null;
  source: string;
  warning?: string;
} => {
  if (!record) {
    return { enabled: true, mode: null, source: "no_record" };
  }

  if (!record.marketEnabled) {
    return {
      enabled: false,
      mode: null,
      entryThresholdBp: record.entryThresholdBp,
      exitThresholdBp: record.exitThresholdBp,
      source: "db_market_disabled",
    };
  }

  const primaryMode = mapFrontendStrategyToHedgeMode(record.primaryStrategyId);
  if (primaryMode) {
    return {
      enabled: true,
      mode: primaryMode,
      entryThresholdBp: record.entryThresholdBp,
      exitThresholdBp: record.exitThresholdBp,
      source: `db_primary:${record.primaryStrategyId}`,
    };
  }

  for (const strategyId of record.enabledStrategies) {
    const candidateMode = mapFrontendStrategyToHedgeMode(strategyId);
    if (candidateMode === "lock_fixed") {
      return {
        enabled: true,
        mode: candidateMode,
        entryThresholdBp: record.entryThresholdBp,
        exitThresholdBp: record.exitThresholdBp,
        source: `db_enabled:${strategyId}`,
      };
    }
    if (candidateMode === "adverse_only") {
      return {
        enabled: true,
        mode: candidateMode,
        entryThresholdBp: record.entryThresholdBp,
        exitThresholdBp: record.exitThresholdBp,
        source: `db_enabled:${strategyId}`,
      };
    }
  }

  return {
    enabled: true,
    mode: null,
    entryThresholdBp: record.entryThresholdBp,
    exitThresholdBp: record.exitThresholdBp,
    source: "unsupported_record",
    warning: `Strategy record for wallet=${record.walletAddress} has no live-executable strategy; falling back.`,
  };
};

export const resolveUserHedgeMode = async (
  params: ResolveUserHedgeModeParams,
): Promise<ResolvedUserHedgeMode> => {
  const fallbackMode = params.fallbackMode ?? DEFAULT_FALLBACK_MODE;
  const logger = params.logger ?? (() => {});

  if (!resolveSupabaseRestConfig({ supabaseUrl: params.supabaseUrl, supabaseKey: params.supabaseKey })) {
    return {
      enabled: true,
      mode: fallbackMode,
      source: "supabase_unconfigured_fallback",
      entryThresholdBp: null,
      exitThresholdBp: null,
      record: null,
      warning: "Supabase not configured for strategy lookup.",
    };
  }

  try {
    const recordsByUserId = params.userId
        ? await readStrategyRecordsByUserId(params.userId, {
            supabaseUrl: params.supabaseUrl,
            supabaseKey: params.supabaseKey,
            supabaseFetch: params.supabaseFetch,
          })
      : [];
    if (recordsByUserId.length > 0) {
      const record = sortRecords(recordsByUserId, params)[0] ?? null;
      const resolved = resolveStrategyModeFromRecord(record);
      if (resolved.mode || resolved.enabled === false) {
        return {
          enabled: resolved.enabled,
          mode: resolved.mode ?? fallbackMode,
          entryThresholdBp: resolved.entryThresholdBp,
          exitThresholdBp: resolved.exitThresholdBp,
          source: resolved.source,
          record,
          warning: resolved.warning,
        };
      }
      if (resolved.warning) logger(`[strategy-config] ${resolved.warning}`);
      return {
        enabled: true,
        mode: fallbackMode,
        entryThresholdBp: resolved.entryThresholdBp,
        exitThresholdBp: resolved.exitThresholdBp,
        source: "unsupported_record_fallback",
        record,
        warning: resolved.warning,
      };
    }

    if (params.walletAddress) {
      const recordsByWallet = await readStrategyRecordsByWallet(params.walletAddress, {
        supabaseUrl: params.supabaseUrl,
        supabaseKey: params.supabaseKey,
        supabaseFetch: params.supabaseFetch,
      });
      if (recordsByWallet.length > 0) {
        const record = sortRecords(recordsByWallet, params)[0] ?? null;
        const resolved = resolveStrategyModeFromRecord(record);
        if (resolved.mode || resolved.enabled === false) {
          return {
            enabled: resolved.enabled,
            mode: resolved.mode ?? fallbackMode,
            entryThresholdBp: resolved.entryThresholdBp,
            exitThresholdBp: resolved.exitThresholdBp,
            source: resolved.source,
            record,
            warning: resolved.warning,
          };
        }
        if (resolved.warning) logger(`[strategy-config] ${resolved.warning}`);
        return {
          enabled: true,
          mode: fallbackMode,
          entryThresholdBp: resolved.entryThresholdBp,
          exitThresholdBp: resolved.exitThresholdBp,
          source: "unsupported_record_fallback",
          record,
          warning: resolved.warning,
        };
      }
    }

    return {
      enabled: true,
      mode: fallbackMode,
      entryThresholdBp: null,
      exitThresholdBp: null,
      source: "no_db_record_fallback",
      record: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown strategy lookup error";
    logger(`[strategy-config] ${message}`);
    return {
      enabled: true,
      mode: fallbackMode,
      entryThresholdBp: null,
      exitThresholdBp: null,
      source: "db_error_fallback",
      record: null,
      warning: message,
    };
  }
};
