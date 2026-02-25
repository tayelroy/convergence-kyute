import {
  CronCapability,
  consensusIdenticalAggregation,
  handler,
  Runner,
  HTTPClient,
  EVMClient,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk"
import { encodeAbiParameters } from "viem"

// ─── Config ──────────────────────────────────────────────────────────────────

type Config = {
  schedule: string
  geminiKey: string
  vaultAddress: string
  supabaseUrl: string
  supabaseKey: string
  borosMarketAddress: string
  aiTriggerSpreadBps: number
  hedgeCompositeThreshold: number
  coin: string
}

// ─── Phase 1a: Read Boros APR from Supabase ─────────────────────────────────

/**
 * Read the latest Boros implied APR from Supabase (pushed by boros-fetcher.ts).
 * Uses PostgREST GET endpoint: /rest/v1/boros_rates?order=timestamp.desc&limit=1
 * Returns the implied APR as a decimal (e.g. 0.085 for 8.5%).
 */
const readBorosAprFromSupabase = (requester: HTTPSendRequester, config: Config) => {
  const url = `${config.supabaseUrl}/rest/v1/boros_rates?market_address=eq.${config.borosMarketAddress}&order=timestamp.desc&limit=1`

  const response = requester.sendRequest({
    url,
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      apikey: config.supabaseKey,
      Authorization: `Bearer ${config.supabaseKey}`,
    },
    body: "",
    cacheSettings: {
      store: true,
      maxAge: "60s",
    },
  }).result()

  const jsonStr = new TextDecoder().decode(response.body)
  const rows = JSON.parse(jsonStr) as Array<{ implied_apr: number; timestamp: string }>

  if (!rows.length) {
    throw new Error("No Boros rate found in Supabase. Is boros-fetcher.ts running?")
  }

  // implied_apr is stored as percentage in Supabase → convert to decimal
  return rows[0].implied_apr / 100
}

// ─── Phase 1b: Fetch Hyperliquid Funding Rate ───────────────────────────────

/**
 * Fetch the predicted funding rate from Hyperliquid.
 * POST https://api.hyperliquid.xyz/info { type: "predictedFundings" }
 * Returns annualized funding rate as a decimal (e.g. 0.15 for 15%).
 */
const fetchHyperliquidFundingRate = (requester: HTTPSendRequester, config: Config) => {
  const payload = JSON.stringify({ type: "predictedFundings" })

  const response = requester.sendRequest({
    url: "https://api.hyperliquid.xyz/info",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: Buffer.from(payload).toString("base64"),
    cacheSettings: {
      store: true,
      maxAge: "30s",
    },
  }).result()

  const jsonStr = new TextDecoder().decode(response.body)
  const data = JSON.parse(jsonStr) as any[]

  // Structure: [ "ETH", [ ["HlPerp", { fundingRate: "0.0000125" }], ... ] ]
  const coinData = data.find((item: any) => item[0] === config.coin)
  if (!coinData) return 0

  const venues = coinData[1] as any[]
  const hlPerpEntry = venues.find((v: any) => v[0] === "HlPerp")
  if (!hlPerpEntry) return 0

  const fundingRate = Number(hlPerpEntry[1].fundingRate)
  // Annualize: rate × 24 hours × 365 days
  return fundingRate * 24 * 365
}

// ─── Phase 2: AI Decision (Gemini) ──────────────────────────────────────────

/**
 * Ask Gemini to assess reversion risk for the yield spread.
 * Only called when spreadBps >= aiTriggerSpreadBps.
 */
