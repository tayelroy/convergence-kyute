export type StrategyId = "default_hedge" | "dynamic_regime_hedge" | "short_perp_fixed_lock" | "ai_custom";
export type MarketStrategyMode = "default_hedge" | "dynamic_regime_hedge";
export type MarketId = "ETHUSDC" | "BTCUSDC";

export type MarketStrategySettings = {
  enabled: boolean;
  mode: MarketStrategyMode;
  entryThresholdBp: number;
  exitThresholdBp: number;
};

export type StrategyPreferences = {
  markets: Record<MarketId, MarketStrategySettings>;
  aiPrompt: string;
  codexTokens: number;
};

export const STRATEGY_STORAGE_KEY = "kyute_strategy_preferences_v2";
export const STRATEGY_MARKETS: MarketId[] = ["ETHUSDC", "BTCUSDC"];

export const DEFAULT_MARKET_SETTINGS: MarketStrategySettings = {
  enabled: true,
  mode: "default_hedge",
  entryThresholdBp: 40,
  exitThresholdBp: 10,
};

export const DEFAULT_STRATEGY_PREFERENCES: StrategyPreferences = {
  markets: {
    ETHUSDC: { ...DEFAULT_MARKET_SETTINGS, enabled: true, mode: "dynamic_regime_hedge" },
    BTCUSDC: { ...DEFAULT_MARKET_SETTINGS, enabled: true, mode: "default_hedge" },
  },
  aiPrompt:
    "Find a funding-rate strategy that keeps Boros exposure collateralized by my vault deposit, limits directional beta, and makes the hedge leg explicit.",
  codexTokens: 8000,
};

const isMarketId = (value: unknown): value is MarketId =>
  typeof value === "string" && STRATEGY_MARKETS.includes(value as MarketId);

const normalizeMarketMode = (value: unknown): MarketStrategyMode =>
  value === "dynamic_regime_hedge" || value === "short_perp_fixed_lock"
    ? "dynamic_regime_hedge"
    : "default_hedge";

const normalizeThreshold = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
};

const normalizeMarketSettings = (
  raw: Partial<MarketStrategySettings> | null | undefined,
  fallback: MarketStrategySettings,
): MarketStrategySettings => ({
  enabled: typeof raw?.enabled === "boolean" ? raw.enabled : fallback.enabled,
  mode: normalizeMarketMode(raw?.mode),
  entryThresholdBp: normalizeThreshold(raw?.entryThresholdBp, fallback.entryThresholdBp),
  exitThresholdBp: normalizeThreshold(raw?.exitThresholdBp, fallback.exitThresholdBp),
});

export const normalizeStrategyPreferences = (
  raw: Partial<StrategyPreferences> | null | undefined,
): StrategyPreferences => {
  const rawMarkets =
    raw?.markets && typeof raw.markets === "object"
      ? (raw.markets as Partial<Record<MarketId, Partial<MarketStrategySettings>>>)
      : {};

  const markets = STRATEGY_MARKETS.reduce<Record<MarketId, MarketStrategySettings>>((acc, marketId) => {
    acc[marketId] = normalizeMarketSettings(
      isMarketId(marketId) ? rawMarkets[marketId] : undefined,
      DEFAULT_STRATEGY_PREFERENCES.markets[marketId],
    );
    return acc;
  }, {} as Record<MarketId, MarketStrategySettings>);

  return {
    markets,
    aiPrompt:
      typeof raw?.aiPrompt === "string" && raw.aiPrompt.trim().length > 0
        ? raw.aiPrompt
        : DEFAULT_STRATEGY_PREFERENCES.aiPrompt,
    codexTokens:
      typeof raw?.codexTokens === "number" && Number.isFinite(raw.codexTokens) && raw.codexTokens > 0
        ? raw.codexTokens
        : DEFAULT_STRATEGY_PREFERENCES.codexTokens,
  };
};

export const getMarketStrategySettings = (
  preferences: StrategyPreferences,
  marketId: MarketId,
): MarketStrategySettings => preferences.markets[marketId];

export const getArmedStrategyIds = (preferences: StrategyPreferences): StrategyId[] => {
  const modes = new Set<StrategyId>();
  for (const marketId of STRATEGY_MARKETS) {
    const market = preferences.markets[marketId];
    if (!market.enabled) continue;
    modes.add(market.mode);
  }
  return Array.from(modes);
};

export const resolvePrimaryStrategyId = (
  preferences: StrategyPreferences,
  marketId: MarketId,
): StrategyId | null => {
  const market = preferences.markets[marketId];
  if (!market.enabled) return null;
  return market.mode;
};
