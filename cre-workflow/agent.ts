
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



    // State for volatility analysis (last 24 data points)
    private historicalSpreads: number[] = [];

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
                const marketAddress = "0x8db1397beb16a368711743bc42b69904e4e82122"; // ETH-USDC Market on Boros
                borosApr = await fetchBorosImpliedApr(marketAddress);
            } catch (e) {
                console.warn("Boros Fetch Failed, defaulting to 15.5% (Simulation)");
                borosApr = 0.155;
            }

            try {
                // fetchHyperliquidFundingRate returns Annualized Funding Rate
                const hlFundingRate = await fetchHyperliquidFundingRate("ETH");
                hlApr = hlFundingRate;
            } catch (e) {
                console.warn("Hyperliquid Fetch Failed, defaulting to Boros + 6%");
                hlApr = borosApr + 0.06;
            }

            const spread = hlApr - borosApr;

            console.log(`Yield Comparison:`);
            console.log(`Boros APR: ${(borosApr * 100).toFixed(2)}%`);
            console.log(`Hyperliquid Funding (Annualized): ${(hlApr * 100).toFixed(2)}%`);
            console.log(`Spread Annualized (Arb Opportunity): ${(spread * 100).toFixed(2)}%`);

            // 2. Fetch User Portfolio (Read Capability)
            const userBalance = 12500; // TODO: Fetch from vault
            console.log(`Monitored Savings: $${userBalance.toLocaleString()} USDC`);

            // 3. AI Prediction (AI Capability)
            const prediction = await this.predictYieldRisk(borosApr, hlApr);
            const riskScore = prediction.riskScore;
            // Push current spread to history (maintain rolling window of 24)
            if (this.historicalSpreads.length >= 24) this.historicalSpreads.shift();
            this.historicalSpreads.push(spread);

            const riskLevel = riskScore > 90 ? "CRITICAL" : riskScore > 70 ? "HIGH" : "LOW";
            console.log(`AI Volatility Forecast: ${riskScore}/100 (${riskLevel})`);
            console.log(`   AI Reason: ${prediction.reason}`);

            // 4. Decision & Action (Write Capability)
            // Improved Logic: Composite score = riskScore + confidence boost + (spread * volFactor)
            try {
                const volFactor = this.calculateVolatilityFactor(this.historicalSpreads);
                const confidenceBoost = this.getConfidenceBoost(prediction.reason);
                // Spread is decimal (e.g. 0.05), so we scale by 100 to get percentage points (e.g. 5) 
                // Then multiply by volFactor. Example: 5 * 1.5 = 7.5 added to score? 
                // User logic: (spread * volFactor * 100). If spread is 0.08, term is 8 * 1.5 = 12.
                const spreadTerm = spread * 100 * volFactor;
                const compositeScore = riskScore + confidenceBoost + spreadTerm;

                console.log(`   Volatility Factor: ${volFactor.toFixed(2)}x`);
                console.log(`   Confidence Boost: +${confidenceBoost}`);
                console.log(`   Composite Score: ${compositeScore.toFixed(2)}`);

                if (compositeScore > 100) {
                    console.warn("CRITICAL YIELD VOLATILITY DETECTED: Initiating Hedge...");
                    await this.executeHedge(borosApr);
                } else {
                    console.log("Yield Stable. No hedge needed.");
                }
            } catch (error) {
                console.error("Decision Logic Error:", error);
            }
        } catch (error) {
            console.error("Agent Workflow Error:", error);
        }
    }

    async predictYieldRisk(borosApr: number, hlApr: number): Promise<{ riskScore: number, reason: string }> {
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

                // console.log(`   AI Reason: ${data.reason}`);
                return {
                    riskScore: Math.min(Math.max(data.riskScore, 0), 100),
                    reason: data.reason
                };
            } catch (err: any) {
                console.warn("AI Error (falling back to mock):", err.message);
            }
        }

        // Mock Fallback
        // High spread = High risk
        const spreadWeight = (hlApr - borosApr) * 500; // 0.05 * 500 = 25
        const baseRisk = Math.min(Math.floor(borosApr * 500), 50);
        return {
            riskScore: Math.min(baseRisk + spreadWeight + 20, 100),
            reason: "Simulated fallback risk assessment due to API unavailability."
        };
    }

    // Helper: Calculate volatility factor (std dev normalized)
    private calculateVolatilityFactor(historicalSpreads: number[]): number {
        if (historicalSpreads.length < 2) return 1; // Default if insufficient data
        const mean = historicalSpreads.reduce((a, b) => a + b, 0) / historicalSpreads.length;
        const variance = historicalSpreads.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / historicalSpreads.length;
        const stdDev = Math.sqrt(variance);
        return 1 + (stdDev / 0.05); // Normalize to base spread threshold (5%); higher volatility increases factor
    }

    // Parse AI reason for confidence boost (simple keyword scoring)
    private getConfidenceBoost(reason: string): number {
        const keywords = ['extreme', 'high', 'likely', 'significant', 'crash', 'collapse'];
        return keywords.some(word => reason ? reason.toLowerCase().includes(word) : false) ? 20 : 0; // +20 if confident language
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
