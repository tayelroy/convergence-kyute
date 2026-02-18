import { createWalletClient, http, publicActions, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { fetchBorosImpliedApr } from "./boros.js";
import { fetchHyperliquidFundingRate } from "./hyperliquid.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { StabilityVaultABI } from "./abi/StabilityVaultABI.js";

// Inferred client type for viem (WalletClient + PublicActions combined)
const _buildClient = (acct: ReturnType<typeof privateKeyToAccount>, rpcUrl: string) =>
    createWalletClient({ account: acct, chain: arbitrum, transport: http(rpcUrl) })
        .extend(publicActions);

type KyuteClient = ReturnType<typeof _buildClient>;

// Agent Configuration Interface
interface AgentConfig {
    rpcUrl: string;
    privateKey: string;
    geminiKey: string;
    vaultAddress: string;
}

export class KyuteAgent {
    private client: KyuteClient;
    private geminiKey: string;
    private vaultAddress: string;
    private genAI: GoogleGenerativeAI | null = null;
    private model: any = null;

    // State for volatility analysis (last 24 data points)
    private historicalSpreads: number[] = [];

    // Spread threshold to trigger AI (bps). Default 500 bps = 5.00%
    private aiTriggerSpreadBps = Number(process.env.AI_TRIGGER_SPREAD_BPS);

    private wasAboveThreshold = false;


    constructor(config: AgentConfig) {
        const account = privateKeyToAccount(config.privateKey as `0x${string}`);
        this.client = createWalletClient({
            account,
            chain: arbitrum,
            transport: http(config.rpcUrl)
        }).extend(publicActions);

        this.geminiKey = config.geminiKey;
        this.vaultAddress = config.vaultAddress;

        // Initialize Gemini AI if key is present
        if (this.geminiKey) {
            this.genAI = new GoogleGenerativeAI(this.geminiKey);
            const modelName = "gemini-3-flash-preview";
            this.model = this.genAI.getGenerativeModel({ model: modelName });
        }
    }

    async healthCheck() {
        console.log("EVM Connection: Connected to Arbitrum One (fork)");
        const chainId = await this.client.getChainId();
        console.log(`   Chain ID: ${chainId}`);

        if (!this.genAI) {
            console.warn("AI Capability: No valid GEMINI_API_KEY found.");
        } else {
            console.log(`AI Capability: ${this.model.model}`);
            console.log(`AI Trigger Threshold: ${this.aiTriggerSpreadBps} bps`);
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
            const spreadBps = spread * 10000; // decimal -> bps

            console.log(`Yield Comparison:`);
            console.log(`Boros APR: ${(borosApr * 100).toFixed(2)}%`);
            console.log(`Hyperliquid Funding (Annualized): ${(hlApr * 100).toFixed(2)}%`);
            console.log(`Spread Annualized (Arb Opportunity): ${(spread * 100).toFixed(2)}%`);
            console.log(`Spread (bps): ${spreadBps.toFixed(0)} bps`);

            // 2. Fetch User Portfolio (Read Capability)
            let userBalance = 0;
            try {
                const rawBalance = await this.client.readContract({
                    address: this.vaultAddress as `0x${string}`,
                    abi: StabilityVaultABI,
                    functionName: "balances",
                    args: [this.client.account.address],
                });
                userBalance = Number(rawBalance) / 1e18; // wei → ETH
            } catch (balErr) {
                console.warn("Could not fetch vault balance, defaulting to 0:", balErr);
            }
            console.log(`Monitored Vault ETH: ${userBalance.toFixed(4)} ETH`);

            // Push spread history (rolling window of 24)
            if (this.historicalSpreads.length >= 24) this.historicalSpreads.shift();
            this.historicalSpreads.push(spread);

            // 3. AI Prediction (only when spread threshold exceeded)
            const aboveThreshold = spreadBps >= this.aiTriggerSpreadBps;
            console.log(`[AI] spreadBps=${spreadBps.toFixed(0)} threshold=${this.aiTriggerSpreadBps}`);
            
            let prediction: { riskScore: number; reason: string };
            if (aboveThreshold && !this.wasAboveThreshold) {
                console.log(`[AI] Triggered on threshold cross. spread=${spreadBps.toFixed(0)} bps`);
                prediction = await this.predictYieldRisk(borosApr, hlApr, this.historicalSpreads);
            } else {
                prediction = {
                    riskScore: 25,
                    reason: aboveThreshold
                        ? `Spread still above threshold (${this.aiTriggerSpreadBps} bps). Skipping repeat AI call.`
                        : `Spread ${spreadBps.toFixed(0)} bps below AI trigger (${this.aiTriggerSpreadBps} bps). Skipping AI call.`,
                };
            }

            // Update state after evaluation
            this.wasAboveThreshold = aboveThreshold;

            const riskScore = prediction.riskScore;
            const riskLevel = riskScore > 90 ? "CRITICAL" : riskScore > 70 ? "HIGH" : "LOW";
            console.log(`AI Volatility Forecast: ${riskScore}/100 (${riskLevel})`);
            console.log(`   AI Reason: ${prediction.reason}`);

            // 4. Decision & Action
            try {
                const volFactor = this.calculateVolatilityFactor(this.historicalSpreads);
                const confidenceBoost = this.getConfidenceBoost(prediction.reason);
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

    async predictYieldRisk(
        borosApr: number,
        hlApr: number,
        history: number[]
    ): Promise<{ riskScore: number, reason: string }> {
        // Real AI Inference (only called when spread threshold exceeded)
        if (this.model) {
            try {
                const spread = (hlApr - borosApr) * 100; // in percentage points
                const historyPct = history.map(s => (s * 100).toFixed(2)).join(", ");
                const prompt = `
                    You are a DeFi Risk Analyst AI. 

                    Market Data:
                    - Boros Implied APR (Arbitrum): ${(borosApr * 100).toFixed(2)}%
                    - Hyperliquid Funding Rate (Annualized): ${(hlApr * 100).toFixed(2)}%
                    - Spread (HL - Boros): ${spread.toFixed(2)}%

                    Historical Spreads (last ${history.length} samples, in % points):
                    [${historyPct}]

                    Context: 
                    Hyperliquid often leads Boros by 5-11%. A spread > 8% suggests arbitrageurs will sell on HL and buy on Boros, crushing Boros yields.

                    Task: Predict reversion risk (0-100) based on this differential and the recent spread trend.
                    Return ONLY a JSON object: { "riskScore": number, "reason": "string" }
                `;

                const result = await this.model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();

                const jsonText = text.replace(/```json/g, "").replace(/```/g, "").trim();
                const data = JSON.parse(jsonText);

                return {
                    riskScore: Math.min(Math.max(data.riskScore, 0), 100),
                    reason: data.reason
                };
            } catch (err: any) {
                console.warn("AI Error (falling back to mock):", err.message);
            }
        }

        // Mock Fallback (if AI fails)
        const spreadWeight = (hlApr - borosApr) * 500;
        const baseRisk = Math.min(Math.floor(borosApr * 500), 50);
        return {
            riskScore: Math.min(baseRisk + spreadWeight + 20, 100),
            reason: "Simulated fallback risk assessment due to API unavailability."
        };
    }

    private calculateVolatilityFactor(historicalSpreads: number[]): number {
        if (historicalSpreads.length < 2) return 1;
        const mean = historicalSpreads.reduce((a, b) => a + b, 0) / historicalSpreads.length;
        const variance = historicalSpreads.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / historicalSpreads.length;
        const stdDev = Math.sqrt(variance);
        return 1 + (stdDev / 0.05);
    }

    private getConfidenceBoost(reason: string): number {
        const keywords = ['extreme', 'high', 'likely', 'significant', 'crash', 'collapse'];
        return keywords.some(word => reason ? reason.toLowerCase().includes(word) : false) ? 20 : 0;
    }

    async executeHedge(apr: number) {
        const hedgeSizeWei = parseEther("0.5");
        const BOROS_ETH_MARKET = "0x8db1397beb16a368711743bc42b69904e4e82122";
        console.log(`[TX] Submitting Hedge to StabilityVault...`);
        console.log(`   Contract: ${this.vaultAddress}`);
        console.log(`   Market: ${BOROS_ETH_MARKET}`);
        console.log(`   Function: openShortYU(${BOROS_ETH_MARKET}, ${hedgeSizeWei} wei = 0.5 ETH)`);

        try {
            const txHash = await this.client.writeContract({
                address: this.vaultAddress as `0x${string}`,
                abi: StabilityVaultABI,
                functionName: "openShortYU",
                args: [BOROS_ETH_MARKET, hedgeSizeWei],
            });
            console.log(`[TX] Broadcast: ${txHash}`);

            const receipt = await this.client.waitForTransactionReceipt({ hash: txHash });
            console.log(`[TX] Confirmed in block ${receipt.blockNumber}`);
            console.log(`[TX] Hedge Executed: Short YU position opened @ ${(apr * 100).toFixed(2)}% APR`);
            console.log(`User is now protected against yield compression.`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[TX] Hedge transaction failed: ${msg}`);
            throw err;
        }
    }
}