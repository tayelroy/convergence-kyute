import {
  CronCapability,
  consensusIdenticalAggregation,
  handler,
  Runner,
  type NodeRuntime,
  type Runtime,
} from "@chainlink/cre-sdk"

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

// 1. We make this fully async again
const runKyuteAgent = async (nodeRuntime: NodeRuntime<Config>): Promise<AgentResult> => {
  const {
    rpcUrl = "http://127.0.0.1:8545",
    privateKey,
    geminiKey,
    vaultAddress
  } = nodeRuntime.config;

  if (!privateKey || !vaultAddress) {
    return { status: "SKIPPED", detail: "Missing configuration variables." };
  }

  try {
    // 2. Await the dynamic import
    const { KyuteAgent } = await import("../agent.js");

    const agent = new KyuteAgent({
      rpcUrl,
      privateKey,
      geminiKey,
      vaultAddress,
    });

    // 3. Await the actual heavy lifting! 
    // This blocks the Chainlink node from moving on until the AI is done.
    const agentSummary = await agent.executeWorkflow();

    // 4. Return strictly serialized strings
    return {
      status: "COMPLETED",
      detail: agentSummary,
    };
  } catch (error) {
    return {
      status: "FAILED",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

const onCronTrigger = async (runtime: Runtime<Config>): Promise<AgentResult> => {
  runtime.log("Kyute workflow trigger fired. Awaiting Decentralized Consensus...");

  // 5. THE CRITICAL AWAIT: We must await the runInNodeMode call itself
  // Notice the `await` before runtime and the `()` before `.result()`
  const result = await runtime
    .runInNodeMode(
      runKyuteAgent,
      consensusIdenticalAggregation<AgentResult>(),
    )()
    .result();

  // 6. If we reach here, the network agreed on the AI's action!
  runtime.log(`Network Consensus Reached: ${result.status} - ${result.detail}`);
  return result;
}

const initWorkflow = (config: Config) => {
  const cron = new CronCapability()
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}