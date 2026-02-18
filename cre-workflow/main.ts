import { KyuteAgent } from "./agent.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function main() {
    console.log("Starting kYUte Agent via Chainlink CRE...");

    // Prefer ANVIL_* if provided, else fall back
    const RPC_URL = process.env.ANVIL_RPC_URL ?? process.env.RPC_URL;
    const PRIVATE_KEY = process.env.ANVIL_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
    const VAULT = process.env.STABILITY_VAULT_ADDRESS;

    if (!PRIVATE_KEY || !RPC_URL) {
        throw new Error("Missing PRIVATE_KEY/RPC_URL (or ANVIL_PRIVATE_KEY/ANVIL_RPC_URL) in .env");
    }
    if (!VAULT) {
        throw new Error("Missing STABILITY_VAULT_ADDRESS in .env");
    }

    // Log what we’re using to avoid mismatches
    console.log(`RPC_URL: ${RPC_URL}`);
    console.log(`VAULT:   ${VAULT}`);

    const agent = new KyuteAgent({
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        geminiKey: process.env.GEMINI_API_KEY || "",
        vaultAddress: VAULT,
    });

    await agent.healthCheck();

    console.log("🔄 Agent Active: Monitoring 30s Heartbeat...");
    await agent.executeWorkflow();

    setInterval(async () => {
        try {
            await agent.executeWorkflow();
        } catch (err) {
            console.error(" Workflow Error:", err);
        }
    }, 30000);
}

main().catch(console.error);