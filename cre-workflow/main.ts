import { z } from "zod";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// ──────────────────────────────────────────────
// Config Schema — validated at startup via Zod
// ──────────────────────────────────────────────

const ConfigSchema = z.object({
    /** Binance Futures funding rate API endpoint */


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

    /** Supabase Project URL */
    supabaseUrl: z.string().url().optional(),

    /** Supabase Anon/Service Key */
    supabaseKey: z.string().optional(),
});

type Config = z.infer<typeof ConfigSchema>;
const config: Config = ConfigSchema.parse({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY,
});

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

/** Standardized funding rate for a single asset from a single venue */
interface VenueFundingRate {
    venue: "hyperliquid";
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
// Hyperliquid data fetching
// ──────────────────────────────────────────────

/** Asset context from Hyperliquid metaAndAssetCtxs response */
interface HyperliquidAssetCtx {
    funding: string;      // current predicted 8h funding rate (decimal)
    openInterest: string;
    prevDayPx: string;
    dayNtlVlm: string;
    premium: string;
    oraclePx: string;
    markPx: string;
    midPx: string;
    impactPxs: string[];
}

/** Meta info for each asset */
interface HyperliquidAssetMeta {
    name: string;
    szDecimals: number;
}

/**
 * Fetch CURRENT predicted funding rates from Hyperliquid.
 * Uses POST /info with { type: "metaAndAssetCtxs" }.
 *
 * Why not fundingHistory?
 *   fundingHistory returns OLD settled rates, not the live predicted
 *   rate shown on the UI. metaAndAssetCtxs gives the real-time rate.
 */
async function fetchHyperliquidRates(
    httpClient: { fetch: typeof fetch },
    coins: string[]
): Promise<VenueFundingRate[]> {
    const response = await httpClient.fetch(config.hyperliquidApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    });

    // Response shape: [{ universe: AssetMeta[] }, AssetCtx[]]
    const [meta, assetCtxs] = (await response.json()) as [
        { universe: HyperliquidAssetMeta[] },
        HyperliquidAssetCtx[]
    ];

    const results: VenueFundingRate[] = [];

    for (const coin of coins) {
        // Find the index of the coin in the universe array
        const idx = meta.universe.findIndex((a) => a.name === coin);
        if (idx === -1) continue;

        const ctx = assetCtxs[idx];
        const rawRate = parseFloat(ctx.funding);

        // Hyperliquid returns per-1h funding rate
        // Annualize: rate × 24 hours/day × 365 days × 100 (to %)
        const annualizedRate = rawRate * 24 * 365 * 100;
        const rate8h = rawRate * 8;

        console.log(`  [DEBUG] Hyperliquid ${coin}: raw=${ctx.funding}, 8hPct=${(rate8h * 100).toFixed(4)}%, annualized=${annualizedRate.toFixed(4)}%`);

        results.push({
            venue: "hyperliquid",
            symbol: `${coin}USDT`,
            fundingRate: annualizedRate,
            fundingTime: Date.now(),
        });

        // Also log to console for visibility
        // console.log(`  [DEBUG] Hyperliquid ${coin}: 8hPct=${(rawRate * 100).toFixed(4)}%`);
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
    const hyperliquidRates = await fetchHyperliquidRates(httpClient, ["BTC", "ETH"]);

    const allRates = [...hyperliquidRates];

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
// Data Persistence (Supabase)
// ──────────────────────────────────────────────

/**
 * Pushes consensus rates to Supabase `funding_rates` table.
 * 
 * Table Schema expected:
 * - timestamp: timestamptz
 * - asset_symbol: text (BTC, ETH)
 * - median_apr: numeric
 * - hyperliquid_rate: numeric
 */
async function pushToSupabase(
    httpClient: { fetch: typeof fetch },
    rates: ConsensusRates
) {
    if (!config.supabaseUrl || !config.supabaseKey) {
        console.log("  [INFO] Skipping Supabase push (credentials not provided)");
        return;
    }

    const endpoint = `${config.supabaseUrl}/rest/v1/funding_rates`;

    // Flatten data for insertion
    const payload = [
        {
            timestamp: new Date(rates.timestamp).toISOString(),
            asset_symbol: "BTC",
            median_apr: rates.btc.medianRate,
            hyperliquid_rate: rates.btc.sources.find(s => s.venue === "hyperliquid")?.fundingRate ?? null,
        },
        {
            timestamp: new Date(rates.timestamp).toISOString(),
            asset_symbol: "ETH",
            median_apr: rates.eth.medianRate,
            hyperliquid_rate: rates.eth.sources.find(s => s.venue === "hyperliquid")?.fundingRate ?? null,
        }
    ];

    try {
        const response = await httpClient.fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": config.supabaseKey,
                "Authorization": `Bearer ${config.supabaseKey}`,
                "Prefer": "return=minimal", // Don't return the inserted rows
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`  [ERROR] Failed to push to Supabase: ${response.status} ${response.statusText} - ${errorText}`);
        } else {
            console.log("  [SUCCESS] Pushed 2 records to Supabase funding_rates table");
        }
    } catch (err) {
        console.error("  [ERROR] Supabase network error:", err);
    }
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
//
async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Local simulation entry point ──
async function main() {
    console.log("━━━ Kyute CRE Workflow ━━━");
    console.log("Config validated:");

    console.log(`  Hyperliquid API:   ${config.hyperliquidApiUrl}`);
    console.log(`  Supabase:          ${config.supabaseUrl ? "Enabled" : "Disabled"}`);
    console.log(`  Min Spread:        ${config.minSpreadThresholdBps} bps`);

    const httpClient = { fetch: globalThis.fetch };
    const POLL_INTERVAL_MS = 30000; // 30 seconds

    console.log(`Starting surveillance loop (Interval: ${POLL_INTERVAL_MS / 1000}s)...`);

    while (true) {
        try {
            const startTime = Date.now();
            console.log(`\n[${new Date().toLocaleTimeString()}] Fetching global funding rates...`);

            const rates = await fetchGlobalRates(httpClient);

            console.log("  ━━━ Consensus Results (R_cex) ━━━");
            console.log(`  BTC median rate:  ${rates.btc.medianRate.toFixed(4)}% APR`);
            // console.log(`    Sources: ${rates.btc.sources.map((s) => `${s.venue}(${s.fundingRate.toFixed(4)}%)`).join(", ")}`);
            console.log(`  ETH median rate:  ${rates.eth.medianRate.toFixed(4)}% APR`);
            // console.log(`    Sources: ${rates.eth.sources.map((s) => `${s.venue}(${s.fundingRate.toFixed(4)}%)`).join(", ")}`);

            console.log("  ━━━ Data Persistence ━━━");
            await pushToSupabase(httpClient, rates);

            // Wait for next tick
            const elapsed = Date.now() - startTime;
            const delay = Math.max(0, POLL_INTERVAL_MS - elapsed);
            await sleep(delay);

        } catch (err) {
            console.error("Failed to fetch rates:", err);
            // Wait before retrying on error
            await sleep(10000);
        }
    }
}

main();

// ── Exports ──
export { ConfigSchema, config, fetchGlobalRates, fetchHyperliquidRates, medianOf, filterOutliers };
export type { Config, VenueFundingRate, ConsensusRates };
