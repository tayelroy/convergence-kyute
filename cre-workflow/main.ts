
import { KyuteAgent } from "./agent.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function main() {
    console.log("🛡️ Starting kYUte Agent via Chainlink CRE...");

    if (!process.env.PRIVATE_KEY || !process.env.RPC_URL) {
        throw new Error("Missing PRIVATE_KEY or RPC_URL in .env");
    }

    if (!process.env.STABILITY_VAULT_ADDRESS) {
        throw new Error(
            "Missing STABILITY_VAULT_ADDRESS in .env. Deploy StabilityVault first:\n" +
            "  cd contracts && forge script script/DeployStabilityVault.s.sol:DeployStabilityVault --rpc-url arbitrum_sepolia --broadcast"
        );
    }

    // Initialize
    const agent = new KyuteAgent({
        rpcUrl: process.env.RPC_URL,
        privateKey: process.env.PRIVATE_KEY,
        geminiKey: process.env.GEMINI_API_KEY || "",
        vaultAddress: process.env.STABILITY_VAULT_ADDRESS
    });

    // Validating Connections
    await agent.healthCheck();

    // Start Workflow Loop (Simulating CRE Cron Trigger)
    console.log("🔄 Agent Active: Monitoring 30s Heartbeat...");

    // Initial run
    await agent.executeWorkflow();

    // Loop
    setInterval(async () => {
        try {
            await agent.executeWorkflow();
        } catch (err) {
            console.error("❌ Workflow Error:", err);
        }
    }, 30000);
}

main().catch(console.error);
