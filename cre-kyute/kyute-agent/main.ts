import {
  CronCapability,
  consensusIdenticalAggregation,
  handler,
  Runner,
  HTTPClient,
  EVMClient,
  hexToBase64,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk"
import { encodeAbiParameters } from "viem"

// ─── Config ──────────────────────────────────────────────────────────────────

type Config = {
  schedule: string
  vaultAddress: string
  supabaseUrl?: string // Now optional since we use Binance
  borosMarketAddress?: string // Now optional
  aiTriggerSpreadBps: number
  hedgeCompositeThreshold?: number // Deprecated but might be provided
  coin: string
}

// ─── Phase 1a: Fetch Binance Funding Rate ───────────────────────────────

/**
 * Fetch the current funding rate from Binance for the given symbol (ETHUSDT).
 * GET https://fapi.binance.com/fapi/v1/premiumIndex?symbol=ETHUSDT
 * Returns annualized funding rate as a decimal.
 * Binance settles every 8 hours, so rate * 3 * 365.
 */
const fetchBinanceFundingRate = (requester: HTTPSendRequester) => {
  const url = "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=ETHUSDT"

  const response = requester.sendRequest({
    url,
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    body: "",
    cacheSettings: {
      store: true,
      maxAge: "30s",
    },
  }).result()

  const jsonStr = new TextDecoder().decode(response.body)
  const data = JSON.parse(jsonStr)

  if (!data?.lastFundingRate) {
    throw new Error(`Binance API Error: ${jsonStr}`)
  }

  const fundingRate = Number(data.lastFundingRate)
  // Annualize: rate × 3 (8-hour intervals) × 365 days
  return fundingRate * 3 * 365
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
 * Ask Gemini to assess reversion risk for the yield spread and suggest leverage/direction.
 */
const askGemini = (
  requester: HTTPSendRequester,
  binanceApr: number,
  hlApr: number,
  spreadBps: number,
  geminiKey: string,
) => {
  const spread = (hlApr - binanceApr) * 100
  const isHLLower = hlApr < binanceApr

  const prompt = `You are an institutional DeFi Quant AI managing a Vault.

Market Data for ETH-Perp:
- Binance Funding Rate (Annualized): ${(binanceApr * 100).toFixed(2)}%
- Hyperliquid Funding Rate (Annualized): ${(hlApr * 100).toFixed(2)}%
- Spread (HL - Binance): ${spread.toFixed(2)}%
- Absolute Spread (bps): ${spreadBps.toFixed(0)} bps

Context:
Significant divergence in funding rates between major venues like Binance and Hyperliquid suggests a temporary market inefficiency. 
- If Hyperliquid's rate is significantly lower than Binance's, going LONG on Hyperliquid captures the return-to-mean as the rates converge.
- If Hyperliquid's rate is significantly higher, going SHORT on Hyperliquid captures the return-to-mean.

Task:
Evaluate the reversion opportunity. Provide a target "direction" (LONG, SHORT, or HOLD), a recommended "leverage" factor (from 1 to 3), and a confidence score (0-100). 
${isHLLower ? "Since Hyperliquid is currently lower than Binance, the reversion target should typically be LONG." : "Since Hyperliquid is currently higher than Binance, the reversion target should typically be SHORT."}
Return ONLY a JSON object: { "direction": "LONG" | "SHORT" | "HOLD", "leverage": number, "confidence": number, "reason": "string" }`

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json" },
  }

  if (!geminiKey) {
    throw new Error("Missing geminiKey from secrets!")
  }

  const response = requester.sendRequest({
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": geminiKey
    },
    body: Buffer.from(JSON.stringify(payload)).toString("base64"),
    cacheSettings: {
      store: true,
      maxAge: "10s",
    },
  }).result()

  const jsonStr = new TextDecoder().decode(response.body)
  const data = JSON.parse(jsonStr)

  if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
    throw new Error(`Gemini API Error: ${jsonStr}`)
  }

  const aiText = data.candidates[0].content.parts[0].text

  // Clean markdown code blocks if the model wrapped the JSON
  const cleanJson = aiText.replace(/```json/gi, "").replace(/```/g, "").trim()

  return JSON.parse(cleanJson) as { direction: string; leverage: number; confidence: number; reason: string }
}

