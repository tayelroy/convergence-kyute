"use client";

import { Zap } from "lucide-react";
import type { SpreadData } from "@/types/boros";

interface LiveSpreadsTableProps {
    data: SpreadData[];
    onExecute?: (asset: string) => void;
}

export function LiveSpreadsTable({ data, onExecute }: LiveSpreadsTableProps) {
    return (
        <div className="rounded-xl border border-white/[0.06] bg-[#0c0c14] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-emerald-400" />
                    <h2 className="text-sm font-semibold text-white">Live Spreads</h2>
                </div>
                <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[11px] font-mono text-neutral-500">
                        REAL-TIME
                    </span>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-white/[0.04]">
                            <th className="px-5 py-3 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-neutral-500">
                                Asset
                            </th>
                            <th className="px-5 py-3 text-right text-[11px] font-mono font-medium uppercase tracking-wider text-neutral-500">
                                Long Venue (APR)
                            </th>
                            <th className="px-5 py-3 text-right text-[11px] font-mono font-medium uppercase tracking-wider text-neutral-500">
                                Short Venue (APR)
                            </th>
                            <th className="px-5 py-3 text-right text-[11px] font-mono font-medium uppercase tracking-wider text-neutral-500">
                                Net Spread (bps)
                            </th>
                            <th className="px-5 py-3 text-right text-[11px] font-mono font-medium uppercase tracking-wider text-neutral-500">
                                Action
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((row) => {
                            const isExecutable = row.netSpreadBps >= 20;
                            return (
                                <tr
                                    key={row.asset}
                                    className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.02]"
                                >
                                    <td className="px-5 py-3.5">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-semibold text-white">
                                                {row.asset}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3.5 text-right">
                                        <div className="flex flex-col items-end">
                                            <span className="text-sm font-mono text-emerald-400">
                                                {row.longApr.toFixed(1)}%
                                            </span>
                                            <span className="text-[10px] font-mono text-neutral-600">
                                                {row.longVenue}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3.5 text-right">
                                        <div className="flex flex-col items-end">
                                            <span className="text-sm font-mono text-neutral-300">
                                                {row.shortApr.toFixed(1)}%
                                            </span>
                                            <span className="text-[10px] font-mono text-neutral-600">
                                                {row.shortVenue}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3.5 text-right">
                                        <span
                                            className={`text-sm font-mono font-semibold ${row.netSpreadBps >= 200
                                                    ? "text-emerald-400"
                                                    : row.netSpreadBps >= 20
                                                        ? "text-yellow-400"
                                                        : "text-neutral-500"
                                                }`}
                                        >
                                            {row.netSpreadBps}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3.5 text-right">
                                        <button
                                            onClick={() => onExecute?.(row.asset)}
                                            disabled={!isExecutable}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono transition-all duration-200 ${isExecutable
                                                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 hover:border-emerald-500/40 cursor-pointer"
                                                    : "bg-white/[0.03] text-neutral-600 border border-white/[0.04] cursor-not-allowed"
                                                }`}
                                        >
                                            {isExecutable ? "EXECUTE" : "SKIP"}
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
