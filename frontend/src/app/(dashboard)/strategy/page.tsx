"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRightLeft,
  Bot,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  Waves,
} from "lucide-react";
import { useActiveAccount } from "thirdweb/react";
import { StrategyCard } from "@/components/strategy/StrategyCard";
import { VaultDepositPanel } from "@/components/strategy/VaultDepositPanel";
import { Button } from "@/components/ui/button";
import { kyuteVaultChainLabel } from "@/lib/chains";
import { formatAddress, getKyuteVaultAddress } from "@/lib/kyute-vault";

type StrategyId = "default_hedge" | "short_perp_fixed_lock" | "ai_custom";

type StrategyPreferences = {
  enabled: StrategyId[];
  aiPrompt: string;
  codexTokens: number;
};

const STORAGE_KEY = "kyute_strategy_preferences_v1";

const DEFAULT_PREFERENCES: StrategyPreferences = {
  enabled: ["default_hedge"],
  aiPrompt:
    "Find a funding-rate strategy that keeps Boros exposure collateralized by my vault deposit, limits directional beta, and makes the hedge leg explicit.",
  codexTokens: 8000,
};

const TOKEN_OPTIONS = [4000, 8000, 16000, 32000];

const STRATEGY_TITLES: Record<StrategyId, string> = {
  default_hedge: "Default hedge",
  short_perp_fixed_lock: "Receive-floating lock",
  ai_custom: "Codex strategy lab",
};