// ─── Workflow Orchestration ─────────────────────────────────────────────────

const onCronTrigger = (runtime: Runtime<Config>) => {
  const http = new HTTPClient()
  const config = runtime.config

  // Read secrets from the CRE vault
  const geminiApiKey = runtime.getSecret({ id: "GEMINI_API_KEY" }).result().value

  // ── Phase 1: Fetch yield data ─────────────────────────────────────────
  runtime.log("Phase 1: Fetching yield data from Binance and Hyperliquid...")

  // 1a. Fetch Binance funding rate via REST
  const binanceApr = http.sendRequest(
    runtime,
    fetchBinanceFundingRate,
    consensusIdenticalAggregation(),
  )().result()

  // 1b. Fetch Hyperliquid funding rate via REST
  const hlApr = http.sendRequest(
    runtime,
    fetchHyperliquidFundingRate,
    consensusIdenticalAggregation(),
  )(config).result()

  const spread = hlApr - binanceApr
  const spreadBps = Math.abs(spread) * 10000

  runtime.log(`Binance APR: ${(binanceApr * 100).toFixed(2)}%`)
  runtime.log(`Hyperliquid APR: ${(hlApr * 100).toFixed(2)}%`)
  runtime.log(`Absolute Spread: ${spreadBps.toFixed(0)} bps (Raw Spread: ${(spread * 100).toFixed(2)}%)`)

  // ── Phase 2: AI decision (conditional) ────────────────────────────────
  if (spreadBps < config.aiTriggerSpreadBps) {
    runtime.log(
      `Absolute Spread ${spreadBps.toFixed(0)} bps < threshold ${config.aiTriggerSpreadBps} bps. No action.`,
    )
    return "HOLD — Spread below AI trigger threshold"
  }

  runtime.log(
    `Phase 2: Spread ${spreadBps.toFixed(0)} bps >= threshold. Calling Quant AI...`,
  )

  const aiDecision = http.sendRequest(
    runtime,
    askGemini,
    consensusIdenticalAggregation(),
  )(binanceApr, hlApr, spreadBps, geminiApiKey).result()

  runtime.log(`AI Direction: ${aiDecision.direction}`)
  runtime.log(`AI Leverage: ${aiDecision.leverage}x`)
  runtime.log(`AI Confidence Score: ${aiDecision.confidence}/100`)
  runtime.log(`AI Reason: ${aiDecision.reason}`)

  // ── Phase 3: Execute trade (conditional) ──────────────────────────────
  if (aiDecision.direction === "HOLD" || aiDecision.confidence < 80) {
    runtime.log("AI decision is HOLD or confidence below 80. Aborting execution.")
    return "HOLD — AI rejected execution"
  }

  runtime.log("Phase 3: Emitting Authorized Intent to StabilityVault...")

  if (!config.vaultAddress) {
    runtime.log("ERROR: vaultAddress missing in config")
    return "FAILED — Missing vaultAddress"
  }

  // Encode intent report: (direction, leverage, confidence) -> (string, uint256, uint256)
  const reportBytes = encodeAbiParameters(
    [{ type: "string" }, { type: "uint256" }, { type: "uint256" }],
    [aiDecision.direction, BigInt(aiDecision.leverage), BigInt(aiDecision.confidence)],
  )

  const signedReport = runtime.report({
    encodedPayload: hexToBase64(reportBytes),
    encoderName: "evm",
    signingAlgo: "ecdsa",
    hashingAlgo: "keccak256",
  }).result()

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
    `Intent authorized! Direction=${aiDecision.direction} Leverage=${aiDecision.leverage}x SpreadBps=${spreadBps.toFixed(0)}`,
  )
  return "INTENT EXECUTED"
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