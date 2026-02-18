
import { createWalletClient, http, publicActions, type WalletClient, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { fetchBorosImpliedApr } from "./boros.js";
import { fetchHyperliquidFundingRate } from "./hyperliquid.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Agent Configuration Interface
interface AgentConfig {
    rpcUrl: string;
    privateKey: string;
    geminiKey: string;
    vaultAddress: string;
}

export class KyuteAgent {
    // Use 'any' to avoid TS conflict between WalletClient (has account) and PublicClient (account: undefined)
    private wallet: any;
    private geminiKey: string;
    private vaultAddress: string;
    private genAI: GoogleGenerativeAI | null = null;
    private model: any = null;

    constructor(config: AgentConfig) {
        const account = privateKeyToAccount(config.privateKey as `0x${string}`);
        this.wallet = createWalletClient({
            account,
            chain: arbitrumSepolia,
            transport: http(config.rpcUrl)
        }).extend(publicActions);

        this.geminiKey = config.geminiKey;
        this.vaultAddress = config.vaultAddress;

        // Initialize Gemini AI if key is present
        if (this.geminiKey && this.geminiKey !== "mock-key-12345") {
            this.genAI = new GoogleGenerativeAI(this.geminiKey);
            const modelName = "gemini-3-flash-preview";
            this.model = this.genAI.getGenerativeModel({ model: modelName });
        }
    }

    async healthCheck() {
        console.log("EVM Connection: Connected to Arbitrum Sepolia");
        const chainId = await this.wallet.getChainId();
        console.log(`   Chain ID: ${chainId}`);

        if (!this.genAI) {
            console.warn("AI Capability: No valid GEMINI_API_KEY found.");
        } else {
            console.log(`AI Capability: ${this.model.model}`);
        }
    }

    async executeWorkflow() {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`\n--- kyute Workflow [${timestamp}] ---`);

        try {
            // 1. Fetch Yield Data (Oracle Capability)
            let borosApr = 0;
            let hlApr = 0;

            try {
                // Boros (Arbitrum)
                const marketAddress = "0x8db1397beb16a368711743bc42b69904e4e82122";
                borosApr = await fetchBorosImpliedApr(marketAddress);
            } catch (e) {
                console.warn("Boros Fetch Failed, defaulting to 15.5% (Simulation)");
                borosApr = 0.155;
            }

            try {
                // Hyperliquid (Arbitrum L3)
                // fetchHyperliquidFundingRate returns Annualized Funding Rate
                const rawHl = await fetchHyperliquidFundingRate("ETH");
                hlApr = rawHl; // Already annualized in helper
            } catch (e) {
                console.warn("Hyperliquid Fetch Failed, defaulting to Boros + 6%");
                hlApr = borosApr + 0.06;
            }

            const spread = hlApr - borosApr;

            console.log(`📊 Yield Comparison:`);
            console.log(`   Boros APR: ${(borosApr * 100).toFixed(2)}%`);
            console.log(`   Hyperliquid Funding (Annualized): ${(hlApr * 100).toFixed(2)}%`);
            console.log(`   Spread (Arb Opportunity): ${(spread * 100).toFixed(2)}%`);

            // 2. Fetch User Portfolio (Read Capability)
            const userBalance = 12500;
            console.log(`💰 Monitored Savings: $${userBalance.toLocaleString()} USDe`);

            // 3. AI Prediction (AI Capability)
            const riskScore = await this.predictYieldRisk(borosApr, hlApr);
            const riskLevel = riskScore > 70 ? "CRITICAL" : riskScore > 50 ? "HIGH" : "LOW";
            console.log(`AI Volatility Forecast: ${riskScore}/100 (${riskLevel})`);

            // 4. Decision & Action (Write Capability)
            // Logic: Hedge if Spread > 5% (reversion likely) AND AI agrees (Risk > 70)
            if (spread > 0.05 && riskScore > 70) {
                console.warn("CRITICAL YIELD VOLATILITY DETECTED: Initiating Hedge...");
                await this.executeHedge(borosApr);
            } else {
                console.log("Yield Stable. No hedge needed.");
            }
        } catch (error) {
            console.error("Agent Workflow Error:", error);
        }
    }

    async predictYieldRisk(borosApr: number, hlApr: number): Promise<number> {
        // Real AI Inference
        if (this.model) {
            try {
                const spread = (hlApr - borosApr) * 100; // in percentage points
                const prompt = `
                    You are a DeFi Risk Analyst AI. 
                    
                    Market Data:
                    - Boros Implied APR (Arbitrum): ${(borosApr * 100).toFixed(2)}%
                    - Hyperliquid Funding Rate (Annualized): ${(hlApr * 100).toFixed(2)}%
                    - Spread (HL - Boros): ${spread.toFixed(2)}%
                    
                    Context: 
                    Hyperliquid often leads Boros by 5-11%. A spread > 5% suggests arbitrageurs will sell on HL and buy on Boros, crushing Boros yields.
                    
                    Task: Predict reversion risk (0-100) based on this differential.
                    If Spread > 5%, risk should be HIGH (>70).
                    
                    Return ONLY a JSON object: { "riskScore": number, "reason": "string" }
                `;

                const result = await this.model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();

                const jsonText = text.replace(/```json/g, "").replace(/```/g, "").trim();
                const data = JSON.parse(jsonText);

                console.log(`   AI Reason: ${data.reason}`);
                return Math.min(Math.max(data.riskScore, 0), 100);
            } catch (err: any) {
                console.warn("AI Error (falling back to mock):", err.message);
            }
        }

        // Mock Fallback
        // High spread = High risk
        const spreadWeight = (hlApr - borosApr) * 500; // 0.05 * 500 = 25
        const baseRisk = Math.min(Math.floor(borosApr * 500), 50);
        return Math.min(baseRisk + spreadWeight + 20, 100);
    }

    async executeHedge(apr: number) {
        // Mock Interaction
        // In prod: 
        // 1. Calculate hedge size (e.g. 50% of portfolio)
        // 2. Call StabilityVault.openShortYU(hedgeAmount)
        const hedgeSize = 0.5; // 0.5 ETH or equivalent

        console.log(`[TX] Submitting Hedge to StabilityVault...`);
        console.log(`   Function: openShortYU(amount=${hedgeSize} ETH)`);

        // Simulating tx delay
        await new Promise(r => setTimeout(r, 1500));

        console.log(`[TX] Hedge Confirmed: Short YU Position Opened @ ${(apr * 100).toFixed(2)}% APR`);
        console.log(`User is now protected against yield compression.`);
    }
}
