import React from "react";
import { ArrowUpRight, ArrowDownRight, Activity } from "lucide-react";

interface TickerItemProps {
    symbol: string;
    price: number; // For funding, this is the Rate
    change: number; // 24h change or spread
    isSpread?: boolean;
}

function TickerItem({ symbol, price, change, isSpread }: TickerItemProps) {
    const isPositive = change >= 0;

    return (
        <div className="flex items-center space-x-3 px-6 border-r border-[#1a1a1a]">
            <span className="font-bold text-[#888]">{symbol}</span>
            <span className={isSpread ? "text-blue-400" : "text-white"}>
                {isSpread ? `${price.toFixed(2)} bps` : `${price.toFixed(4)}%`}
            </span>
            <div className={`flex items-center text-xs ${isPositive ? "text-[#00ff00]" : "text-[#ff0000]"}`}>
                {isPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                <span className="ml-1">{Math.abs(change).toFixed(2)}%</span>
            </div>
        </div>
    );
}

export function TickerTape() {
    return (
        <div className="w-full h-10 bg-[#0a0a0a] border-b border-[#1a1a1a] flex items-center overflow-hidden whitespace-nowrap">
            {/* Mock Data for now - will wire to real props later */}
            <div className="animate-ticker flex">
                <TickerItem symbol="BTC Funding" price={5.47} change={1.2} />
                <TickerItem symbol="ETH Funding" price={0.61} change={-0.4} />
                <TickerItem symbol="BTC Spread" price={45} change={5.0} isSpread />
                <TickerItem symbol="ETH Spread" price={12} change={-2.0} isSpread />
                <div className="flex items-center px-6 text-[#444] text-xs">
                    <Activity size={12} className="mr-2" />
                    MARKET STATUS: ACTIVE
                </div>
                {/* Duplicate for infinite scroll loop if needed */}
                <TickerItem symbol="BTC Funding" price={5.47} change={1.2} />
                <TickerItem symbol="ETH Funding" price={0.61} change={-0.4} />
            </div>
        </div>
    );
}
