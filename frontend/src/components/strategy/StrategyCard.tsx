"use client";

import type { ReactNode } from "react";
import { Check, CircleDashed, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type StrategyCardProps = {
  title: string;
  subtitle: string;
  accentClassName: string;
  enabled: boolean;
  readiness: "live" | "config_only" | "draft";
  payoffLines: string[];
  detail: string;
  onToggle: () => void;
  children?: ReactNode;
};

const readinessLabel: Record<StrategyCardProps["readiness"], string> = {
  live: "Live executor path",
  config_only: "UI config only",
  draft: "Draft prompt only",
};

export function StrategyCard({
  title,
  subtitle,
  accentClassName,
  enabled,
  readiness,
  payoffLines,
  detail,
  onToggle,
  children,
}: StrategyCardProps) {
  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-[28px] border border-white/8 bg-[#0a0d12] p-5 shadow-[0_12px_50px_rgba(0,0,0,0.25)]",
        enabled ? "ring-1 ring-white/8" : "",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-1.5 rounded-t-[28px]",
          accentClassName,
        )}
      />
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.24em]",
                enabled
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                  : "border-white/10 bg-white/5 text-neutral-500",
              )}
            >
              {enabled ? (
                <>
                  <Check className="mr-1.5 h-3 w-3" />
                  Armed
                </>
              ) : (
                <>
                  <CircleDashed className="mr-1.5 h-3 w-3" />
                  Parked
                </>
              )}
            </span>
            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-neutral-400">
              {readinessLabel[readiness]}
            </span>
          </div>
          <h2 className="mt-4 text-xl font-semibold tracking-tight text-white">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">{subtitle}</p>
        </div>

        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "inline-flex h-11 shrink-0 items-center justify-center rounded-full border px-4 text-xs font-mono uppercase tracking-[0.2em] transition-colors",
            enabled
              ? "border-emerald-400/30 bg-emerald-400/12 text-emerald-300 hover:bg-emerald-400/18"
              : "border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10",
          )}
        >
          {enabled ? "Enabled" : "Enable"}
        </button>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
          <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-neutral-500">Payoff shape</p>
          <div className="mt-3 space-y-2">
            {payoffLines.map((line) => (
              <div
                key={line}
                className="rounded-2xl border border-white/6 bg-white/[0.03] px-3 py-2 text-sm text-neutral-200"
              >
                {line}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.24em] text-amber-300/80">
            <ShieldAlert className="h-3.5 w-3.5" />
            Execution note
          </div>
          <p className="mt-3 text-sm leading-6 text-neutral-300">{detail}</p>
        </div>
      </div>

      {children ? <div className="mt-5">{children}</div> : null}
    </article>
  );
}
