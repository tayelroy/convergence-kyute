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

// Fixed rates for demo purposes (Boros APY usually stable)
const FIXED_RATES: Record<string, number> = {
    BTC: 4.5,
    ETH: 3.8,
    SOL: 10.0
};

// Mock Data as initial state / fallback
const INITIAL_DATA: RateRow[] = [
    { asset: "BTC", cexMedian: 0.00, fixedRate: 4.5, spreadBps: 0.00 },
    { asset: "ETH", cexMedian: 0.00, fixedRate: 3.8, spreadBps: 0.00 },
];

export function ConsensusTable() {
    const [data, setData] = useState<RateRow[]>(INITIAL_DATA);

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
                // If the table doesn't exist, we might get a 404-like error wrapped in an object
                if (error.code === '42P01') { // undefined_table
                    console.warn("Table 'funding_rates' does not exist. Using mock data.");
                }
                return;
            }

            if (rows) {
                // Group by asset to get latest
                const latestStats: Record<string, RateRow> = {};

                // Reverse to process oldest first, so newest overwrites
                [...rows].reverse().forEach((row: any) => {
                    const asset = row.asset_symbol;
                    const fixed = FIXED_RATES[asset] || 0;
                    const medianRaw = row.median_apr || 0;
                    // Annualize: raw * 3 * 365 * 100
                    const medianAnnual = medianRaw * 3 * 365 * 100;
                    const spread = (medianAnnual - fixed) * 100; // % to bps

                    latestStats[asset] = {
                        asset,

                        cexMedian: medianAnnual,
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
                    const fixed = FIXED_RATES[asset] || 0;
                    const medianRaw = newRow.median_apr || 0;
                    const medianAnnual = medianRaw * 3 * 365 * 100;
                    const spread = (medianAnnual - fixed) * 100;

                    // Update state with new row
                    setData(prev => {
                        const next = [...prev];
                        const idx = next.findIndex(r => r.asset === asset);
                        const newItem: RateRow = {
                            asset,

                            cexMedian: medianAnnual,
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
