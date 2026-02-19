import assert from "node:assert/strict";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { KyuteAgent } from "./agent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

async function main() {
  const RPC_URL = process.env.ANVIL_RPC_URL ?? process.env.RPC_URL;
  const PRIVATE_KEY = process.env.ANVIL_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!RPC_URL) throw new Error("Missing ANVIL_RPC_URL or RPC_URL in .env");
  if (!PRIVATE_KEY) throw new Error("Missing ANVIL_PRIVATE_KEY or PRIVATE_KEY in .env");
  const VAULT = requiredEnv("STABILITY_VAULT_ADDRESS");

  const mode = (process.env.TEST_AGENT_HEDGE_MODE ?? "dry-run").toLowerCase();
  const useAgentFlow = mode !== "anvil-live";
  process.env.BOROS_USE_AGENT_FLOW = useAgentFlow ? "true" : "false";
  const agent = new KyuteAgent({
    rpcUrl: RPC_URL,
    privateKey: PRIVATE_KEY,
    geminiKey: process.env.GEMINI_API_KEY || "",
    vaultAddress: VAULT,
  });

  const internal = agent as any;

  assert.ok(internal.exchange, "Exchange should be initialized");
  assert.equal(internal.useBorosAgentFlow, useAgentFlow, `Agent flow should be ${useAgentFlow ? "enabled" : "disabled"}`);

  if (mode === "dry-run") {
    let called = false;

    internal.resolveBorosMarketId = async (_marketAddress: `0x${string}`) => 1;

    internal.executeBorosAgentHedge = async (marketAddress: `0x${string}`, size: bigint) => {
      called = true;
      assert.ok(/^0x[a-fA-F0-9]{40}$/.test(marketAddress), "Market address should be valid");
      assert.ok(size > 0n, "Order size should be positive");
      return;
    };

    await agent.executeHedge(0.12);
    assert.ok(called, "executeBorosAgentHedge should be called in dry-run mode");
    console.log("[PASS] dry-run: init agent + executeHedge path executed");
    return;
  }

  if (mode === "live") {
    if (!process.env.BOROS_AGENT_PRIVATE_KEY) {
      throw new Error("Missing BOROS_AGENT_PRIVATE_KEY for live mode");
    }

    await agent.healthCheck();

    console.log("[LIVE] Executing agent hedge. This may place a real Boros order.");
    await agent.executeHedge(0.12);
    console.log("[PASS] live: init agent + executeHedge executed");
    return;
  }

  if (mode === "anvil-live") {
    await agent.healthCheck();

    console.log("[ANVIL-LIVE] Executing hedge via StabilityVault on local fork...");
    await agent.executeHedge(0.12);
    console.log("[PASS] anvil-live: agent init validated + onchain hedge tx sent to Anvil fork");
    return;
  }

  throw new Error(`Unsupported TEST_AGENT_HEDGE_MODE=${mode}. Use dry-run, live, or anvil-live.`);
}

main().catch((err) => {
  console.error("[FAIL] test_agent_executeHedge:", err);
  process.exit(1);
});
