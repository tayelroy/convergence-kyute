import { z } from "zod";

// ──────────────────────────────────────────────
// Config Schema — validated at startup via Zod
// ──────────────────────────────────────────────

const ConfigSchema = z.object({
    /** Binance Futures funding rate API endpoint */
    binanceApiUrl: z
        .string()
        .url()
        .default("https://fapi.binance.com/fapi/v1/fundingRate"),

    /** Hyperliquid L1 funding rate API endpoint */
    hyperliquidApiUrl: z
        .string()
        .url()
        .default("https://api.hyperliquid.xyz/info"),

    /** Pendle Boros market contract address on Arbitrum */
    borosMarketAddress: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid EVM address")
        .default("0x0000000000000000000000000000000000000000"),

    /** Minimum net spread (in basis points) required to trigger execution */
    minSpreadThresholdBps: z.number().int().min(1).default(20),
});

type Config = z.infer<typeof ConfigSchema>;
const config: Config = ConfigSchema.parse({});

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

/** Standardized funding rate for a single asset from a single venue */
interface VenueFundingRate {
    venue: "binance" | "hyperliquid";
    symbol: string;
    fundingRate: number;   // annualized APR (%)
    fundingTime: number;   // unix ms
}

/** Consensus-verified floating rates across venues */
interface ConsensusRates {
    btc: { medianRate: number; sources: VenueFundingRate[] };
    eth: { medianRate: number; sources: VenueFundingRate[] };
    timestamp: number;
}

// ──────────────────────────────────────────────
// Binance data fetching
// ──────────────────────────────────────────────

/** Raw Binance /fapi/v1/fundingRate response item */
interface BinanceFundingRateItem {
    symbol: string;
    fundingRate: string;
    fundingTime: number;
    markPrice: string;
}

/**
 * Fetch latest funding rates from Binance for given symbols.
 * Each DON node calls this independently inside runInNodeMode.
 */
async function fetchBinanceRates(
    httpClient: { fetch: typeof fetch },
    symbols: string[]
): Promise<VenueFundingRate[]> {
    const results: VenueFundingRate[] = [];

    for (const symbol of symbols) {
        const url = `${config.binanceApiUrl}?symbol=${symbol}&limit=1`;
        const response = await httpClient.fetch(url);
        const data = (await response.json()) as BinanceFundingRateItem[];

        if (data.length > 0) {
            const item = data[0];
            // Binance returns 8h rate as decimal — annualize: rate * 3 * 365 * 100
            const annualizedRate = parseFloat(item.fundingRate) * 3 * 365 * 100;
            results.push({
                venue: "binance",
                symbol: item.symbol,
                fundingRate: annualizedRate,
                fundingTime: item.fundingTime,
            });
        }
    }

    return results;
}

// ──────────────────────────────────────────────
// Hyperliquid data fetching
// ──────────────────────────────────────────────

/** Raw Hyperliquid /info fundingHistory response item */
interface HyperliquidFundingItem {
    coin: string;
    fundingRate: string;
    premium: string;
    time: number;
}

/**
 * Fetch latest funding rates from Hyperliquid for given coins.
 * Uses POST /info with { type: "fundingHistory" }.
 */
async function fetchHyperliquidRates(
    httpClient: { fetch: typeof fetch },
    coins: string[]
): Promise<VenueFundingRate[]> {
    const results: VenueFundingRate[] = [];
    const now = Date.now();

    for (const coin of coins) {
        const response = await httpClient.fetch(config.hyperliquidApiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "fundingHistory",
                coin,
                startTime: now - 3600_000, // last hour
                endTime: now,
            }),
        });

        const data = (await response.json()) as HyperliquidFundingItem[];

        if (data.length > 0) {
            // Take the most recent entry
            const latest = data[data.length - 1];
            // Hyperliquid returns 8h rate as decimal — annualize same as Binance
            const annualizedRate = parseFloat(latest.fundingRate) * 3 * 365 * 100;
            results.push({
                venue: "hyperliquid",
                symbol: `${latest.coin}USDT`,
                fundingRate: annualizedRate,
                fundingTime: latest.time,
            });
        }
    }

    return results;
}

// ──────────────────────────────────────────────
// Consensus Aggregation
// ──────────────────────────────────────────────

/**
 * Compute the median of an array of numbers.
 * Used as the consensus aggregation function across DON nodes.
 */
