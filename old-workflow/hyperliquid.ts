
// Native fetch is available in Node 18+ and Bun
// import { fetch } from "undici"; 

interface HyperliquidResponse {
    funding: string; // "0.000125"
}

/**
 * Fetches the predicted funding rate for a coin on Hyperliquid.
 * 
 * Hyperliquid API: POST https://api.hyperliquid.xyz/info
 * Payload: { "type": "predictedFundings" }
 * 
 * @param coin - The asset symbol (e.g. "ETH", "BTC")
 * @returns The funding rate as a decimal APR (e.g. 0.15 for 15%).
 */
export async function fetchHyperliquidFundingRate(coin: string = "ETH"): Promise<number> {
    try {
        const response = await fetch("https://api.hyperliquid.xyz/info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "predictedFundings" })
        });

        if (!response.ok) {
            throw new Error(`Hyperliquid API Error: ${response.status}`);
        }

        // Response is an array of arrays: [["ETH", [funding, premium, ...]], ...]
        // Or sometimes an object depending on endpoint version.
        // Let's check typical structure for "predictedFundings":
        // It returns an array of objects or tuples.
        // Example: [["BTC", ["0.000012", ...]], ...]

        const data = await response.json() as any[];

        // Find the coin
        const coinData = data.find((item: any) => item[0] === coin);
        // console.log("Hyperliquid Raw Data Sample:", JSON.stringify(coinData));
        if (!coinData) {
            console.warn(`Hyperliquid: Coin ${coin} not found.`);
            return 0;
        }

        // Funding is usually index 0 of the second element array
        // [ "ETH", [ "0.0000125", ... ] ] -> coinData[1] is the array
        const venues = coinData[1] as any[];

        // Ensure we have data
        const hlPerpEntry = venues.find((v: any) => v[0] === "HlPerp");

        if (!hlPerpEntry) {
            console.warn(`Hyperliquid: HlPerp data not found for ${coin}.`);
            return 0;
        }

        const hlPerpFundingRate = Number(hlPerpEntry[1].fundingRate);

        // Annualize: Rate * 24 * 365
        const apr = hlPerpFundingRate * 24 * 365;

        return apr;

    } catch (error) {
        console.warn("Hyperliquid Fetch Failed:", error);
        return 0;
    }
}
