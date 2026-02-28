import {
  CronCapability,
  consensusIdenticalAggregation,
  handler,
  Runner,
  HTTPClient,
  EVMClient,
  hexToBase64,
  type Runtime,
} from "@chainlink/cre-sdk";
import { encodeAbiParameters } from "viem";
import { fetchHyperliquidFundingHistory } from "../hyperliquid";
import { fetchBorosImpliedApr } from "../boros";
import { predictFunding } from "../ai/model";

type Config = {
  schedule: string;
  vaultAddress: string;
  borosRouterAddress: string;
  coin: string;
};

const onCronTrigger = (runtime: Runtime<Config>) => {
  const http = new HTTPClient();
  const config = runtime.config;

  // 1. Fetch
  const hlApr = http.sendRequest(runtime, fetchHyperliquidFundingHistory, consensusIdenticalAggregation())(config.coin).result();
  const borosApr = http.sendRequest(runtime, fetchBorosImpliedApr, consensusIdenticalAggregation())(config.coin).result();

  runtime.log(`HL APR: ${(hlApr * 100).toFixed(2)}%`);
  runtime.log(`Boros APR: ${(borosApr * 100).toFixed(2)}%`);

  // 2. Predict
  const prediction = http.sendRequest(runtime, predictFunding, consensusIdenticalAggregation())(hlApr, borosApr).result();

  runtime.log(`Predicted APR: ${(prediction.apr * 100).toFixed(2)}%`);
  runtime.log(`Confidence: ${prediction.confidence} bp`);

  // 3. Decide: predicted APR > borosAPR && confidence >= 0.6 && savings > 0.1% buffer
  const borosAprBp = Math.floor(borosApr * 10000);
  const predictedAprBp = Math.floor(prediction.apr * 10000);
  const FEE_BUFFER_BP = 10;
  const MIN_CONFIDENCE_BP = 6000;

  const shouldHedge = (predictedAprBp > borosAprBp + FEE_BUFFER_BP) && (prediction.confidence >= MIN_CONFIDENCE_BP);

  // 4. Callback -> Vault
  // Generic hash for mock proof
  const proofHash = "0x" + Buffer.from("mock-zkp-hash-for-cre-simulation").toString("hex").padEnd(64, "0") as `0x${string}`;

  const reportBytes = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "bool" },
      { type: "address" },
      { type: "int256" },
      { type: "uint256" },
      { type: "int256" },
      { type: "bytes32" }
    ],
    [
      123n, // Mock userId = 123
      shouldHedge,
      "0x0000000000000000000000000000000000000001",
      BigInt(predictedAprBp),
      BigInt(prediction.confidence),
      BigInt(borosAprBp),
      proofHash
    ],
  )

  const signedReport = runtime.report({
    encodedPayload: hexToBase64(reportBytes),
    encoderName: "evm",
    signingAlgo: "ecdsa",
    hashingAlgo: "keccak256",
  }).result();

  // Assuming Arbitrum target
  const evmClient = new EVMClient(4949039107694359620n);
  const receiver = new Uint8Array(Buffer.from(config.vaultAddress.slice(2), "hex"));

  if (config.vaultAddress !== "0x0000000000000000000000000000000000000000") {
    evmClient.writeReport(runtime, {
      $report: true,
      receiver,
      report: signedReport,
    }).result();
  }

  runtime.log(`Hedge Decision Computed: ${shouldHedge}`);
  return shouldHedge ? "HEDGED_APPLIED_TO_VAULT" : "HEDGE_SKIPPED";
};

const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