function medianOf(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Filter outliers: discard any rate that deviates > 5% from the median.
 * Prevents oracle manipulation per the Kyute risk model.
 * Only applies when 3+ sources exist — with fewer, all data is trusted.
 */
function filterOutliers(rates: number[], tolerancePct = 5): number[] {
    if (rates.length < 3) return rates; // Need 3+ sources for meaningful outlier detection
    const median = medianOf(rates);
    if (median === 0) return rates;
    return rates.filter(
        (r) => Math.abs((r - median) / median) * 100 <= tolerancePct
    );
}

// ──────────────────────────────────────────────
// fetchGlobalRates — the main data layer
// ──────────────────────────────────────────────

/**
 * Fetch funding rates from Binance and Hyperliquid in parallel,
 * then apply consensus median aggregation with outlier filtering.
 *
 * In a live CRE deployment, this runs inside `runtime.runInNodeMode`
 * so each DON node fetches independently, then results are aggregated
 * via `consensusMedianAggregation`.
 *
 * @param httpClient — injected HTTP client (CRE HTTPCapability or native fetch)
 * @returns ConsensusRates — verified floating rates (R_cex)
 */
async function fetchGlobalRates(
    httpClient: { fetch: typeof fetch } = { fetch: globalThis.fetch }
): Promise<ConsensusRates> {
    // ── 1. Parallel fetch from both venues ──
    const [binanceRates, hyperliquidRates] = await Promise.all([
        fetchBinanceRates(httpClient, ["BTCUSDT", "ETHUSDT"]),
        fetchHyperliquidRates(httpClient, ["BTC", "ETH"]),
    ]);

    const allRates = [...binanceRates, ...hyperliquidRates];

    // ── 2. Group by asset ──
    const btcRates = allRates.filter((r) => r.symbol.startsWith("BTC"));
    const ethRates = allRates.filter((r) => r.symbol.startsWith("ETH"));

    // ── 3. Apply outlier filtering + median consensus ──
    const btcValues = filterOutliers(btcRates.map((r) => r.fundingRate));
    const ethValues = filterOutliers(ethRates.map((r) => r.fundingRate));

    return {
        btc: { medianRate: medianOf(btcValues), sources: btcRates },
        eth: { medianRate: medianOf(ethValues), sources: ethRates },
        timestamp: Date.now(),
    };
}

// ──────────────────────────────────────────────
// CRE Workflow Handler
// ──────────────────────────────────────────────
//
// In production, replace the simulation block below with:
//
//   import cre, { consensusMedianAggregation } from "@chainlink/cre-sdk";
//
//   cre.handler(
//     new cre.CronCapability("*/5 * * * *"),
//     async (runtime) => {
//       const rates = await runtime.runInNodeMode(
//         async (nodeRuntime) => {
//           const http = nodeRuntime.getCapability("http");
//           return fetchGlobalRates(http);
//         },
//         consensusMedianAggregation
//       );
//
//       // ... spread calculation & execution logic ...
//     }
//   );

// ── Local simulation entry point ──
async function main() {
    console.log("━━━ Kyute CRE Workflow ━━━");
    console.log("Config validated:");
    console.log(`  Binance API:       ${config.binanceApiUrl}`);
    console.log(`  Hyperliquid API:   ${config.hyperliquidApiUrl}`);
    console.log(`  Boros Market:      ${config.borosMarketAddress}`);
    console.log(`  Min Spread:        ${config.minSpreadThresholdBps} bps`);
    console.log();
    console.log("Fetching global funding rates...");

    try {
        const rates = await fetchGlobalRates();
        console.log();
        console.log("━━━ Consensus Results (R_cex) ━━━");
        console.log(`  BTC median rate:  ${rates.btc.medianRate.toFixed(4)}% APR`);
        console.log(`    Sources: ${rates.btc.sources.map((s) => `${s.venue}(${s.fundingRate.toFixed(4)}%)`).join(", ")}`);
        console.log(`  ETH median rate:  ${rates.eth.medianRate.toFixed(4)}% APR`);
        console.log(`    Sources: ${rates.eth.sources.map((s) => `${s.venue}(${s.fundingRate.toFixed(4)}%)`).join(", ")}`);
        console.log(`  Timestamp:        ${new Date(rates.timestamp).toISOString()}`);
    } catch (err) {
        console.error("Failed to fetch rates:", err);
    }
}

main();

// ── Exports ──
export { ConfigSchema, config, fetchGlobalRates, fetchBinanceRates, fetchHyperliquidRates, medianOf, filterOutliers };
export type { Config, VenueFundingRate, ConsensusRates };
