"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRightLeft,
  Bot,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Waves,
} from "lucide-react";
import { useActiveAccount } from "thirdweb/react";
import { DemoFaucetPanel } from "@/components/strategy/DemoFaucetPanel";
import { StrategyCard } from "@/components/strategy/StrategyCard";
import { VaultDepositPanel } from "@/components/strategy/VaultDepositPanel";
import { Button } from "@/components/ui/button";
import {
  applyAiStrategyPatch,
  createAiStrategyBrief,
  type AiStrategyPlan,
} from "@/lib/ai-strategy";
import { kyuteVaultChainLabel } from "@/lib/chains";
import { formatAddress, getKyuteVaultAddress } from "@/lib/kyute-vault";
import {
  DEFAULT_STRATEGY_PREFERENCES,
  STRATEGY_MARKETS,
  STRATEGY_STORAGE_KEY,
  getArmedStrategyIds,
  normalizeStrategyPreferences,
  type MarketId,
  type MarketStrategyMode,
  type StrategyPreferences,
} from "@/lib/strategy-preferences";

const TOKEN_OPTIONS = [4000, 8000, 16000, 32000];
const MODE_OPTIONS: Array<{ value: MarketStrategyMode; label: string }> = [
  { value: "default_hedge", label: "Default hedge" },
  { value: "dynamic_regime_hedge", label: "Dynamic regime hedge" },
];
const MARKET_TITLES: Record<MarketId, string> = {
  ETHUSDC: "ETH / USDC",
  BTCUSDC: "BTC / USDC",
};