const askGemini = (
  requester: HTTPSendRequester,
  borosApr: number,
  hlApr: number,
  spreadBps: number,
  config: Config,
) => {
  const spread = (hlApr - borosApr) * 100

  const prompt = `You are a DeFi Risk Analyst AI.

Market Data:
- Boros Implied APR (Arbitrum): ${(borosApr * 100).toFixed(2)}%
- Hyperliquid Funding Rate (Annualized): ${(hlApr * 100).toFixed(2)}%
- Spread (HL - Boros): ${spread.toFixed(2)}%
- Spread (bps): ${spreadBps.toFixed(0)} bps

Context:
Hyperliquid often leads Boros by 1-3%. A spread > 3% suggests arbitrageurs will sell on HL and buy on Boros, crushing Boros yields.

Task: Predict reversion risk (0-100) and whether hedging is advisable.
Return ONLY a JSON object: { "riskScore": number, "reason": "string", "hedge": boolean }`

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json" },
  }

  const response = requester.sendRequest({
    url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${config.geminiKey}`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: Buffer.from(JSON.stringify(payload)).toString("base64"),
    cacheSettings: {
      store: true,
      maxAge: "3600s",
    },
  }).result()

  const jsonStr = new TextDecoder().decode(response.body)
  const data = JSON.parse(jsonStr)
  const aiText = data.candidates[0].content.parts[0].text
  return JSON.parse(aiText) as { riskScore: number; reason: string; hedge: boolean }
}

// ─── Workflow Orchestration ─────────────────────────────────────────────────

const onCronTrigger = (runtime: Runtime<Config>) => {
  const http = new HTTPClient()
  const config = runtime.config

  // ── Phase 1: Fetch yield data ─────────────────────────────────────────
  runtime.log("Phase 1: Fetching yield data...")

  // 1a. Read Boros APR from Supabase (pushed by boros-fetcher.ts)
  const borosApr = http.sendRequest(
    runtime,
    readBorosAprFromSupabase,
    consensusIdenticalAggregation(),
  )(config).result()

  // 1b. Fetch Hyperliquid funding rate via REST
  const hlApr = http.sendRequest(
    runtime,
    fetchHyperliquidFundingRate,
    consensusIdenticalAggregation(),
  )(config).result()

  const spread = hlApr - borosApr
  const spreadBps = spread * 10000

  runtime.log(`Boros APR (from Supabase): ${(borosApr * 100).toFixed(2)}%`)
  runtime.log(`Hyperliquid APR: ${(hlApr * 100).toFixed(2)}%`)
  runtime.log(`Spread: ${(spread * 100).toFixed(2)}% (${spreadBps.toFixed(0)} bps)`)

  // ── Phase 2: AI decision (conditional) ────────────────────────────────
  if (spreadBps < config.aiTriggerSpreadBps) {
    runtime.log(
      `Spread ${spreadBps.toFixed(0)} bps < threshold ${config.aiTriggerSpreadBps} bps. No action.`,
    )
    return "HOLD — Spread below AI trigger threshold"
  }

  runtime.log(
    `Phase 2: Spread ${spreadBps.toFixed(0)} bps >= threshold. Calling Gemini AI...`,
  )

  const aiDecision = http.sendRequest(
    runtime,
    askGemini,
    consensusIdenticalAggregation(),
  )(borosApr, hlApr, spreadBps, config).result()

  runtime.log(`AI Risk Score: ${aiDecision.riskScore}/100`)
  runtime.log(`AI Reason: ${aiDecision.reason}`)
  runtime.log(`AI Hedge: ${aiDecision.hedge}`)

  // Composite score
  const spreadTerm = spread * 100
  const compositeScore = aiDecision.riskScore + spreadTerm

  runtime.log(
    `Composite Score: ${compositeScore.toFixed(2)} (threshold: ${config.hedgeCompositeThreshold})`,
  )

  // ── Phase 3: Execute hedge (conditional) ──────────────────────────────
  if (compositeScore < config.hedgeCompositeThreshold && !aiDecision.hedge) {
    runtime.log("Composite score below threshold. Holding.")
    return "HOLD — Composite score below threshold"
  }

  runtime.log("Phase 3: Executing hedge on StabilityVault...")

  if (!config.vaultAddress) {
    runtime.log("ERROR: vaultAddress missing in config")
    return "FAILED — Missing vaultAddress"
  }

  // Encode hedge report: (riskScore, spreadBps, shouldHedge)
  const reportBytes = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "bool" }],
    [BigInt(aiDecision.riskScore), BigInt(Math.round(spreadBps)), true],
  )

  const reportData = Buffer.from(reportBytes.slice(2), "hex").toString("base64")
  const signedReport = runtime.report({ encodedPayload: reportData }).result()

  // Submit to Arbitrum (chain selector 4949039107694359620n)
  const evmClient = new EVMClient(4949039107694359620n)
  const receiver = new Uint8Array(
    Buffer.from(config.vaultAddress.slice(2), "hex"),
  )

  evmClient
    .writeReport(runtime, {
      $report: true,
      receiver,
      report: signedReport,
    })
    .result()

  runtime.log(
    `Hedge executed! riskScore=${aiDecision.riskScore} spreadBps=${spreadBps.toFixed(0)}`,
  )
  return "HEDGE EXECUTED"
}

// ─── Workflow Init ──────────────────────────────────────────────────────────

const initWorkflow = (config: Config) => {
  const cron = new CronCapability()
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}