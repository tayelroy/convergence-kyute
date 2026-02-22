import { cre, Runner, type Runtime } from "@chainlink/cre-sdk";
import { KyuteAgent } from "./agent.js"; // Importing your existing logic

// Define the configuration shape (secrets are injected at runtime)
type Config = {
    rpcUrl: string;
    privateKey: string;
    geminiKey: string;
    vaultAddress: string;
};

export function initWorkflow(config: Config) {
    return [
        // Register the native CRE Cron Trigger (Runs every 1 minute)
        cre.handler(
            cre.cron.trigger({ schedule: "*/1 * * * *" }), 
            async (runtime: Runtime<Config>, triggerContext) => {
                runtime.log("CRE Cron Trigger Fired: Waking up KyuteAgent...");
                
                // Note: In a production CRE DON, we would use runtime.getSecret() 
                // Since this is a local simulation, we fall back to process.env
                const agent = new KyuteAgent({
                    rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
                    privateKey: process.env.PRIVATE_KEY || "",
                    geminiKey: process.env.GEMINI_API_KEY || "",
                    vaultAddress: process.env.STABILITY_VAULT_ADDRESS || ""
                });
                
                // Execute your exact existing logic
                await agent.executeWorkflow();
                
                runtime.log("KyuteAgent execution complete.");
                return "SUCCESS";
            }
        )
    ];
}

// The core runner required by the CRE WASM environment
export async function main() {
    const runner = Runner.newRunner<Config>();
    await runner.run(initWorkflow);
}