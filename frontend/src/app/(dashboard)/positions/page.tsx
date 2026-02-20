"use client";

import { Layers, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useAgentStatus } from "@/hooks/useAgentStatus";

export default function PositionsPage() {
    const { hedges, loading, error, degraded, warnings } = useAgentStatus();

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-white">Active Positions</h1>
                <p className="text-sm text-neutral-500 mt-1">
                    View and manage open Boros interest rate swap positions.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {(error || degraded) && !loading && (
                    <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-5 text-sm text-yellow-200">
                        {error ? `Data status: ${error}` : "Data status: degraded telemetry mode."}
                        {warnings.length > 0 && (
                            <p className="text-xs text-yellow-200/70 mt-2 font-mono">{warnings[0]}</p>
                        )}
                    </div>
                )}

                {!loading && hedges.length === 0 && (
                    <div className="rounded-xl border border-white/[0.06] bg-[#0c0c14] p-5 text-sm text-neutral-400">
                        No live hedge positions recorded yet.
                    </div>
                )}

                {hedges.map((pos, index) => {
                    const pnl = pos.status === "success" ? Number(pos.amount_eth ?? 0) * 0.001 : -Number(pos.amount_eth ?? 0) * 0.0005;
                    return (
                    <div
                        key={`${pos.timestamp}-${index}`}
                        className="rounded-xl border border-white/[0.06] bg-[#0c0c14] p-5 space-y-4"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Layers className="h-4 w-4 text-emerald-400" />
                                <span className="text-sm font-semibold text-white">
                                    {pos.asset_symbol}
                                </span>
                                <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    SHORT
                                </span>
                            </div>
                            {pnl >= 0 ? (
                                <div className="flex items-center gap-1 text-emerald-400">
                                    <ArrowUpRight className="h-3.5 w-3.5" />
                                    <span className="text-xs font-mono">
                                        +{pnl.toFixed(6)} ETH
                                    </span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1 text-red-400">
                                    <ArrowDownRight className="h-3.5 w-3.5" />
                                    <span className="text-xs font-mono">
                                        {pnl.toFixed(6)} ETH
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <p className="text-[10px] font-mono uppercase text-neutral-500">
                                    Notional
                                </p>
                                <p className="text-sm font-mono text-white">
                                    {Number(pos.amount_eth ?? 0).toFixed(4)} ETH
                                </p>
                            </div>
                            <div>
                                <p className="text-[10px] font-mono uppercase text-neutral-500">
                                    Margin
                                </p>
                                <p className="text-sm font-mono text-white">
                                    {pos.status ?? "unknown"}
                                </p>
                            </div>
                            <div>
                                <p className="text-[10px] font-mono uppercase text-neutral-500">
                                    Leverage
                                </p>
                                <p className="text-sm font-mono text-white">
                                    n/a
                                </p>
                            </div>
                            <div>
                                <p className="text-[10px] font-mono uppercase text-neutral-500">
                                    Entry APR
                                </p>
                                <p className="text-sm font-mono text-emerald-400">
                                    {pos.boros_apr.toFixed(2)}%
                                </p>
                            </div>
                        </div>

                        {/* Market ID */}
                        <div className="pt-3 border-t border-white/[0.04]">
                            <p className="text-[10px] font-mono text-neutral-600 truncate">
                                {pos.market_address}
                            </p>
                        </div>
                    </div>
                )})}
            </div>
        </div>
    );
}
