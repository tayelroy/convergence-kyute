import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Exchange } from "@pendle/sdk-boros";

// Interfaces based on SDK analysis
interface MarketResponse {
    marketId: number;
    address: string;
    symbol?: string;
    data?: {
        midApr: number;
        fixedApr: number;
        bestBid?: number;
        bestAsk?: number;
    };
}

interface MarketsResponse {
    results: MarketResponse[];
    total: number;
}

interface SideTickResponse {
    ia: number[]; // Implied APRs
    sz: string[]; // Sizes
}

interface OrderBooksResponse {
    long: SideTickResponse;
    short: SideTickResponse;
}

/**
 * Helper to fetch the current Implied APR for a specific Boros market.
 * 
 * Uses the Boros SDK to query optimal pricing from the Central Limit Order Book (CLOB).
 * 
 * @param marketAddress - The contract address of the Boros market.
 *    - BTCUSDT: 0xcaf0d78c581ee8a03b9dd974f2ebfb3026961969
 *    - ETHUSDT: 0x8db1397beb16a368711743bc42b69904e4e82122
 * @returns The implied APR as a decimal (e.g., 0.085 for 8.5%). Returns 0 if no data found.
 */
export async function fetchBorosImpliedApr(marketAddress: string): Promise<number> {
    if (!process.env.PRIVATE_KEY) {
        throw new Error("PRIVATE_KEY env var is missing");
    }

    const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
    // Boros is on Arbitrum One
    const rpcUrl = process.env.RPC_URL || "https://arb1.arbitrum.io/rpc";

    const walletClient = createWalletClient({
        account,
        transport: http(rpcUrl),
    });

    // Exchange requires: walletClient, rootAddress, accountId, rpcUrls[], agent?
    const exchange = new Exchange(
        walletClient,
        account.address,
        0, // accountId
        [rpcUrl] // rpcUrls
    );

    try {
        // 1. Get Market Info first (needed for marketId)
        // We fetch a list and find our market. 
        // Note: In production, you might cache this mapping.
        const marketsResp = await exchange.getMarkets({
            skip: 0,
            limit: 100, // Fetch first 100, hopefully enough. If not, pagination needed.
            isWhitelisted: true,
        }) as unknown as MarketsResponse;

        // Find matches by address (case-insensitive)
        const targetMarket = marketsResp.results.find(
            (m) => m.address.toLowerCase() === marketAddress.toLowerCase()
        );

        if (!targetMarket) {
            console.warn(`Market ${marketAddress} not found in Boros listing (checked first 100).`);
            return 0;
        }

        // 2. Strategy A: Get Order Book (Most Accurate)
        const tickSize = 0.001;

        try {
            const orderBook = (await exchange.getOrderBook({
                marketId: targetMarket.marketId,
                tickSize,
            })) as unknown as OrderBooksResponse;

            // Extract best rates from Long and Short sides
            // Assuming 'ia' array is sorted best-to-worst
            const bestLong = orderBook.long.ia.length > 0 ? orderBook.long.ia[0] : null;
            const bestShort = orderBook.short.ia.length > 0 ? orderBook.short.ia[0] : null;

            if (bestLong !== null && bestShort !== null) {
                // Mid-price (ticks)
                const midRate = (bestLong + bestShort) / 2;
                // Boros rates are in ticks. Multiply by tickSize to get decimal APR.
                // e.g. 57.5 ticks * 0.001 = 0.0575 (5.75%)
                return midRate * tickSize;
            } else if (bestLong !== null) {
                return bestLong * tickSize;
            } else if (bestShort !== null) {
                return bestShort * tickSize;
            }
        } catch (obError) {
            console.warn(`Failed to fetch orderbook for ${marketAddress}, falling back to market data.`, obError);
        }

        // 3. Strategy B: Fallback to Market Data (midApr)
        if (targetMarket.data && targetMarket.data.midApr) {
            // Normalized check: if midApr is e.g. 5.5, return 0.055
            return targetMarket.data.midApr / 100;
        }

        return 0;

    } catch (err) {
        console.error("Error fetching Boros Implied APR:", err);
        return 0;
    }
}
