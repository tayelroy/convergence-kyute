
"use client";

import React from "react";

interface SavingsPortfolioProps {
    liveVaultBalance?: number | null;
    liveVaultAssetLabel?: string;
    loading?: boolean;
    className?: string;
    title?: string;
}

export function SavingsPortfolio({
    liveVaultBalance = null,
    liveVaultAssetLabel = "ETH",
    loading = false,
    className,
    title = "My Savings",
}: SavingsPortfolioProps) {
    const resolvedBalance = Number.isFinite(Number(liveVaultBalance))
        ? Math.max(0, Number(liveVaultBalance))
        : 0;
    const hasLiveBalance = resolvedBalance > 0.0000001;
    const totalValueLabel = hasLiveBalance ? `${resolvedBalance.toFixed(4)} ${liveVaultAssetLabel}` : "--";

    return (
        <div className={`h-full w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded-sm p-4 overflow-hidden flex flex-col ${className ?? ""}`}>
            <div className="flex items-center justify-between mb-3 shrink-0">
                <h2 className="text-sm font-bold text-white tracking-widest uppercase">{title}</h2>
                <span className="text-xs text-[#666] font-mono">Vault Balance: {loading ? "..." : totalValueLabel}</span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
                <table className="w-full table-fixed text-left border-collapse">
                    <thead className="sticky top-0 bg-[#0a0a0a]">
                        <tr className="border-b border-[#1a1a1a] text-[#444] text-xs font-mono uppercase">
                            <th className="w-[40%] py-2 pl-2">Asset</th>
                            <th className="w-[60%] py-2">Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        {hasLiveBalance && (
                            <tr className="border-b border-[#111]">
                                <td className="align-middle py-2 pl-2 font-mono text-sm text-white whitespace-nowrap">{liveVaultAssetLabel}</td>
                                <td className="align-middle py-2 font-mono text-sm text-[#888] whitespace-nowrap">{resolvedBalance.toFixed(4)} {liveVaultAssetLabel}</td>
                            </tr>
                        )}
                        {!loading && !hasLiveBalance && (
                            <tr>
                                <td colSpan={2} className="py-6 text-center text-xs text-[#666] font-mono">
                                    No live vault balance reported yet.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
