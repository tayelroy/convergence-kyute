import React from "react";
import { ArrowUpRight, ArrowDownRight, Activity } from "lucide-react";

interface TickerTapeProps {
    assetSymbol?: string;
    borosRate?: number | null;
    hyperliquidRate?: number | null;
    spreadBps?: number | null;
}

interface TickerItemProps {
    symbol: string;
    price: number | null | undefined;
    change: number;
    isSpread?: boolean;
}

function TickerItem({ symbol, price, change, isSpread }: TickerItemProps) {
    const isPositive = change >= 0;
    const displayPrice =
        price == null
            ? "—"
            : isSpread
            ? `${price.toFixed(2)} bps`
            : `${price.toFixed(4)}%`;

    return (
        <div className="flex items-center space-x-3 px-6 border-r border-[#1a1a1a]">
            <span className="font-bold text-[#888]">{symbol}</span>
            <span className={isSpread ? "text-blue-400" : "text-white"}>
                {displayPrice}
            </span>
            <div className={`flex items-center text-xs ${isPositive ? "text-[#00ff00]" : "text-[#ff0000]"}`}>
                {isPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                <span className="ml-1">{Math.abs(change).toFixed(2)}%</span>
            </div>
        </div>
    );
}

export function TickerTape({
    assetSymbol = "ETH",
    borosRate = null,
    hyperliquidRate = null,
    spreadBps = null,
}: TickerTapeProps) {
    const items = (
        <>
            <TickerItem symbol={`${assetSymbol} Boros`} price={borosRate} change={0} />
            <TickerItem symbol={`${assetSymbol} HL`} price={hyperliquidRate} change={0} />
            <TickerItem symbol={`${assetSymbol} Spread`} price={spreadBps} change={0} isSpread />
            <div className="flex items-center px-6 text-[#444] text-xs border-r border-[#1a1a1a]">
                <Activity size={12} className="mr-2" />
                {borosRate == null ? "LOADING..." : "MARKET STATUS: ACTIVE"}
            </div>
        </>
    );

    return (
        <div className="w-full h-10 bg-[#0a0a0a] border-b border-[#1a1a1a] flex items-center overflow-hidden whitespace-nowrap">
            <div className="animate-ticker flex">
                {/* 1st set — seamless loop */}
                <div className="flex shrink-0">{items}</div>
                {/* 2nd set — duplicate for seamless loop */}
                <div className="flex shrink-0">{items}</div>
            </div>
        </div>
    );
}