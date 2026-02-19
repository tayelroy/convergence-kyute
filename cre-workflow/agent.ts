import { createWalletClient, http, publicActions, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { fetchBorosImpliedApr } from "./boros.js";
import { fetchHyperliquidFundingRate } from "./hyperliquid.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { StabilityVaultABI } from "./abi/StabilityVaultABI.js";
import { AccountLib, Agent, Exchange, MarketAccLib, Side, TimeInForce } from "@pendle/sdk-boros";

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
    private rpcUrl: string;
    private accountAddress: `0x${string}`;
    private geminiKey: string;
    private vaultAddress: string;
    private genAI: GoogleGenerativeAI | null = null;
    private model: any = null;
    private exchange: Exchange | null = null;
    private borosAccountId = 0;
    private borosRootAddress: `0x${string}`;
    private borosTokenId = 0;
    private borosAgent: Agent | null = null;
    private useBorosAgentFlow = false;
    private fallbackToVaultOnBorosFailure = true;
    private autoApproveBorosAgent = false;

    // State for volatility analysis (last 24 data points)
    private historicalSpreads: number[] = [];

    // Spread threshold to trigger AI (bps). Default 500 bps = 5.00%
    private aiTriggerSpreadBps = Number(process.env.AI_TRIGGER_SPREAD_BPS);
    private hedgeCompositeThreshold = Number(process.env.HEDGE_COMPOSITE_THRESHOLD ?? "100");


    private wasAboveThreshold = false;


    constructor(config: AgentConfig) {
        const account = privateKeyToAccount(config.privateKey as `0x${string}`);
        this.client = createWalletClient({
            account,
            chain: arbitrum,
            transport: http(config.rpcUrl)
        }).extend(publicActions);
        this.rpcUrl = config.rpcUrl;
        this.accountAddress = account.address;

        this.geminiKey = config.geminiKey;
        this.vaultAddress = config.vaultAddress;

        const parsedAccountId = Number(process.env.BOROS_ACCOUNT_ID ?? "0");
        this.borosAccountId = Number.isFinite(parsedAccountId) ? parsedAccountId : 0;
        const parsedTokenId = Number(process.env.BOROS_TOKEN_ID ?? "0");
        this.borosTokenId = Number.isFinite(parsedTokenId) ? parsedTokenId : 0;

        this.useBorosAgentFlow = (process.env.BOROS_USE_AGENT_FLOW ?? "false").toLowerCase() === "true";
        this.fallbackToVaultOnBorosFailure = (process.env.BOROS_FALLBACK_TO_VAULT ?? "true").toLowerCase() !== "false";
        this.autoApproveBorosAgent = (process.env.BOROS_AUTO_APPROVE_AGENT ?? "false").toLowerCase() === "true";

        const rootAddress = (process.env.BOROS_ROOT_ADDRESS as `0x${string}` | undefined) ?? this.accountAddress;
        this.borosRootAddress = rootAddress;
        try {
            this.exchange = new Exchange(this.client as any, rootAddress, this.borosAccountId, [this.rpcUrl]);
        } catch (error) {
            this.exchange = null;
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[BOROS] SDK initialization failed: ${msg}`);
        }

        const configuredAgentPk = process.env.BOROS_AGENT_PRIVATE_KEY as `0x${string}` | undefined;
        if (configuredAgentPk && this.exchange) {
            try {
                this.borosAgent = Agent.createFromPrivateKey(configuredAgentPk);
                this.exchange.setAgent(this.borosAgent);
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                console.warn(`[BOROS] Agent init failed: ${msg}`);
            }
        }

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
        if (this.exchange) {
            console.log(`Boros SDK: Ready (accountId=${this.borosAccountId})`);
            console.log(`Boros Execution Mode: ${this.useBorosAgentFlow ? "Agent Flow" : "Vault Call"}`);
            if (this.useBorosAgentFlow && !this.borosAgent) {
                console.warn("Boros Agent Flow enabled but BOROS_AGENT_PRIVATE_KEY is missing; will use vault fallback if enabled.");
            }
        } else {
            console.warn("Boros SDK: Not initialized. Hedge fallback will skip SDK preflight.");
        }

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
                console.log(`   Composite Score: ${compositeScore.toFixed(2)} (threshold=${this.hedgeCompositeThreshold})`);

                if (compositeScore >= this.hedgeCompositeThreshold) {
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
                    Hyperliquid often leads Boros by 1-3%. A spread > 3% suggests arbitrageurs will sell on HL and buy on Boros, crushing Boros yields.

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

    private async resolveBorosMarketId(marketAddress: string): Promise<number | null> {
        if (!this.exchange) return null;

        const marketsResp = await this.exchange.getMarkets({
            skip: 0,
            limit: 100,
            isWhitelisted: true,
        }) as {
            results?: Array<{ marketId: number; address: string }>;
        };

        const targetMarket = marketsResp.results?.find(
            (market) => market.address.toLowerCase() === marketAddress.toLowerCase()
        );

        return targetMarket?.marketId ?? null;
    }

    private async ensureBorosAgentApproval(): Promise<void> {
        if (!this.exchange || !this.borosAgent) {
            throw new Error("Boros agent flow requires initialized Exchange + Agent");
        }

        const account = AccountLib.pack(this.borosRootAddress, this.borosAccountId);
        const expiry = await this.borosAgent.getExpiry(account);
        const now = Math.floor(Date.now() / 1000);

        if (expiry > now + 300) {
            return;
        }

        if (!this.autoApproveBorosAgent) {
            throw new Error("Boros agent is not approved or near expiry. Set BOROS_AUTO_APPROVE_AGENT=true or approve manually.");
        }

        console.log("[BOROS] Approving agent for root account...");
        const approveResult = await this.exchange.approveAgent(this.borosAgent);
        console.log("[BOROS] Agent approved:", approveResult);
    }

    private async executeBorosAgentHedge(marketAddress: `0x${string}`, size: bigint): Promise<void> {
        if (!this.exchange || !this.borosAgent) {
            throw new Error("Boros agent flow not configured");
        }

        await this.ensureBorosAgentApproval();

        const marketId = await this.resolveBorosMarketId(marketAddress);
        if (marketId === null) {
            throw new Error(`Boros market ${marketAddress} not found in SDK market list`);
        }

        const marketAcc = MarketAccLib.pack(this.borosRootAddress, this.borosAccountId, this.borosTokenId, marketId);
        const side = (process.env.BOROS_ORDER_SIDE ?? "SHORT").toUpperCase() === "LONG" ? Side.LONG : Side.SHORT;
        const slippage = Number(process.env.BOROS_ORDER_SLIPPAGE ?? "0.05");

        console.log(`[BOROS] Submitting agent order. marketId=${marketId} tokenId=${this.borosTokenId} side=${side === Side.SHORT ? "SHORT" : "LONG"}`);

        const orderResult = await this.exchange.placeOrder({
            marketAcc,
            marketId,
            side,
            size,
            tif: TimeInForce.IMMEDIATE_OR_CANCEL,
            slippage,
        });

        console.log("[BOROS] Agent order executed:", orderResult.executeResponse);
    }

    async executeHedge(apr: number) {
        const hedgeSizeWei = process.env.BOROS_ORDER_SIZE_WEI
            ? BigInt(process.env.BOROS_ORDER_SIZE_WEI)
            : parseEther("0.5");
        const BOROS_ETH_MARKET = (process.env.BOROS_MARKET_ADDRESS ?? "0x8db1397beb16a368711743bc42b69904e4e82122") as `0x${string}`;

        if (this.exchange) {
            try {
                const marketId = await this.resolveBorosMarketId(BOROS_ETH_MARKET);
                if (marketId === null) {
                    throw new Error(`Boros market ${BOROS_ETH_MARKET} not found in SDK market list`);
                }
                console.log(`[BOROS] SDK preflight ok. marketId=${marketId}`);
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                console.error(`[BOROS] Preflight failed, aborting hedge: ${msg}`);
                throw error;
            }
        }

        if (this.useBorosAgentFlow) {
            try {
                await this.executeBorosAgentHedge(BOROS_ETH_MARKET, hedgeSizeWei);
                console.log(`[TX] Hedge Executed via Boros Agent Flow @ ${(apr * 100).toFixed(2)}% APR`);
                return;
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                console.error(`[BOROS] Agent flow hedge failed: ${msg}`);
                if (!this.fallbackToVaultOnBorosFailure) {
                    throw error;
                }
                console.warn("[BOROS] Falling back to StabilityVault openShortYU...");
            }
        }

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