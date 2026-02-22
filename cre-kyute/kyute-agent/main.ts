import { cre, Runner, type Runtime } from "@chainlink/cre-sdk";
import { KyuteAgent } from "../agent.ts"; 

// 1. Remove the (config: Config) parameter from this function
export function initWorkflow() {
    return [
        cre.handler(
            cre.cron.trigger({ schedule: "*/1 * * * *" }), 
            async (runtime: Runtime, triggerContext) => {
                runtime.log("CRE Cron Trigger Fired...");
                
                // 2. Access secrets/env directly inside the handler
                const agent = new KyuteAgent({
                    rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
                    privateKey: process.env.PRIVATE_KEY || "",
                    geminiKey: process.env.GEMINI_API_KEY || "",
                    vaultAddress: process.env.STABILITY_VAULT_ADDRESS || ""
                });
                
                await agent.executeWorkflow();
                return "SUCCESS";
            }
        )
    ];
}

export async function main() {
    // 3. New up the runner without a generic type
    const runner = Runner.newRunner();
    await runner.run(initWorkflow);
}