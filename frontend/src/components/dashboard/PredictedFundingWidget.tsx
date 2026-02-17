"use client";

import { useEffect, useState } from "react";
import { fetchPredictedFundings, PredictedFunding } from "@/lib/hyperliquid";
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon, ClockIcon } from "@heroicons/react/24/outline";

export function PredictedFundingWidget() {
    const [fundingData, setFundingData] = useState<PredictedFunding[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedSymbol, setSelectedSymbol] = useState<'BTC' | 'ETH'>('BTC');

    // Configurable thresholds for warnings (e.g. 0.02% per 8h/interval)
    const HIGH_POSITIVE_THRESHOLD = 0.0002; // 0.02%
    const HIGH_NEGATIVE_THRESHOLD = -0.0002; // -0.02%

    const fetchData = async () => {
        try {
            setLoading(true);
            const data = await fetchPredictedFundings(['BTC', 'ETH']);
            setFundingData(data);
            setError(null);
        } catch (err) {
            setError("Failed to fetch funding data");
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60000); // Refresh every minute
        return () => clearInterval(interval);
    }, []);

    const currentData = fundingData.find(d => d.symbol === selectedSymbol);

    if (loading && fundingData.length === 0) {
        return <div className="p-4 bg-[#0A0A0A] border border-[#1a1a1a] rounded-lg animate-pulse h-[140px]"></div>;
    }

    if (error) {
        return (
            <div className="p-4 bg-[#0A0A0A] border border-red-900/30 rounded-lg text-red-500 text-sm">
                Error: {error}
                <button onClick={fetchData} className="ml-2 underline text-red-400">Retry</button>
            </div>
        );
    }

    if (!currentData) {
        return <div className="p-4 bg-[#0A0A0A] border border-[#1a1a1a] rounded-lg text-gray-500">No data for {selectedSymbol}</div>;
    }

    // Calculations
    const ratePercentage = (currentData.fundingRate * 100).toFixed(4);
    const isPositive = currentData.fundingRate > 0;
    const isHighPositive = currentData.fundingRate > HIGH_POSITIVE_THRESHOLD;
    const isHighNegative = currentData.fundingRate < HIGH_NEGATIVE_THRESHOLD;

    const nextFundingDate = new Date(currentData.nextFundingTime);
    const timeUntilFunding = Math.max(0, currentData.nextFundingTime - Date.now());
    const hoursUntil = Math.floor(timeUntilFunding / (1000 * 60 * 60));
    const minutesUntil = Math.floor((timeUntilFunding % (1000 * 60 * 60)) / (1000 * 60));

    return (
        <div className="p-5 bg-gradient-to-br from-[#0A0A0A] to-[#111] border border-[#1a1a1a] rounded-xl shadow-lg relative overflow-hidden group">
            {/* Background Glow */}
            <div className={`absolute top-0 right-0 w-32 h-32 bg-${isPositive ? 'green' : 'red'}-500/5 blur-[80px] rounded-full pointer-events-none transition-colors duration-500`} />

            <div className="flex justify-between items-center mb-4 relative z-10">
                <h3 className="text-sm font-medium text-gray-400 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                    Predicted Funding (8h)
                </h3>
                <div className="flex bg-[#1a1a1a] rounded-lg p-0.5">
                    {(['BTC', 'ETH'] as const).map((sym) => (
                        <button
                            key={sym}
                            onClick={() => setSelectedSymbol(sym)}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all duration-200 ${selectedSymbol === sym
                                    ? 'bg-[#2a2a2a] text-white shadow-sm'
                                    : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            {sym}
                        </button>
                    ))}
                </div>
            </div>

            <div className="relative z-10">
                <div className="flex items-baseline gap-2 mb-1">
                    <span className={`text-3xl font-bold tracking-tight ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                        {isPositive ? '+' : ''}{ratePercentage}%
                    </span>
                    <span className="text-xs text-gray-500 font-mono">
                        {isPositive ? 'Longs pay Shorts' : 'Shorts pay Longs'}
                    </span>
                </div>

                <div className="flex items-center gap-4 mt-3 text-xs text-gray-400 border-t border-[#1a1a1a] pt-3">
                    <div className="flex items-center gap-1.5" title={nextFundingDate.toLocaleString()}>
                        <ClockIcon className="w-3.5 h-3.5" />
                        <span>
                            {hoursUntil}h {minutesUntil}m until funding
                        </span>
                    </div>

                </div>

                {/* Strategy Hooks / Warnings */}
                {(isHighPositive || isHighNegative) && (
                    <div className={`mt-3 p-2 rounded border ${isHighPositive
                            ? 'bg-orange-500/10 border-orange-500/20 text-orange-400'
                            : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                        } text-xs leading-relaxed animate-in fade-in slide-in-from-bottom-2`}>
                        {isHighPositive && "Funding is highly positive. Consider reducing long exposure."}
                        {isHighNegative && "Funding is highly negative. Consider reducing short exposure."}
                    </div>
                )}
            </div>
        </div>
    );
}
