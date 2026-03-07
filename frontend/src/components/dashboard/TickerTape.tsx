import React from "react";
import { Activity } from "lucide-react";

interface TickerTapeProps {
    borosRate?: number | null;
    hyperliquidRate?: number | null;
    spreadBps?: number | null;
    markets?: Array<{
        label: string;
        borosRate?: number | null;
        hyperliquidRate?: number | null;
        spreadBps?: number | null;
    }>;
    lastSyncLabel?: string | null;
    degraded?: boolean;
}

export function TickerTape({
    borosRate = null,
    hyperliquidRate = null,
    spreadBps = null,
    markets = [],
    lastSyncLabel = null,
    degraded = false,
}: TickerTapeProps) {
    const statusLabel = degraded ? "DEGRADED" : "ACTIVE";
    const effectiveMarkets = markets.length > 0
        ? markets
        : [{ label: "MARKET", borosRate, hyperliquidRate, spreadBps }];

    return (
        <div className="w-full h-10 px-4 border-b border-[#1a1a1a] bg-[#060909] flex items-center justify-between overflow-hidden">
            <div className="flex items-center gap-6 min-w-0 text-xs font-mono uppercase tracking-wide whitespace-nowrap overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-2 text-emerald-400">
                    <Activity size={10} />
                    <span>{statusLabel}</span>
                </div>
                {effectiveMarkets.map((market) => {
                    const borosLabel = market.borosRate == null ? "—" : `${market.borosRate.toFixed(4)}%`;
                    const hlLabel = market.hyperliquidRate == null ? "—" : `${market.hyperliquidRate.toFixed(4)}%`;
                    const spreadLabel = market.spreadBps == null ? "—" : `${market.spreadBps.toFixed(2)} bps`;
                    return (
                        <div key={market.label} className="flex items-center gap-4">
                            <span className="text-[#8b92a5]">{market.label}</span>
                            <span className="hidden sm:inline text-[#8b92a5]">
                                BOROS <span className="text-emerald-400">{borosLabel}</span>
                            </span>
                            <span className="hidden md:inline text-[#8b92a5]">
                                HYPERLIQUID <span className="text-white">{hlLabel}</span>
                            </span>
                            <span className="hidden lg:inline text-[#8b92a5]">
                                SPREAD <span className="text-[#53a2ff]">{spreadLabel}</span>
                            </span>
                        </div>
                    );
                })}
            </div>
            <div className="text-xs font-mono uppercase tracking-wide text-[#6a7283] whitespace-nowrap">
                SYS_TIME: {lastSyncLabel ?? "--"}
            </div>
        </div>
    );
}
