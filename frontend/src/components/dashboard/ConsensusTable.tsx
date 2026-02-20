"use client";

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";

interface RateRow {
    asset: string;
    cexMedian: number;
    fixedRate: number;
    spreadBps: number;
    timestamp?: string;
}

export function ConsensusTable() {
    const [data, setData] = useState<RateRow[]>([]);

    useEffect(() => {
        // 1. Initial Fetch
        const fetchData = async () => {
            const { data: rows, error } = await supabase
                .from('funding_rates')
                .select('*')
                .order('timestamp', { ascending: false })
                .limit(10); // Get latest few rows to find latest for each asset

            if (error) {
                console.error("Supabase fetch error:", error);
                console.error("Error details:", JSON.stringify(error, null, 2));
                return;
            }

            if (rows) {
                // Group by asset to get latest
                const latestStats: Record<string, RateRow> = {};

                // Reverse to process oldest first, so newest overwrites
                [...rows].reverse().forEach((row: any) => {
                    const asset = row.asset_symbol;
                    const fixed = Number(row.boros_rate ?? 0);
                    const medianApr = Number(row.median_apr ?? 0);
                    const spread = Number(row.spread_bps ?? 0);

                    latestStats[asset] = {
                        asset,

                        cexMedian: medianApr,
                        fixedRate: fixed,
                        spreadBps: spread,
                        timestamp: row.timestamp
                    };
                });

                // Convert to array and sort (BTC first)
                const newRows = Object.values(latestStats).sort((a, b) => {
                    if (a.asset === "BTC") return -1;
                    if (b.asset === "BTC") return 1;
                    return a.asset.localeCompare(b.asset);
                });

                if (newRows.length > 0) {
                    setData(newRows);
                }
            }
        };

        fetchData();

        // 2. Real-time Subscription
        const channel = supabase
            .channel('funding_rates_changes')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'funding_rates' },
                (payload) => {
                    console.log('Real-time update:', payload);
                    const newRow = payload.new as any;
                    const asset = newRow.asset_symbol;
                    const fixed = Number(newRow.boros_rate ?? 0);
                    const medianApr = Number(newRow.median_apr ?? 0);
                    const spread = Number(newRow.spread_bps ?? 0);

                    // Update state with new row
                    setData(prev => {
                        const next = [...prev];
                        const idx = next.findIndex(r => r.asset === asset);
                        const newItem: RateRow = {
                            asset,

                            cexMedian: medianApr,
                            fixedRate: fixed,
                            spreadBps: spread,
                            timestamp: newRow.timestamp
                        };

                        if (idx >= 0) {
                            next[idx] = newItem;
                        } else {
                            next.push(newItem);
                        }
                        return next;
                    });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    return (
        <div className="w-full border border-[#1a1a1a] bg-[#080808] flex flex-col h-full">
            <div className="grid grid-cols-4 px-4 py-2 border-b border-[#1a1a1a] text-xs text-[#666] uppercase tracking-wider">
                <div>Asset</div>
                <div className="text-right">CEX Median (APR)</div>
                <div className="text-right">Boros Fixed (APR)</div>
                <div className="text-right">Net Spread</div>
            </div>

            <div className="divide-y divide-[#111] overflow-y-auto">
                {data.length === 0 && (
                    <div className="px-4 py-6 text-xs text-[#666] font-mono">Waiting for live funding rate rows...</div>
                )}
                {data.map((row) => {
                    const isProfitable = row.spreadBps > 0;
                    return (
                        <div
                            key={row.asset}
                            className="grid grid-cols-4 px-4 py-5 hover:bg-[#0c0c0c] transition-colors items-center group"
                        >
                            <div className="flex flex-col">
                                <span className="font-bold text-lg text-white group-hover:text-blue-400 transition-colors">
                                    {row.asset}
                                </span>
                                <span className="text-[10px] text-[#444] font-mono">
                                    {row.timestamp ? new Date(row.timestamp).toLocaleTimeString() : "WAITING..."}
                                </span>
                            </div>

                            <div className="text-right font-mono text-[#aaa] text-sm">
                                {row.cexMedian.toFixed(4)}%
                            </div>

                            <div className="text-right font-mono text-[#aaa] text-sm">
                                {row.fixedRate.toFixed(4)}%
                            </div>

                            <div className={cn(
                                "text-right font-mono font-bold text-sm",
                                isProfitable ? "text-[#00ff00]" : "text-[#ff0000]"
                            )}>
                                {row.spreadBps > 0 ? "+" : ""}
                                {row.spreadBps.toFixed(2)} bps
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
