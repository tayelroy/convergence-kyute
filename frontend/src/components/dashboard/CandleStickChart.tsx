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

    // State for Asset & Source
    const [asset, setAsset] = useState<string>("BTC");
    const [source, setSource] = useState<"median_apr" | "binance_rate" | "hyperliquid_rate">("median_apr");

    // Initialize Chart
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = init(chartContainerRef.current);
        chartInstanceRef.current = chart;

        // Apply "Hacker / Bloomberg" Theme
        chart?.setStyles({
            grid: {
                horizontal: { color: "#222" },
                vertical: { color: "#222" }
            },
            candle: {
                bar: {
                    upColor: "#00ff00",
                    downColor: "#ff0000",
                    noChangeColor: "#666666"
                },
                priceMark: {
                    last: {
                        upColor: "#00ff00",
                        downColor: "#ff0000",
                        noChangeColor: "#666",
                        line: { style: "dash" }
                    }
                },
                tooltip: {
                    showRule: 'always',
                    labels: ['Time', 'Open', 'Close', 'High', 'Low', 'Vol'],
                    values: (kLineData: any) => {
                        return [
                            { value: new Date(kLineData.timestamp).toLocaleTimeString() },
                            { value: kLineData.open.toFixed(4) + '%', color: '#fff' },
                            { value: kLineData.close.toFixed(4) + '%', color: kLineData.close > kLineData.open ? '#00ff00' : '#ff0000' },
                            { value: kLineData.high.toFixed(4) + '%', color: '#fff' },
                            { value: kLineData.low.toFixed(4) + '%', color: '#fff' },
                            { value: kLineData.volume?.toFixed(0) ?? 'N/A', color: '#666' }
                        ];
                    }
                }
            },
            indicator: {
                bars: [{ style: 'fill', borderStyle: 'solid', borderSize: 1, dashedValue: [2, 2] }],
                lines: [{ style: 'solid', smooth: true, size: 1, dashedValue: [2, 2] }],
                lastValueMark: { show: false },
                tooltip: { showRule: 'always' }
            },
            crosshair: {
                horizontal: {
                    line: { style: 'dash', color: '#444' },
                    text: { display: true, backgroundColor: '#333' }
                },
                vertical: {
                    line: { style: 'dash', color: '#444' },
                    text: { display: true, backgroundColor: '#333' }
                }
            },
            xAxis: { tickText: { color: "#666" } },
            yAxis: { tickText: { color: "#666" } }
        } as any);

        chart?.createIndicator('MA', false, { id: 'candle_pane' });
        chart?.createIndicator('VOL');
        chart?.createIndicator('MACD');

        return () => {
            dispose(chartContainerRef.current!);
        };
    }, []);

    // Fetch Data & Subscribe (Depends on asset/source)
    useEffect(() => {
        const fetchData = async () => {
            const { data: rows, error } = await supabase
                .from('funding_rates')
                .select('*')
                .eq('asset_symbol', asset)
                .order('timestamp', { ascending: true })
                .limit(1000);

            if (error) {
                console.error("Chart Data Error:", error);
                return;
            }

            if (!rows || rows.length === 0) {
                // Mock Data (Raw Percentage ~10%)
                const now = Date.now();
                const mockData: KLineData[] = [];
                let price = 10.0;
                for (let i = 100; i > 0; i--) {
                    const time = now - i * 60 * 1000;
                    const volatility = Math.random() * 0.5;
                    const open = price;
                    const close = price + (Math.random() - 0.5) * volatility;
                    const high = Math.max(open, close) + Math.random() * 0.1;
                    const low = Math.min(open, close) - Math.random() * 0.1;
                    const volume = Math.floor(Math.random() * 1000) + 500;
                    mockData.push({ timestamp: time, open, high, low, close, volume });
                    price = close;
                }
                (chartInstanceRef.current as any)?.applyNewData(mockData);
                return;
            }

            const candles: KLineData[] = [];
            let currentCandle: KLineData | null = null;
            let currentMinute = 0;

            rows.forEach((row: any) => {
                const time = new Date(row.timestamp).getTime();
                const minute = Math.floor(time / 60000) * 60000;

                // Get Raw Rate based on Source (Default 0 if null)
                const rawVal = row[source] ?? row.median_apr ?? 0;
                // Value is already Annualized % in DB

                const vol = Math.floor(Math.random() * 100) + 10;

                if (minute !== currentMinute) {
                    if (currentCandle) candles.push(currentCandle);
                    currentMinute = minute;
                    currentCandle = {
                        timestamp: minute,
                        open: rawVal,
                        high: rawVal,
                        low: rawVal,
                        close: rawVal,
                        volume: vol
                    };
                } else {
                    if (currentCandle) {
                        currentCandle.high = Math.max(currentCandle.high, rawVal);
                        currentCandle.low = Math.min(currentCandle.low, rawVal);
                        currentCandle.close = rawVal;
                        currentCandle.volume = (currentCandle.volume || 0) + vol;
                    }
                }
            });
            if (currentCandle) candles.push(currentCandle);

            (chartInstanceRef.current as any)?.applyNewData(candles);
        };

        fetchData();

        const channel = supabase
            .channel('chart_updates')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'funding_rates', filter: `asset_symbol=eq.${asset}` },
                (payload) => {
                    const newRow = payload.new as any;
                    const time = new Date(newRow.timestamp).getTime();

                    const rawVal = newRow[source] ?? newRow.median_apr ?? 0;
                    const vol = Math.floor(Math.random() * 50) + 10;

                    (chartInstanceRef.current as any)?.updateData({
                        timestamp: time,
                        open: rawVal,
                        high: rawVal,
                        low: rawVal,
                        close: rawVal,
                        volume: vol
                    });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [asset, source]); // Re-run when selection changes

    return (
        <div className="w-full h-full flex flex-col border border-[#1a1a1a] bg-[#050505] overflow-hidden">
            {/* Header */}
            <div className="p-2 border-b border-[#1a1a1a] flex justify-between items-center bg-[#0a0a0a]">
                <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                        {/* Asset Selector */}
                        <select
                            value={asset}
                            onChange={(e) => setAsset(e.target.value)}
                            className="bg-[#111] text-[#fff] text-xs font-mono border border-[#333] px-2 py-1 rounded focus:outline-none focus:border-[#00ff00]"
                        >
                            <option value="BTC">BTC</option>
                            <option value="ETH">ETH</option>
                        </select>
                        <span className="text-[#444] text-xs">/</span>
                        {/* Source Selector */}
                        <select
                            value={source}
                            onChange={(e) => setSource(e.target.value as any)}
                            className="bg-[#111] text-[#fff] text-xs font-mono border border-[#333] px-2 py-1 rounded focus:outline-none focus:border-[#00ff00]"
                        >
                            <option value="median_apr">MEDIAN (CEX)</option>
                            <option value="binance_rate">BINANCE</option>
                            <option value="hyperliquid_rate">HYPERLIQUID</option>
                        </select>
                    </div>

                    <div className="flex space-x-2 text-[10px] text-[#444] font-mono hidden sm:flex">
                        <span className="text-[#00ff00]">MA(5,10,20)</span>
                        <span className="text-blue-400">VOL</span>
                        <span className="text-yellow-400">MACD</span>
                    </div>
                </div>
                <div className="flex items-center space-x-4">
                    <span className="text-xs font-bold text-[#888] font-mono">
                        {asset} FUNDING RATE ({source === 'median_apr' ? 'CONSENSUS' : source.replace('_rate', '').toUpperCase()})
                    </span>
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                    <span className="text-[10px] text-[#00ff00] font-mono">LIVE</span>
                </div>
            </div>

            <div ref={chartContainerRef} className="flex-1 w-full" />
        </div>
    );
}
