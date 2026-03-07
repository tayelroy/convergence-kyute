import type {
  MarketId,
  MarketStrategyMode,
  MarketStrategySettings,
  StrategyPreferences,
} from "@/lib/strategy-preferences";

export type AiStrategyMarketPatch = Partial<{
  enabled: boolean;
  mode: MarketStrategyMode;
  entryThresholdBp: number;
  exitThresholdBp: number;
}>;

export type AiStrategyPlan = {
  title: string;
  summary: string;
  confidence: "low" | "medium" | "high";
  rationale: string[];
  warnings: string[];
  marketPatch: Partial<Record<MarketId, AiStrategyMarketPatch>>;
};

const ensureStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0)
    : [];

const normalizeConfidence = (value: unknown): AiStrategyPlan["confidence"] =>
  value === "low" || value === "medium" || value === "high" ? value : "medium";

const normalizeMode = (value: unknown): MarketStrategyMode | undefined =>
  value === "dynamic_regime_hedge" || value === "short_perp_fixed_lock"
    ? "dynamic_regime_hedge"
    : value === "default_hedge"
      ? "default_hedge"
      : undefined;

const normalizeThreshold = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;

const normalizeMarketPatch = (value: unknown): AiStrategyMarketPatch => {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const mode = normalizeMode(raw.mode);
  const patch: AiStrategyMarketPatch = {};

  if (typeof raw.enabled === "boolean") patch.enabled = raw.enabled;
  if (mode) patch.mode = mode;
  const entry = normalizeThreshold(raw.entryThresholdBp);
  const exit = normalizeThreshold(raw.exitThresholdBp);
  if (entry !== undefined) patch.entryThresholdBp = entry;
  if (exit !== undefined) patch.exitThresholdBp = exit;
  return patch;
};

export const normalizeAiStrategyPlan = (raw: unknown): AiStrategyPlan => {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawMarketPatch =
    value.marketPatch && typeof value.marketPatch === "object"
      ? (value.marketPatch as Record<string, unknown>)
      : {};

  return {
    title:
      typeof value.title === "string" && value.title.trim().length > 0
        ? value.title.trim()
        : "Untitled strategy",
    summary:
      typeof value.summary === "string" && value.summary.trim().length > 0
        ? value.summary.trim()
        : "No summary returned.",
    confidence: normalizeConfidence(value.confidence),
    rationale: ensureStringArray(value.rationale),
    warnings: ensureStringArray(value.warnings),
    marketPatch: {
      ETHUSDC: normalizeMarketPatch(rawMarketPatch.ETHUSDC),
      BTCUSDC: normalizeMarketPatch(rawMarketPatch.BTCUSDC),
    },
  };
};

export const createAiStrategyBrief = (plan: AiStrategyPlan): string =>
  [
    `Title: ${plan.title}`,
    `Summary: ${plan.summary}`,
    `Confidence: ${plan.confidence}`,
    "",
    "Market patch:",
    ...Object.entries(plan.marketPatch).flatMap(([marketId, patch]) => {
      const entries = Object.entries(patch ?? {});
      if (entries.length === 0) return [`- ${marketId}: no changes`];
      return [
        `- ${marketId}:`,
        ...entries.map(([key, value]) => `  - ${key}: ${String(value)}`),
      ];
    }),
    "",
    "Rationale:",
    ...plan.rationale.map((line) => `- ${line}`),
    "",
    "Warnings:",
    ...plan.warnings.map((line) => `- ${line}`),
  ].join("\n");

export const applyAiStrategyPatch = (
  preferences: StrategyPreferences,
  patch: AiStrategyPlan["marketPatch"],
): StrategyPreferences => {
  const next: StrategyPreferences = {
    ...preferences,
    markets: {
      ...preferences.markets,
    },
  };

  (Object.keys(patch) as MarketId[]).forEach((marketId) => {
    const marketPatch = patch[marketId];
    if (!marketPatch) return;
    next.markets[marketId] = {
      ...preferences.markets[marketId],
      ...marketPatch,
    } as MarketStrategySettings;
  });

  return next;
};
