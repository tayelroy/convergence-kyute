"use client";

import { Layers, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { mockPositions } from "@/lib/mock-data";

export default function PositionsPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-white">Active Positions</h1>
                <p className="text-sm text-neutral-500 mt-1">
                    View and manage open Boros interest rate swap positions.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {mockPositions.map((pos) => (
                    <div
                        key={pos.marketId}
                        className="rounded-xl border border-white/[0.06] bg-[#0c0c14] p-5 space-y-4"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Layers className="h-4 w-4 text-emerald-400" />
                                <span className="text-sm font-semibold text-white">
                                    {pos.asset}
                                </span>
                                <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    {pos.side}
                                </span>
                            </div>
                            {pos.unrealizedPnl >= 0 ? (
                                <div className="flex items-center gap-1 text-emerald-400">
                                    <ArrowUpRight className="h-3.5 w-3.5" />
                                    <span className="text-xs font-mono">
                                        +${pos.unrealizedPnl.toFixed(2)}
                                    </span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1 text-red-400">
                                    <ArrowDownRight className="h-3.5 w-3.5" />
                                    <span className="text-xs font-mono">
                                        ${pos.unrealizedPnl.toFixed(2)}
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
                                    ${(pos.notionalUsd / 1_000).toFixed(0)}K
                                </p>
                            </div>
                            <div>
                                <p className="text-[10px] font-mono uppercase text-neutral-500">
                                    Margin
                                </p>
                                <p className="text-sm font-mono text-white">
                                    ${(pos.marginUsd / 1_000).toFixed(1)}K
                                </p>
                            </div>
                            <div>
                                <p className="text-[10px] font-mono uppercase text-neutral-500">
                                    Leverage
                                </p>
                                <p className="text-sm font-mono text-white">
                                    {pos.leverage}x
                                </p>
                            </div>
                            <div>
                                <p className="text-[10px] font-mono uppercase text-neutral-500">
                                    Entry APR
                                </p>
                                <p className="text-sm font-mono text-emerald-400">
                                    {pos.entryImpliedApr.toFixed(1)}%
                                </p>
                            </div>
                        </div>

                        {/* Market ID */}
                        <div className="pt-3 border-t border-white/[0.04]">
                            <p className="text-[10px] font-mono text-neutral-600 truncate">
                                {pos.marketId}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
