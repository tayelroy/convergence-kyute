import {
  CronCapability,
  consensusIdenticalAggregation,
  handler,
  Runner,
  HTTPClient,
  EVMClient,
  type HTTPSendRequester,
  type NodeRuntime,
  type Runtime,
} from "@chainlink/cre-sdk"
import { encodeAbiParameters } from "viem"

type Config = {
  schedule: string
  rpcUrl?: string
  privateKey?: string
  geminiKey?: string
  vaultAddress?: string
}

// Strict, simple types for the WASM boundary
type AgentResult = {
  status: string
  detail: string
}

const askGemini = (requester: HTTPSendRequester, config: Config) => {
  // Note: The ideal state is to fetch boros/hl spreads natively in CRE or inside askGemini
  // But aligning to the Blueprint provided.
  const payload = {
    contents: [{ parts: [{ text: "Spread is 5.5%. As a DeFi risk analyst, should we hedge? Return JSON with boolean 'hedge' and 'confidence' score." }] }],
    // Force Gemini to return strictly parsable JSON
    generationConfig: { responseMimeType: "application/json" }
  };

  // Use the native HTTP POST capability
  const response = requester.sendRequest({
    url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${config.geminiKey}`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // CRE RequestJson expects body to be a string (base64 encoded bytes in protobuf JSON mapping)
    body: Buffer.from(JSON.stringify(payload)).toString("base64")
  }).result();

  // Parse the REST response cleanly
  const jsonStr = new TextDecoder().decode(response.body);
  const data = JSON.parse(jsonStr);
  const aiText = data.candidates[0].content.parts[0].text;
  return JSON.parse(aiText); // Returns: { hedge: true, confidence: 85 }
}

const onCronTrigger = (runtime: Runtime<Config>) => {
  const http = new HTTPClient();

  // 1. Await Gemini via Native Consensus. The engine natively knows how to wait for this!
  const aiDecision = http.sendRequest(
    runtime,
    askGemini,
    consensusIdenticalAggregation()
  )(runtime.config).result();

  if (aiDecision.hedge && aiDecision.confidence > 80) {
    runtime.log(`AI Approved Hedge. Confidence: ${aiDecision.confidence}%. Executing...`);

    if (!runtime.config.vaultAddress) {
      runtime.log("vaultAddress is missing in config");
      return "FAILED: Missing vaultAddress";
    }

    // 2. Encode the AI's decision into bytes
    const reportBytes = encodeAbiParameters(
      [{ type: 'bool' }, { type: 'uint256' }],
      [aiDecision.hedge, BigInt(aiDecision.confidence)]
    );

    // Convert hex string (0x...) from viem to a byte string base64 for the native request payload
    const reportData = Buffer.from(reportBytes.slice(2), "hex").toString("base64");

    // 3. Cryptographically sign the report across the DON
    // The Runtime expects the report context in a ReportRequest/ReportRequestJson mapping
    const signedReport = runtime.report({ encodedPayload: reportData }).result();

    // 4. Submit to Arbitrum via Native EVM Capability
    // 4949039107694359620n is 'ethereum-mainnet-arbitrum-1'
    const evmClient = new EVMClient(4949039107694359620n);

    // The API actually requires hex string or Uint8Array for the receiver depending on the version
    const receiver = new Uint8Array(Buffer.from(runtime.config.vaultAddress.slice(2), "hex"));

    const tx = evmClient.writeReport(runtime, {
      $report: true,
      receiver,
      report: signedReport
    }).result();

    runtime.log("Hedge Executed! TX Sent to Network");
  } else {
    runtime.log(`AI Rejected Hedge or Confidence too low. Decision: ${aiDecision.hedge}, Confidence: ${aiDecision.confidence}%`);
  }

  return "SUCCESS";
}

const initWorkflow = (config: Config) => {
  const cron = new CronCapability()
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}