export default function StrategyPage() {
  const account = useActiveAccount();
  const vaultAddress = getKyuteVaultAddress();
  const [preferences, setPreferences] = useState<StrategyPreferences>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_STRATEGY_PREFERENCES;
    }

    try {
      const raw = window.localStorage.getItem(STRATEGY_STORAGE_KEY);
      if (!raw) return DEFAULT_STRATEGY_PREFERENCES;
      return normalizeStrategyPreferences(JSON.parse(raw) as Partial<StrategyPreferences>);
    } catch {
      return DEFAULT_STRATEGY_PREFERENCES;
    }
  });
  const [generatedPlan, setGeneratedPlan] = useState<AiStrategyPlan | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAiLabExpanded, setIsAiLabExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [remoteLoaded, setRemoteLoaded] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    let cancelled = false;

    if (!account?.address) {
      setRemoteLoaded(true);
      return () => {
        cancelled = true;
      };
    }

    setRemoteLoaded(false);
    void (async () => {
      try {
        const params = new URLSearchParams({ walletAddress: account.address });
        const response = await fetch(`/api/strategy-preferences?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          ok: boolean;
          preferences?: Partial<StrategyPreferences> | null;
        };

        if (!cancelled && response.ok && payload.ok && payload.preferences) {
          setPreferences(normalizeStrategyPreferences(payload.preferences));
        }
      } catch {
        // Local storage remains the fallback source.
      } finally {
        if (!cancelled) setRemoteLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account?.address]);

  useEffect(() => {
    if (!account?.address || !remoteLoaded) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void fetch("/api/strategy-preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: account.address,
          vaultAddress: vaultAddress ?? null,
          preferences,
        }),
      }).catch(() => {
        // Local state remains usable if save fails.
      });
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [account?.address, preferences, remoteLoaded, vaultAddress]);

  const armedStrategyIds = getArmedStrategyIds(preferences);
  const activeTitles = armedStrategyIds.map((strategyId) =>
    strategyId === "dynamic_regime_hedge" ? "Dynamic regime hedge" : "Default hedge",
  );
  const activeMarketCount = STRATEGY_MARKETS.filter((marketId) => preferences.markets[marketId].enabled).length;

  const codexBrief = useMemo(() => {
    const marketLines = STRATEGY_MARKETS.map((marketId) => {
      const market = preferences.markets[marketId];
      return `${marketId}: enabled=${market.enabled}, mode=${market.mode}, entryThresholdBp=${market.entryThresholdBp}, exitThresholdBp=${market.exitThresholdBp}`;
    });

    return [
      "Fill the kYUte strategy form using only existing fields.",
      `Vault chain: ${kyuteVaultChainLabel}.`,
      `Vault address: ${vaultAddress ?? "unconfigured"}.`,
      `Connected wallet: ${account?.address ?? "not connected"}.`,
      `ChatGPT token budget: ${preferences.codexTokens}.`,
      "",
      "Current market settings:",
      ...marketLines,
      "",
      "Prompt:",
      preferences.aiPrompt.trim(),
    ].join("\n");
  }, [account?.address, preferences, vaultAddress]);

  const generatedBrief = useMemo(
    () => (generatedPlan ? createAiStrategyBrief(generatedPlan) : null),
    [generatedPlan],
  );

  const setMarketValue = <K extends keyof StrategyPreferences["markets"][MarketId]>(
    marketId: MarketId,
    key: K,
    value: StrategyPreferences["markets"][MarketId][K],
  ) => {
    setPreferences((current) => ({
      ...current,
      markets: {
        ...current.markets,
        [marketId]: {
          ...current.markets[marketId],
          [key]: value,
        },
      },
    }));
  };

  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(generatedBrief ?? codexBrief);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const generateStrategy = async () => {
    setIsGenerating(true);
    setGenerationError(null);
    try {
      const response = await fetch("/api/strategy-generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: account?.address ?? null,
          vaultAddress: vaultAddress ?? null,
          preferences,
        }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
        plan?: AiStrategyPlan;
      };
      if (!response.ok || !payload.ok || !payload.plan) {
        throw new Error(payload.error ?? "Strategy generation failed.");
      }
      setGeneratedPlan(payload.plan);
    } catch (error) {
      setGeneratedPlan(null);
      setGenerationError(error instanceof Error ? error.message : "Strategy generation failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const applyPlanToForm = () => {
    if (!generatedPlan) return;
    setPreferences((current) => applyAiStrategyPatch(current, generatedPlan.marketPatch));
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[34px] border border-white/8 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.2),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.16),_transparent_25%),linear-gradient(180deg,#0f1417,#090b0f)] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.35)]">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.34em] text-emerald-200/70">Strategy switchboard</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white">
              Configure each market explicitly, then let AI patch the same form the executor reads.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-neutral-300">
              The saved strategy is now a market-scoped config. ETH and BTC each have their own enabled flag, mode, and thresholds, and the AI planner only proposes patches to those live fields.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <HeroMetric
                label="Markets armed"
                value={`${activeMarketCount}`}
                detail={activeTitles.length > 0 ? activeTitles.join(" / ") : "No live markets armed"}
                icon={<CheckCircle2 className="h-4 w-4" />}
              />
              <HeroMetric
                label="Vault chain"
                value={kyuteVaultChainLabel}
                detail={formatAddress(vaultAddress, 5)}
                icon={<ShieldCheck className="h-4 w-4" />}
              />
              <HeroMetric
                label="Operator wallet"
                value={formatAddress(account?.address, 5)}
                detail={account?.address ? "Connected" : "Connect wallet"}
                icon={<Sparkles className="h-4 w-4" />}
              />
            </div>
          </div>

          <div className="rounded-[28px] border border-white/8 bg-black/20 p-5">
            <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-neutral-500">Execution reality</p>
            <div className="mt-4 space-y-3">
              <ExecutionNote
                title="Default hedge"
                text="Per market, this maps to adverse_only. Use it when you want the engine to hedge only pay-floating regimes."
                accent="emerald"
              />
              <ExecutionNote
                title="Dynamic regime hedge"
                text="Per market, this maps to lock_fixed. It still uses the standard hedge in pay-floating conditions and prefers fixed-lock hedging in receive-floating conditions."
                accent="cyan"
              />
              <ExecutionNote
                title="AI planner"
                text="Live today as a form patcher. It proposes edits to market enabled flags, modes, and thresholds, and you stay in control of the final saved config."
                accent="amber"
              />
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_420px]">
        <div className="space-y-6">
          <StrategyCard
            title="Default hedge"
            subtitle="The standard pay-floating hedge. Use this per market when you want the executor to open Boros only when your perp leg is paying floating and the edge clears your thresholds."
            accentClassName="bg-[linear-gradient(90deg,#0ea5e9,#34d399)]"
            enabled={STRATEGY_MARKETS.some(
              (marketId) =>
                preferences.markets[marketId].enabled &&
                preferences.markets[marketId].mode === "default_hedge",
            )}
            readiness="live"
            actionLabel="Configured below"
            payoffLines={[
              "Perp leg: keep the directional perp exposure on Hyperliquid.",
              "Boros leg: long YU when carry beats fixed cost and thresholds.",
              "Net objective: neutralize floating payments with a fixed carry profile.",
            ]}
            detail="This is a per-market mode now. Use the form below to decide where it is armed and how conservative the thresholds should be."
          />

          <StrategyCard
            title="Dynamic regime hedge"
            subtitle="A dynamic policy, not a permanent hedge shape. It adapts by market: default hedge in pay-floating conditions, fixed-lock preference in receive-floating conditions."
            accentClassName="bg-[linear-gradient(90deg,#38bdf8,#6366f1)]"
            enabled={STRATEGY_MARKETS.some(
              (marketId) =>
                preferences.markets[marketId].enabled &&
                preferences.markets[marketId].mode === "dynamic_regime_hedge",
            )}
            readiness="live"
            actionLabel="Configured below"
            payoffLines={[
              "Pay-floating regime: route to the standard long-YU hedge.",
              "Receive-floating regime: prefer the fixed-lock short-YU hedge.",
              "Net objective: adapt the Boros leg to the current funding regime per market.",
            ]}
            detail="This is also configured per market. The executor now reads the saved market row and uses the row’s mode and thresholds on the next run."
          />

          <StrategyCard
            title="Codex strategy lab"
            subtitle="Prompt ChatGPT to patch the existing ETH/BTC strategy form. It returns only changes to enabled flags, modes, and thresholds, plus rationale and warnings."
            accentClassName="bg-[linear-gradient(90deg,#f59e0b,#fb7185)]"
            enabled={Boolean(generatedPlan)}
            readiness="config_only"
            actionLabel="Advisory"
            payoffLines={[
              "Input: your own idea, constraints, and market-specific intent.",
              "Planner: ChatGPT proposes only supported form edits for ETHUSDC and BTCUSDC.",
              "Output: a patch you can apply to the form and save to Supabase for CRE to use next run.",
            ]}
            detail="This planner is live, but it is still controlled. It cannot invent new executor logic; it only edits the fields the current product already supports."
          >
            <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.24em] text-neutral-500">
                  <Bot className="h-3.5 w-3.5 text-amber-300/80" />
                  Prompt editor
                </div>
                <button
                  type="button"
                  onClick={() => setIsAiLabExpanded((current) => !current)}
                  className="inline-flex h-9 items-center justify-center rounded-full border border-white/10 bg-white/5 px-3 text-[11px] font-mono uppercase tracking-[0.18em] text-neutral-300 transition-colors hover:bg-white/8"
                >
                  {isAiLabExpanded ? (
                    <>
                      <ChevronUp className="mr-2 h-3.5 w-3.5" />
                      Collapse
                    </>
                  ) : (
                    <>
                      <ChevronDown className="mr-2 h-3.5 w-3.5" />
                      Expand
                    </>
                  )}
                </button>
              </div>

              {!isAiLabExpanded ? (
                <div className="mt-4 rounded-[22px] border border-white/8 bg-[#08090c] px-4 py-3 text-sm leading-6 text-neutral-300">
                  {generatedPlan
                    ? `Latest plan: ${generatedPlan.title}. Apply the suggested ETH/BTC changes to the form when you want to keep them.`
                    : "Prompt, budget, and generated patch are hidden until you expand the lab."}
                </div>
              ) : (
                <>
                  <textarea
                    value={preferences.aiPrompt}
                    onChange={(event) =>
                      setPreferences((current) => ({ ...current, aiPrompt: event.target.value }))
                    }
                    rows={6}
                    className="mt-3 w-full rounded-[22px] border border-white/10 bg-[#080a0d] px-4 py-3 text-sm leading-6 text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-amber-300/30"
                    placeholder="Example: Pause BTC and make ETH more conservative."
                  />

                  <div className="mt-4 flex flex-wrap gap-2">
                    {TOKEN_OPTIONS.map((tokens) => {
                      const active = preferences.codexTokens === tokens;
                      return (
                        <button
                          key={tokens}
                          type="button"
                          onClick={() =>
                            setPreferences((current) => ({ ...current, codexTokens: tokens }))
                          }
                          className={`rounded-full border px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.18em] transition-colors ${
                            active
                              ? "border-amber-300/35 bg-amber-300/12 text-amber-100"
                              : "border-white/10 bg-white/5 text-neutral-400 hover:bg-white/8"
                          }`}
                        >
                          {tokens.toLocaleString()} tokens
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 rounded-[22px] border border-white/8 bg-[#08090c] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-neutral-500">
                        Strategy planner
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          onClick={generateStrategy}
                          disabled={isGenerating}
                          variant="ghost"
                          className="h-9 rounded-full border border-amber-300/25 bg-amber-300/12 px-4 text-[11px] font-mono uppercase tracking-[0.18em] text-amber-100 hover:bg-amber-300/18 disabled:opacity-60"
                        >
                          {isGenerating ? (
                            <>
                              <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
                              Generating
                            </>
                          ) : (
                            "Generate with ChatGPT"
                          )}
                        </Button>
                        <Button
                          type="button"
                          onClick={copyBrief}
                          variant="ghost"
                          className="h-9 rounded-full border border-white/10 bg-white/5 px-4 text-[11px] font-mono uppercase tracking-[0.18em] text-neutral-200 hover:bg-white/8"
                        >
                          {copied ? "Copied" : "Copy brief"}
                        </Button>
                      </div>
                    </div>

                    {generationError ? (
                      <div className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                        {generationError}
                      </div>
                    ) : null}

                    {generatedPlan ? (
                      <div className="mt-3 space-y-4 rounded-2xl border border-white/8 bg-black/25 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-lg font-semibold tracking-tight text-white">{generatedPlan.title}</p>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-300">{generatedPlan.summary}</p>
                          </div>
                          <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.22em] text-cyan-200">
                            {generatedPlan.confidence} confidence
                          </span>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          {STRATEGY_MARKETS.map((marketId) => (
                            <PatchPreview
                              key={marketId}
                              marketId={marketId}
                              patch={generatedPlan.marketPatch[marketId]}
                            />
                          ))}
                        </div>

                        {generatedPlan.rationale.length > 0 ? (
                          <PlanList title="Rationale" items={generatedPlan.rationale} />
                        ) : null}
                        {generatedPlan.warnings.length > 0 ? (
                          <PlanList title="Warnings" items={generatedPlan.warnings} tone="warn" />
                        ) : null}

                        <div className="flex justify-end">
                          <Button
                            type="button"
                            onClick={applyPlanToForm}
                            className="h-10 rounded-full border border-emerald-400/25 bg-emerald-400/12 px-4 text-[11px] font-mono uppercase tracking-[0.18em] text-emerald-100 hover:bg-emerald-400/18"
                          >
                            Apply patch to form
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <pre className="mt-3 max-h-[280px] overflow-auto whitespace-pre-wrap rounded-2xl bg-black/25 p-4 text-xs leading-6 text-neutral-300">
                        {codexBrief}
                      </pre>
                    )}
                  </div>
                </>
              )}
            </div>
          </StrategyCard>
        </div>

        <div className="space-y-6">
          <DemoFaucetPanel />
          <VaultDepositPanel />

          <section className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,#0d1015,#090b0f)] p-5">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.24em] text-neutral-500">
              <ArrowRightLeft className="h-3.5 w-3.5 text-cyan-300/80" />
              Market strategy form
            </div>
            <div className="mt-4 space-y-4">
              {STRATEGY_MARKETS.map((marketId) => {
                const market = preferences.markets[marketId];
                return (
                  <div key={marketId} className="rounded-[22px] border border-white/8 bg-black/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold tracking-wide text-white">{MARKET_TITLES[marketId]}</p>
                        <p className="mt-1 text-xs font-mono uppercase tracking-[0.18em] text-neutral-500">
                          CRE reads this row on the next run
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMarketValue(marketId, "enabled", !market.enabled)}
                        className={`rounded-full border px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.18em] ${
                          market.enabled
                            ? "border-emerald-400/30 bg-emerald-400/12 text-emerald-200"
                            : "border-white/10 bg-white/5 text-neutral-400"
                        }`}
                      >
                        {market.enabled ? "Enabled" : "Disabled"}
                      </button>
                    </div>

                    <div className="mt-4 space-y-4">
                      <label className="block">
                        <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-neutral-500">
                          Hedge mode
                        </span>
                        <select
                          value={market.mode}
                          onChange={(event) =>
                            setMarketValue(marketId, "mode", event.target.value as MarketStrategyMode)
                          }
                          className="mt-2 w-full rounded-2xl border border-white/10 bg-[#080a0d] px-4 py-3 text-sm text-neutral-200 outline-none focus:border-cyan-300/30"
                        >
                          {MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <ThresholdField
                          label="Entry threshold (bp)"
                          value={market.entryThresholdBp}
                          onChange={(value) => setMarketValue(marketId, "entryThresholdBp", value)}
                        />
                        <ThresholdField
                          label="Exit threshold (bp)"
                          value={market.exitThresholdBp}
                          onChange={(value) => setMarketValue(marketId, "exitThresholdBp", value)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 rounded-[22px] border border-white/8 bg-black/20 p-4">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.24em] text-neutral-500">
                <Waves className="h-3.5 w-3.5 text-emerald-300/80" />
                What gets saved
              </div>
              <p className="mt-3 text-sm leading-6 text-neutral-300">
                Save is automatic. Each market writes its own Supabase row with four live controls: enabled, mode, entry threshold, and exit threshold. CRE reads those values on the next run.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function HeroMetric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.24em] text-neutral-500">
        <span className="text-emerald-300/80">{icon}</span>
        {label}
      </div>
      <p className="mt-3 text-lg font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-xs font-mono text-neutral-500">{detail}</p>
    </div>
  );
}

function ExecutionNote({
  title,
  text,
  accent,
}: {
  title: string;
  text: string;
  accent: "emerald" | "cyan" | "amber";
}) {
  const accentClass =
    accent === "emerald"
      ? "border-emerald-400/15 bg-emerald-400/8 text-emerald-100"
      : accent === "cyan"
        ? "border-cyan-400/15 bg-cyan-400/8 text-cyan-100"
        : "border-amber-300/15 bg-amber-300/8 text-amber-100";

  return (
    <div className={`rounded-[22px] border px-4 py-3 ${accentClass}`}>
      <p className="text-xs font-semibold tracking-wide">{title}</p>
      <p className="mt-1 text-sm leading-6 text-white/85">{text}</p>
    </div>
  );
}

function ThresholdField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-neutral-500">{label}</span>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
        className="mt-2 w-full rounded-2xl border border-white/10 bg-[#080a0d] px-4 py-3 text-sm text-neutral-200 outline-none focus:border-cyan-300/30"
      />
    </label>
  );
}

function PatchPreview({
  marketId,
  patch,
}: {
  marketId: MarketId;
  patch: AiStrategyPlan["marketPatch"][MarketId];
}) {
  const entries = patch ? Object.entries(patch) : [];
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-neutral-500">{MARKET_TITLES[marketId]}</p>
      <div className="mt-3 space-y-2">
        {entries.length === 0 ? (
          <div className="rounded-xl border border-white/6 bg-black/20 px-3 py-2 text-sm text-neutral-500">
            No changes proposed.
          </div>
        ) : (
          entries.map(([key, value]) => (
            <div
              key={`${marketId}-${key}`}
              className="rounded-xl border border-white/6 bg-black/20 px-3 py-2 text-sm text-neutral-200"
            >
              <span className="font-mono uppercase tracking-[0.16em] text-neutral-500">{key}</span>: {String(value)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PlanList({
  title,
  items,
  tone = "default",
}: {
  title: string;
  items: string[];
  tone?: "default" | "warn";
}) {
  const classes =
    tone === "warn" ? "border-amber-300/15 bg-amber-300/6" : "border-white/8 bg-white/[0.03]";

  return (
    <div className={`rounded-2xl border p-4 ${classes}`}>
      <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-neutral-500">{title}</p>
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div
            key={`${title}-${item}`}
            className="rounded-xl border border-white/6 bg-black/20 px-3 py-2 text-sm leading-6 text-neutral-200"
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
