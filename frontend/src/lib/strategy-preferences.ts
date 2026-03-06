export type StrategyId = "default_hedge" | "dynamic_regime_hedge" | "short_perp_fixed_lock" | "ai_custom";

export type StrategyPreferences = {
  enabled: StrategyId[];
  aiPrompt: string;
  codexTokens: number;
};

export const STRATEGY_STORAGE_KEY = "kyute_strategy_preferences_v1";

export const DEFAULT_STRATEGY_PREFERENCES: StrategyPreferences = {
  enabled: ["default_hedge"],
  aiPrompt:
    "Find a funding-rate strategy that keeps Boros exposure collateralized by my vault deposit, limits directional beta, and makes the hedge leg explicit.",
  codexTokens: 8000,
};

const VALID_STRATEGY_IDS: StrategyId[] = [
  "default_hedge",
  "dynamic_regime_hedge",
  "short_perp_fixed_lock",
  "ai_custom",
];

const normalizeStrategyId = (value: StrategyId): StrategyId =>
  value === "short_perp_fixed_lock" ? "dynamic_regime_hedge" : value;

const isStrategyId = (value: unknown): value is StrategyId =>
  typeof value === "string" && VALID_STRATEGY_IDS.includes(value as StrategyId);

export const normalizeStrategyPreferences = (
  raw: Partial<StrategyPreferences> | null | undefined,
): StrategyPreferences => ({
  enabled: Array.isArray(raw?.enabled)
    ? Array.from(
        new Set(
          raw.enabled
            .filter((value): value is StrategyId => isStrategyId(value))
            .map((value) => normalizeStrategyId(value)),
        ),
      )
    : DEFAULT_STRATEGY_PREFERENCES.enabled,
  aiPrompt:
    typeof raw?.aiPrompt === "string" && raw.aiPrompt.trim().length > 0
      ? raw.aiPrompt
      : DEFAULT_STRATEGY_PREFERENCES.aiPrompt,
  codexTokens:
    typeof raw?.codexTokens === "number" && Number.isFinite(raw.codexTokens) && raw.codexTokens > 0
      ? raw.codexTokens
      : DEFAULT_STRATEGY_PREFERENCES.codexTokens,
});

export const resolvePrimaryStrategyId = (preferences: StrategyPreferences): StrategyId | null => {
  const enabled = preferences.enabled.filter((value): value is StrategyId => isStrategyId(value));
  if (enabled.length === 0) return null;
  if (enabled.includes("dynamic_regime_hedge")) return "dynamic_regime_hedge";
  if (enabled.includes("short_perp_fixed_lock")) return "dynamic_regime_hedge";
  if (enabled.includes("default_hedge")) return "default_hedge";
  return enabled[enabled.length - 1] ?? null;
};