export default function StrategyPage() {
  const account = useActiveAccount();
  const [preferences, setPreferences] = useState<StrategyPreferences>(DEFAULT_PREFERENCES);
  const [copied, setCopied] = useState(false);
  const vaultAddress = getKyuteVaultAddress();

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<StrategyPreferences>;
      setPreferences({
        enabled: Array.isArray(parsed.enabled)
          ? parsed.enabled.filter((value): value is StrategyId =>
              value === "default_hedge" || value === "short_perp_fixed_lock" || value === "ai_custom",
            )
          : DEFAULT_PREFERENCES.enabled,
        aiPrompt:
          typeof parsed.aiPrompt === "string" && parsed.aiPrompt.trim().length > 0
            ? parsed.aiPrompt
            : DEFAULT_PREFERENCES.aiPrompt,
        codexTokens:
          typeof parsed.codexTokens === "number" && Number.isFinite(parsed.codexTokens)
            ? parsed.codexTokens
            : DEFAULT_PREFERENCES.codexTokens,
      });
    } catch {
      setPreferences(DEFAULT_PREFERENCES);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  const enabledStrategies = preferences.enabled;
  const activeTitles = enabledStrategies.map((id) => STRATEGY_TITLES[id]);
  const codexBrief = useMemo(() => {
    const enabledSummary = activeTitles.length > 0 ? activeTitles.join(", ") : "no baseline strategies";
    return [
      "Design a vault-aware funding strategy for kYUte.",
      `Enabled baselines: ${enabledSummary}.`,
      `Vault chain: ${kyuteVaultChainLabel}.`,
      `Vault address: ${vaultAddress ?? "unconfigured"}.`,
      `Connected wallet: ${account?.address ?? "not connected"}.`,
      `Codex token budget: ${preferences.codexTokens}.`,
      "",
      "Constraints:",
      "- Boros exposure must remain collateralized by the user's vault deposit.",
      "- Explain the perp leg, the Boros leg, and when the trade should unwind.",
      "- Prefer market-neutral constructions over raw directional bets.",
      "",
      "Prompt:",
      preferences.aiPrompt.trim(),
    ].join("\n");
  }, [account?.address, activeTitles, preferences.aiPrompt, preferences.codexTokens, vaultAddress]);

  const toggleStrategy = (strategyId: StrategyId) => {
    setPreferences((current) => {
      const exists = current.enabled.includes(strategyId);
      return {
        ...current,
        enabled: exists
          ? current.enabled.filter((id) => id !== strategyId)
          : [...current.enabled, strategyId],
      };
    });
  };

  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(codexBrief);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[34px] border border-white/8 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.2),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.16),_transparent_25%),linear-gradient(180deg,#0f1417,#090b0f)] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.35)]">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.34em] text-emerald-200/70">Strategy switchboard</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white">
              Arm the strategies you want the vault to respect, then fund the Boros side with your own deposit.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-neutral-300">
              This page is the operator surface for strategy selection. The default hedge is already wired into the executor. The other cards let you stage the next routing modes without losing the decision trail.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <HeroMetric
                label="Armed now"
                value={`${enabledStrategies.length}`}
                detail={enabledStrategies.length > 0 ? activeTitles.join(" / ") : "No strategies armed"}
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
                text="Live today. This follows the existing adverse-only hedge policy and opens the Boros leg only when the edge clears the configured threshold."
                accent="emerald"
              />
              <ExecutionNote
                title="Receive-floating lock"
                text="Frontend-configurable today. To execute it live, the backend needs the lock_fixed branch enabled instead of the current adverse_only mode."
                accent="cyan"
              />
              <ExecutionNote
                title="Codex strategy lab"
                text="Prompt drafting only. The page generates a strategy brief with a token budget, but it does not auto-submit to a backend planner yet."
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
            subtitle="The current live strategy. When your perp leg is paying floating and Boros can replace that exposure with fixed carry at a better edge, the executor opens the matching YU hedge."
            accentClassName="bg-[linear-gradient(90deg,#0ea5e9,#34d399)]"
            enabled={enabledStrategies.includes("default_hedge")}
            readiness="live"
            onToggle={() => toggleStrategy("default_hedge")}
            payoffLines={[
              "Perp leg: hold the existing directional exposure on Hyperliquid.",
              "Boros leg: long YU when the carry math beats fees and confidence gates.",
              "Net objective: blunt adverse floating payments and convert them into a fixed carry profile.",
            ]}
            detail="This is the strategy your current direct hedge cycle already understands. Leaving it disabled here does not stop the backend by itself yet; this page is the operator configuration layer."
          />

          <StrategyCard
            title="Receive-floating lock"
            subtitle="For the case where the perp is short and receiving floating funding. Shorting YU on Boros turns that floating inflow into fixed yield by paying the matching floating leg and taking fixed."
            accentClassName="bg-[linear-gradient(90deg,#38bdf8,#6366f1)]"
            enabled={enabledStrategies.includes("short_perp_fixed_lock")}
            readiness="config_only"
            onToggle={() => toggleStrategy("short_perp_fixed_lock")}
            payoffLines={[
              "Perp leg: short perp, receive floating funding.",
              "Boros leg: short YU, receive fixed and pay floating.",
              "Net objective: neutralize floating variability and lock the spread into fixed carry.",
            ]}
            detail="This is the mirror-image carry lock. It matches the lock_fixed branch conceptually, but your current executor still needs that mode wired through before this card can directly drive Boros actions."
          />

          <StrategyCard
            title="Codex strategy lab"
            subtitle="Draft a bespoke strategy brief for Codex. Use it to explore variants, add hard constraints, and decide how much reasoning budget you want to spend before you operationalize a new route."
            accentClassName="bg-[linear-gradient(90deg,#f59e0b,#fb7185)]"
            enabled={enabledStrategies.includes("ai_custom")}
            readiness="draft"
            onToggle={() => toggleStrategy("ai_custom")}
            payoffLines={[
              "Input: your own idea, constraints, and desired hedge behavior.",
              "Planner: Codex receives a token budget and a structured vault-aware prompt.",
              "Output: a strategy brief you can hand to the backend once the route is approved.",
            ]}
            detail="This card is deliberately honest: it drafts the brief and budget locally, but it does not spend tokens automatically. That keeps the page useful without pretending the planner loop exists already."
          >
            <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.24em] text-neutral-500">
                <Bot className="h-3.5 w-3.5 text-amber-300/80" />
                Prompt editor
              </div>
              <textarea
                value={preferences.aiPrompt}
                onChange={(event) =>
                  setPreferences((current) => ({ ...current, aiPrompt: event.target.value }))
                }
                rows={6}
                className="mt-3 w-full rounded-[22px] border border-white/10 bg-[#080a0d] px-4 py-3 text-sm leading-6 text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-amber-300/30"
                placeholder="Describe the trade structure you want Codex to design."
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
                  <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-neutral-500">Strategy brief</p>
                  <Button
                    type="button"
                    onClick={copyBrief}
                    variant="ghost"
                    className="h-9 rounded-full border border-amber-300/25 bg-amber-300/12 px-4 text-[11px] font-mono uppercase tracking-[0.18em] text-amber-100 hover:bg-amber-300/18"
                  >
                    {copied ? "Copied" : "Copy brief"}
                  </Button>
                </div>
                <pre className="mt-3 max-h-[280px] overflow-auto whitespace-pre-wrap rounded-2xl bg-black/25 p-4 text-xs leading-6 text-neutral-300">
                  {codexBrief}
                </pre>
              </div>
            </div>
          </StrategyCard>
        </div>

        <div className="space-y-6">
          <VaultDepositPanel />

          <section className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,#0d1015,#090b0f)] p-5">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.24em] text-neutral-500">
              <ArrowRightLeft className="h-3.5 w-3.5 text-cyan-300/80" />
              Armed profile
            </div>
            <div className="mt-4 space-y-3">
              {enabledStrategies.length > 0 ? (
                enabledStrategies.map((strategyId) => (
                  <div
                    key={strategyId}
                    className="rounded-[22px] border border-white/8 bg-black/20 px-4 py-3 text-sm text-neutral-200"
                  >
                    {STRATEGY_TITLES[strategyId]}
                  </div>
                ))
              ) : (
                <div className="rounded-[22px] border border-white/8 bg-black/20 px-4 py-3 text-sm text-neutral-500">
                  No strategies armed yet.
                </div>
              )}
            </div>

            <div className="mt-5 rounded-[22px] border border-white/8 bg-black/20 p-4">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.24em] text-neutral-500">
                <Waves className="h-3.5 w-3.5 text-emerald-300/80" />
                What this page controls
              </div>
              <p className="mt-3 text-sm leading-6 text-neutral-300">
                Today this page gives you a clean operator layer: local strategy intent, Codex prompt budgeting, and the actual vault deposit rail. The backend execution policy still needs to read these selections before they become hard controls.
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
