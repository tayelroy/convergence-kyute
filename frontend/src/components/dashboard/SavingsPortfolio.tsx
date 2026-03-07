
"use client";

import React from "react";
import { motion } from "framer-motion";
import type { AgentSnapshot, HedgeEvent } from "@/hooks/useAgentStatus";

interface SavingsPortfolioProps {
    latest: AgentSnapshot | null;
    hedges: HedgeEvent[];
    liveVaultBalance?: number | null;
    liveVaultAssetLabel?: string;
    loading?: boolean;
    className?: string;
    title?: string;
}

export function SavingsPortfolio({
    latest,
    hedges,
    liveVaultBalance = null,
    liveVaultAssetLabel = "ETH",
    loading = false,
    className,
    title = "My Savings",
}: SavingsPortfolioProps) {
    const latestHedge = hedges[0] ?? null;
    const risk = latest && latest.spread_bps >= 800 ? "High" : latest && latest.spread_bps >= 300 ? "Medium" : "Low";

    const resolvedBalance = Number.isFinite(Number(liveVaultBalance)) && Number(liveVaultBalance) > 0
        ? Number(liveVaultBalance)
        : latest?.vault_balance_eth ?? 0;
    const holdings = (latest || resolvedBalance > 0)
        ? [{
            asset: latest?.asset_symbol ?? liveVaultAssetLabel,
            balance: resolvedBalance,
            apy: latest?.boros_apr ?? 0,
            risk,
        }]
        : [];

    const totalValueLabel = holdings.length > 0 ? `${resolvedBalance.toFixed(4)} ${liveVaultAssetLabel}` : "--";

    return (
        <div className={`h-full w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded-sm p-4 overflow-hidden flex flex-col ${className ?? ""}`}>
            <div className="flex items-center justify-between mb-3 shrink-0">
                <h2 className="text-sm font-bold text-white tracking-widest uppercase">{title}</h2>
                <span className="text-xs text-[#666] font-mono">Vault Balance: {loading ? "..." : totalValueLabel}</span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#0a0a0a]">
                        <tr className="border-b border-[#1a1a1a] text-[#444] text-xs font-mono uppercase">
                            <th className="py-2 pl-2">Asset</th>
                            <th className="py-2">Balance</th>
                            <th className="py-2">Current APY</th>
                            <th className="py-2 text-right pr-2">Vol. Risk</th>
                        </tr>
                    </thead>
                    <tbody>
                        {holdings.map((h, i) => (
                            <motion.tr
                                key={h.asset}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.1 }}
                                className="border-b border-[#111] hover:bg-[#0f0f0f] transition-colors"
                            >
                                <td className="py-2 pl-2 font-mono text-sm text-white">{h.asset}</td>
                                <td className="py-2 font-mono text-sm text-[#888]">{h.balance.toFixed(4)} {liveVaultAssetLabel}</td>
                                <td className="py-2 font-mono text-sm text-[#00ff9d]">{h.apy.toFixed(2)}%</td>
                                <td className="py-2 pr-2 text-right">
                                    <span
                                        className={`px-2 py-1 text-[10px] uppercase tracking-wider rounded-sm ${h.risk === "High"
                                                ? "bg-red-500/10 text-red-500 border border-red-500/20"
                                                : h.risk === "Medium"
                                                    ? "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20"
                                                    : "bg-green-500/10 text-green-500 border border-green-500/20"
                                            }`}
                                    >
                                        {h.risk}
                                    </span>
                                </td>
                            </motion.tr>
                        ))}
                        {!loading && holdings.length === 0 && (
                            <tr>
                                <td colSpan={4} className="py-6 text-center text-xs text-[#666] font-mono">
                                    No live vault snapshots yet.
                                </td>
                            </tr>
                        )}
                        {latestHedge && (
                            <tr className="border-b border-[#111]">
                                <td colSpan={4} className="py-2 pl-2 text-[10px] text-[#666] font-mono">
                                    Last hedge: {Number(latestHedge.amount_eth ?? 0).toFixed(4)} ETH @ {new Date(latestHedge.timestamp).toLocaleString()}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
