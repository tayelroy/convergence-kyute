
"use client";

import React, { useEffect, useRef, useState } from "react";
// Since klinecharts/pro might need window/document, we handle it carefully or rely on 'use client' + dynamic import if needed.
// For now, we'll import directly as it's a client component.
import { KLineChartPro, DefaultDatafeed } from '@klinecharts/pro';
import '@klinecharts/pro/dist/klinecharts-pro.css';

import { FundingRateDatafeed } from "@/lib/klineDatafeed";

interface KlineChartProProps {
    symbol?: string; // Default 'BTC'
}

export function KlineChartProWrapper({ symbol = 'BTC' }: KlineChartProProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartInstanceRef = useRef<KLineChartPro | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // Prevent double init
        if (chartInstanceRef.current) {
            return;
        }

        const datafeed = new FundingRateDatafeed();

        // Initialize Chart
        try {
            const chart = new KLineChartPro({
                container: containerRef.current,
                symbol: {
                    ticker: symbol,
                    name: symbol === 'BTC' ? 'Bitcoin' : 'Ethereum',
                    shortName: symbol,
                    exchange: 'CONSENSUS',
                    market: 'crypto',
                    priceCurrency: 'apr',
                    type: 'index',
                },
                period: { multiplier: 1, timespan: 'minute', text: '1m' },
                datafeed: datafeed,
                theme: 'dark', // or 'light'
                locale: 'en-US',
            });

            chartInstanceRef.current = chart;

        } catch (e) {
            console.error("Failed to init KlineChartPro", e);
        }

        return () => {
            // chartInstanceRef.current?.destroy(); 
            // Check if destroy method exists or how to dispose
            // The doc doesn't explicitly mention destroy on Pro instance in the snippet, 
            // but usually it cleans up. For now we leave it or check if we need to manually clear.
            if (containerRef.current) {
                containerRef.current.innerHTML = '';
            }
            chartInstanceRef.current = null;
        };
    }, []);

    // Handle Symbol Change prop updates if needed
    useEffect(() => {
        if (chartInstanceRef.current && symbol) {
            chartInstanceRef.current.setSymbol({
                ticker: symbol,
                name: symbol === 'BTC' ? 'Bitcoin' : 'Ethereum',
                shortName: symbol,
                exchange: 'CONSENSUS',
                market: 'crypto',
                priceCurrency: 'apr',
                type: 'index',
            });
        }
    }, [symbol]);

    return (
        <div className="w-full h-full border border-[#1a1a1a] bg-[#050505] overflow-hidden relative">
            <div ref={containerRef} className="w-full h-full" />
        </div>
    );
}
