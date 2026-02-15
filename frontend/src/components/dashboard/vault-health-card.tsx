"use client";

import { Shield, DollarSign, Gauge, Clock } from "lucide-react";
import type { VaultHealth } from "@/types/boros";

interface VaultHealthCardProps {
    data: VaultHealth;
}

function StatItem({
    icon: Icon,
    label,
    value,
    subValue,
    accent = false,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
    subValue?: string;
    accent?: boolean;
}) {
    return (
        <div className="flex items-start gap-3">
            <div
                className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent
                        ? "bg-emerald-500/10 border border-emerald-500/20"
                        : "bg-white/[0.04] border border-white/[0.06]"
                    }`}
            >
                <Icon
                    className={`h-4 w-4 ${accent ? "text-emerald-400" : "text-neutral-400"}`}
                />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-500">
                    {label}
                </p>
                <p className="text-lg font-semibold text-white leading-tight mt-0.5">
                    {value}
                </p>
                {subValue && (
                    <p className="text-[11px] font-mono text-neutral-600 mt-0.5">
                        {subValue}
                    </p>
                )}
            </div>
        </div>
    );
}

export function VaultHealthCard({ data }: VaultHealthCardProps) {
    return (
        <div className="rounded-xl border border-white/[0.06] bg-[#0c0c14] p-5">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-emerald-400" />
                    <h2 className="text-sm font-semibold text-white">Vault Health</h2>
                </div>
                <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    <span className="text-[10px] font-mono font-semibold text-emerald-400">
                        HEALTHY
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-5">
                <StatItem
                    icon={DollarSign}
                    label="Total Notional"
                    value={`$${(data.totalNotional / 1_000_000).toFixed(2)}M`}
                    subValue={`${data.activePairs} active pairs`}
                />
                <StatItem
                    icon={DollarSign}
                    label="Active Margin"
                    value={`$${(data.activeMargin / 1_000).toFixed(1)}K`}
                />
                <StatItem
                    icon={Gauge}
                    label="Current Leverage"
                    value={`${data.currentLeverage}x`}
                    subValue={`${data.uptime}% uptime`}
                />
                <StatItem
                    icon={Clock}
                    label="Est. Hourly Yield"
                    value={`$${data.estimatedHourlyYield.toFixed(2)}`}
                    subValue="USDC"
                    accent
                />
            </div>
        </div>
    );
}
