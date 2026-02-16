"use client";

import React, { useEffect, useRef, useState } from "react";
import { init, dispose, Chart } from "klinecharts";
import { supabase } from "@/lib/supabaseClient";

interface RateRow {
    timestamp: string;
    spread_bps: number;
}

interface KLineData {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

export function CandleStickChart() {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartInstanceRef = useRef<Chart | null>(null);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        // Initialize Chart
        const chart = init(chartContainerRef.current);
        chartInstanceRef.current = chart;

        // Apply "Terminal" Theme
        chart?.setStyles({
            grid: {
                horizontal: { color: "#333" },
                vertical: { color: "#333" }
            },
            candle: {
                bar: {
                    upColor: "#00ff00",
                    downColor: "#ff0000",
                    noChangeColor: "#666666"
                },
                priceMark: {
                    high: { color: "#666" },
                    low: { color: "#666" },
                    last: {
                        upColor: "#00ff00",
                        downColor: "#ff0000",
                        noChangeColor: "#666",
                        // line: { style: "dash" }
                    }
                }
            },
            xAxis: {
                tickText: { color: "#666" }
            },
            yAxis: {
                tickText: { color: "#666" }
            }
        });

        // Cleanup
        return () => {
            dispose(chartContainerRef.current!);
        };
    }, []);

    // Fetch Data & Subscribe
    useEffect(() => {
        const fetchData = async () => {
            // 1. Fetch last 1000 records
            const { data: rows, error } = await supabase
                .from('funding_rates')
                .select('*')
                .eq('asset_symbol', 'BTC') // Focus on BTC for now
                .order('timestamp', { ascending: true })
                .limit(1000);

            if (error) {
                console.error("Chart Data Error:", error);
                return;
            }

            if (!rows || rows.length === 0) {
                // Fallback: Generate Mock History if empty
                const now = Date.now();
                const mockData: KLineData[] = [];
                let price = 20; // base spread
                for (let i = 100; i > 0; i--) {
                    const time = now - i * 60 * 1000;
                    const volatility = Math.random() * 5;
                    const open = price;
                    const close = price + (Math.random() - 0.5) * volatility;
                    const high = Math.max(open, close) + Math.random();
                    const low = Math.min(open, close) - Math.random();
                    mockData.push({ timestamp: time, open, high, low, close });
                    price = close;
                }
                (chartInstanceRef.current as any)?.applyNewData(mockData);
                return;
            }

            // 2. Aggregate into 1-minute candles
            // Assuming rows are sorted by time asc
            // We group by minute
            const candles: KLineData[] = [];
            let currentCandle: KLineData | null = null;
            let currentMinute = 0;

            rows.forEach((row: any) => {
                const time = new Date(row.timestamp).getTime();
                const minute = Math.floor(time / 60000) * 60000;
                const price = (row.median_apr - 4.5) * 100; // Recalculate spread or use row.spread_bps if available

                // Check if row has spread_bps
                const val = row.spread_bps !== undefined ? row.spread_bps : price;

                if (minute !== currentMinute) {
                    if (currentCandle) candles.push(currentCandle);
                    currentMinute = minute;
                    currentCandle = {
                        timestamp: minute,
                        open: val,
                        high: val,
                        low: val,
                        close: val
                    };
                } else {
                    if (currentCandle) {
                        currentCandle.high = Math.max(currentCandle.high, val);
                        currentCandle.low = Math.min(currentCandle.low, val);
                        currentCandle.close = val;
                    }
                }
            });
            if (currentCandle) candles.push(currentCandle);

            (chartInstanceRef.current as any)?.applyNewData(candles);
        };

        fetchData();

        // 3. Subscription
        const channel = supabase
            .channel('chart_updates')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'funding_rates', filter: 'asset_symbol=eq.BTC' },
                (payload) => {
                    const newRow = payload.new as any;
                    const time = new Date(newRow.timestamp).getTime();
                    const val = newRow.spread_bps ?? ((newRow.median_apr - 4.5) * 100);

                    // Update Chart
                    // klinecharts `updateData` appends or updates the last candle
                    (chartInstanceRef.current as any)?.updateData({
                        timestamp: time,
                        open: val,
                        high: val,
                        low: val,
                        close: val
                    });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    return (
        <div className="w-full h-full flex flex-col border border-[#1a1a1a] bg-[#050505]">
            <div className="p-3 border-b border-[#1a1a1a] flex justify-between items-center">
                <span className="text-xs uppercase tracking-wider font-bold text-[#666]">BTC Spread Trend (1m Candles)</span>
                <div className="flex gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                </div>
            </div>
            <div ref={chartContainerRef} className="flex-1 w-full" />
        </div>
    );
}
