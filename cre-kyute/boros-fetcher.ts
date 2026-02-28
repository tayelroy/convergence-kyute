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
    let hlApr: number

    try {
        impliedApr = await fetchBorosImpliedApr(MARKET_ADDRESS)
    } catch (err: any) {
        console.error(`[boros-fetcher] SDK fetch failed: ${err.message}`)
        return
    }

    try {
        // Fetch raw predicted funding from API
        const payload = JSON.stringify({ type: "predictedFundings" })
        const response = await fetch("https://api.hyperliquid.xyz/info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload
        })
        const data = await response.json()
        const coinData = data.find((item: any) => item[0] === "ETH")
        if (!coinData) {
            hlApr = 0
        } else {
            const hlPerpEntry = venues.find((v: any) => v[0] === "HlPerp")
            hlApr = hlPerpEntry ? Number(hlPerpEntry[1].funding) * 24 * 365 : 0
        }
    } catch (err: any) {
        console.error(`[boros-fetcher] HL fetch failed: ${err.message}`)
        return
    }

    const rowBoros = {
        timestamp: new Date().toISOString(),
        market_address: MARKET_ADDRESS,
        implied_apr: impliedApr * 100, // store as percentage
    }

    const rowHl = {
        timestamp: new Date().toISOString(),
        source: "Hyperliquid",
        asset: "ETH",
        apr: hlApr * 100 // store as percentage
    }

    console.log(`[boros-fetcher] Boros APR: ${rowBoros.implied_apr.toFixed(4)}% | HL APR: ${rowHl.apr.toFixed(4)}%`)

    await supabase.from("boros_rates").insert(rowBoros)
    const { error: errorHl } = await supabase.from("funding_rates").insert(rowHl)

    if (error) {
        // If table doesn't exist, log instructions
        if (error.message.includes("boros_rates")) {
            console.error(`[boros-fetcher] Table "boros_rates" not found.`)
        } else {
            console.error(`[boros-fetcher] Supabase insert failed: ${error.message}`)
        }
    }

    if (errorHl) {
        if (errorHl.message.includes("funding_rates")) {
            console.error(`[boros-fetcher] Table "funding_rates" not found. Create it.`)
        } else {
            console.error(`[boros-fetcher] Supabase HL insert failed: ${errorHl.message}`)
        }
        return
    }

    console.log(`[boros-fetcher] ✓ Pushed to Supabase at ${rowBoros.timestamp}`)
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
