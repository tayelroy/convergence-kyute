/**
 * Boros SDK Fetcher
 *
 * Standalone script that runs every 30 minutes, fetches the Boros implied APR
 * using the Pendle SDK, and pushes the result to Supabase for the CRE workflow
 * to consume.
 *
 * Usage:
 *   bun run boros-fetcher.ts
 *
 * Required env vars (from root .env):
 *   PRIVATE_KEY, RPC_URL, SUPABASE_URL, SUPABASE_KEY, BOROS_MARKET_ADDRESS
 */
import dotenv from "dotenv"
import path from "path"
dotenv.config({ path: path.resolve(import.meta.dir, "../.env") })

import { fetchBorosImpliedApr } from "./boros.js"
import { createClient } from "@supabase/supabase-js"

const INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

const MARKET_ADDRESS =
    process.env.BOROS_MARKET_ADDRESS ??
    "0x8db1397beb16a368711743bc42b69904e4e82122"

async function pushBorosRate() {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_KEY
    if (!supabaseUrl || !supabaseKey) {
        console.error("[boros-fetcher] Missing SUPABASE_URL or SUPABASE_KEY")
        return
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    console.log(`[boros-fetcher] Fetching Boros APR for market ${MARKET_ADDRESS}...`)

    let impliedApr: number
    try {
        impliedApr = await fetchBorosImpliedApr(MARKET_ADDRESS)
    } catch (err: any) {
        console.error(`[boros-fetcher] SDK fetch failed: ${err.message}`)
        return
    }

    const row = {
        timestamp: new Date().toISOString(),
        market_address: MARKET_ADDRESS,
        implied_apr: impliedApr * 100, // store as percentage
    }

    console.log(`[boros-fetcher] Boros APR: ${row.implied_apr.toFixed(4)}%`)

    const { error } = await supabase.from("boros_rates").insert(row)

    if (error) {
        // If table doesn't exist, log instructions
        if (error.message.includes("boros_rates")) {
            console.error(`[boros-fetcher] Table "boros_rates" not found. Create it:`)
            console.error(`  CREATE TABLE boros_rates (
    id bigint generated always as identity primary key,
    timestamp timestamptz not null default now(),
    market_address text not null,
    implied_apr numeric not null
  );`)
        } else {
            console.error(`[boros-fetcher] Supabase insert failed: ${error.message}`)
        }
        return
    }

    console.log(`[boros-fetcher] ✓ Pushed to Supabase at ${row.timestamp}`)
}

// ─── Main Loop ──────────────────────────────────────────────────────────────

async function main() {
    console.log("═══ Boros Rate Fetcher ═══")
    console.log(`Market:   ${MARKET_ADDRESS}`)
    console.log(`Interval: ${INTERVAL_MS / 60000} minutes`)
    console.log("")

    // Run immediately on start
    await pushBorosRate()

    // Then loop
    setInterval(pushBorosRate, INTERVAL_MS)
}

main().catch(console.error)
