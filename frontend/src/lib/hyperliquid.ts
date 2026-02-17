export interface PredictedFunding {
    symbol: string;
    fundingRate: number; // Decimal (e.g., 0.0001 for 0.01%)
    nextFundingTime: number; // Unix timestamp in ms
}

// Response Types based on User provided structure:
// [ "AVAX", [ ["BinPerp", { fundingRate: "...", nextFundingTime: ... }], ... ] ]
type VenueName = "HlPerp" | "BinPerp" | "BybitPerp" | string;

interface VenueFundingData {
    fundingRate: string; // "0.0000125"
    nextFundingTime: number; // 1733958000000
}

type VenueTuple = [VenueName, VenueFundingData];
type AssetFundingTuple = [string, VenueTuple[]]; // [ "AVAX", [ ... ] ]
type PredictedFundingsResponse = AssetFundingTuple[];

export async function fetchPredictedFundings(symbols: string[] = ['BTC', 'ETH']): Promise<PredictedFunding[]> {
    try {
        const response = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ type: 'predictedFundings' }),
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch predicted fundings: ${response.statusText}`);
        }

        const data: PredictedFundingsResponse = await response.json();
        const results: PredictedFunding[] = [];

        // Normalize requested symbols for case-insensitive comparison
        const requestedSymbols = new Set(symbols.map(s => s.toUpperCase()));

        for (const [assetSymbol, venues] of data) {
            if (requestedSymbols.has(assetSymbol.toUpperCase())) {
                // Find Hyperliquid venue data
                const hlVenue = venues.find(([venueName]) => venueName === 'HlPerp');

                if (hlVenue) {
                    const [, fundingData] = hlVenue;
                    results.push({
                        symbol: assetSymbol,
                        fundingRate: parseFloat(fundingData.fundingRate),
                        nextFundingTime: fundingData.nextFundingTime
                    });
                }
            }
        }

        return results;

    } catch (e) {
        console.error("Error fetching predicted fundings:", e);
        return [];
    }
}
