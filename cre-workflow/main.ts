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

/** Inferred TypeScript type from the Zod schema */
type Config = z.infer<typeof ConfigSchema>;

// Parse config — uses defaults if no overrides are provided
const config: Config = ConfigSchema.parse({});

// ──────────────────────────────────────────────
// CRE Workflow Handler (stub)
// ──────────────────────────────────────────────
// NOTE: The full CRE handler using @chainlink/cre-sdk will be wired up
// once the SDK is installed and the workflow capabilities are imported.
//
// The pattern follows:
//   import cre from "@chainlink/cre-sdk";
//
//   cre.handler(
//     new cre.CronCapability("*/5 * * * *"),
//     async (runtime) => {
//       // 1. Fetch funding rates via HTTPCapability
//       // 2. Aggregate via consensusMedianAggregation
//       // 3. Calculate spread
//       // 4. If spread >= minSpreadThresholdBps → execute swap
//     }
//   );

console.log("━━━ Kyute CRE Workflow ━━━");
console.log("Config validated successfully:");
console.log(`  Binance API:       ${config.binanceApiUrl}`);
console.log(`  Hyperliquid API:   ${config.hyperliquidApiUrl}`);
console.log(`  Boros Market:      ${config.borosMarketAddress}`);
console.log(`  Min Spread:        ${config.minSpreadThresholdBps} bps`);

export { ConfigSchema, config };
export type { Config };
