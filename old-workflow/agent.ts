import { createWalletClient, createPublicClient, http, publicActions, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { fetchBorosImpliedApr } from "./boros.js";
import { fetchHyperliquidFundingRate } from "./hyperliquid.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { StabilityVaultABI } from "./abi/StabilityVaultABI.js";
import { Exchange } from "@pendle/sdk-boros";

// Inferred client type for viem (WalletClient + PublicActions combined)
const _buildClient = (acct: ReturnType<typeof privateKeyToAccount>, rpcUrl: string) =>
    createWalletClient({ account: acct, chain: arbitrum, transport: http(rpcUrl) })
        .extend(publicActions);

type KyuteClient = ReturnType<typeof _buildClient>;
const WETH_ADDRESS = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1".toLowerCase();
const ERC20_BALANCE_OF_ABI = [
    {
        name: "balanceOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    },
] as const;
const WETH_DEPOSIT_ABI = [
    {
        name: "deposit",
        type: "function",
        stateMutability: "payable",
        inputs: [],
        outputs: [],
    },
] as const;
const CHAINLINK_ETH_USD_FEED = (process.env.CHAINLINK_ETH_USD_FEED_ADDRESS ?? "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612") as `0x${string}`;
const AGGREGATOR_V3_ABI = [
    {
        name: "decimals",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint8" }],
    },
    {
        name: "latestRoundData",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [
            { name: "roundId", type: "uint80" },
            { name: "answer", type: "int256" },
            { name: "startedAt", type: "uint256" },
            { name: "updatedAt", type: "uint256" },
            { name: "answeredInRound", type: "uint80" },
        ],
    },
] as const;

// Agent Configuration Interface
interface AgentConfig {
    rpcUrl: string;
    privateKey: string;
    geminiKey: string;
    vaultAddress: string;
}

interface HedgeEventContext {
    hlApr: number;
    spreadBps: number;
    userBalance: number;
    riskScore: number;
    riskLevel: string;
    compositeScore: number;
    reason: string;
}

interface ChainlinkFeedSnapshot {
    priceUsd: number;
    roundId: bigint;
    updatedAt: bigint;
    normalizedSpreadBps: number;
}

interface FunctionsDecision {
    requestId: string;
    confidence: number;
    shouldHedge: boolean;
    reason: string;
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

    // State for volatility analysis (last 24 data points)
    private historicalSpreads: number[] = [];

    // Spread threshold to trigger AI (bps). Default 500 bps = 5.00%
    private aiTriggerSpreadBps = Number(process.env.AI_TRIGGER_SPREAD_BPS);
    private hedgeCompositeThreshold = Number(process.env.HEDGE_COMPOSITE_THRESHOLD ?? "100");
    private supabase: SupabaseClient | null = null;
    private fundingRatesInsertEnabled = true;
    private lastAutomationTxHashLogged: string | null = null;


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

        try {
            const borosPublicClient = require("@pendle/sdk-boros/dist/entities/publicClient");
            borosPublicClient.publicClient = createPublicClient({
                chain: arbitrum,
                transport: http(this.rpcUrl),
            });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[BOROS] Could not override SDK public client: ${msg}`);
        }

        try {
            this.exchange = new Exchange(this.client as any, this.accountAddress, 0, [this.rpcUrl]);
        } catch (error) {
            this.exchange = null;
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[BOROS] SDK initialization failed: ${msg}`);
        }

        // Initialize Gemini AI if key is present
        if (this.geminiKey) {
            this.genAI = new GoogleGenerativeAI(this.geminiKey);
            const modelName = "gemini-3.0-flash-preview"; // DO NOT CHANGE THIS
            this.model = this.genAI.getGenerativeModel({ model: modelName });
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_KEY;
        if (supabaseUrl && supabaseKey) {
            this.supabase = createClient(supabaseUrl, supabaseKey);
        } else {
            console.warn("[Supabase] Missing SUPABASE_URL or SUPABASE_KEY. Snapshot inserts disabled.");
        }
    }

    async healthCheck() {
        console.log("EVM Connection: Connected to Arbitrum One (fork)");
        const chainId = await this.client.getChainId();
        console.log(`   Chain ID: ${chainId}`);
        if (this.exchange) {
            console.log(`Boros SDK: Ready (accountId=0)`);
        } else {
            console.warn("Boros SDK: Not initialized.");
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
            const medianApr = (borosApr + hlApr) / 2;
            const feedSnapshot = await this.captureChainlinkFeedSnapshot(spread);
            const functionsDecision = await this.runChainlinkFunctionsDecision(borosApr, hlApr, spreadBps, feedSnapshot);
            await this.captureAutomationProofIfPresent();

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

            if (this.supabase) {
                const { error } = await this.supabase.from("kyute_events").insert({
                    timestamp: new Date().toISOString(),
                    asset_symbol: "ETH",
                    event_type: "snapshot",
                    boros_apr: borosApr * 100,
                    hl_apr: hlApr * 100,
                    spread_bps: Math.round(spreadBps),
                    vault_balance_eth: userBalance,
                });

                if (error) {
                    console.error("[Supabase] Failed to insert kyute_events snapshot row:", error.message);
                }
            }

            // Push spread history (rolling window of 24)
            if (this.historicalSpreads.length >= 24) this.historicalSpreads.shift();
            this.historicalSpreads.push(spread);

            // 3. AI Prediction (only when spread threshold exceeded)
            const aboveThreshold = spreadBps >= this.aiTriggerSpreadBps;
            const aiTriggered = aboveThreshold && !this.wasAboveThreshold;
            console.log(`[AI] spreadBps=${spreadBps.toFixed(0)} threshold=${this.aiTriggerSpreadBps}`);

            let prediction: { riskScore: number; reason: string };
            if (aiTriggered && !functionsDecision.shouldHedge) {
                console.log(`[AI] Triggered on threshold cross. spread=${spreadBps.toFixed(0)} bps`);
                prediction = await this.predictYieldRisk(borosApr, hlApr, this.historicalSpreads);
            } else {
                prediction = {
                    riskScore: functionsDecision.shouldHedge ? Math.max(functionsDecision.confidence, 60) : 25,
                    reason: functionsDecision.shouldHedge
                        ? `[Functions ${functionsDecision.requestId}] ${functionsDecision.reason}`
                        : (aboveThreshold
                            ? `Spread still above threshold (${this.aiTriggerSpreadBps} bps). Skipping repeat AI call.`
                            : `Spread ${spreadBps.toFixed(0)} bps below AI trigger (${this.aiTriggerSpreadBps} bps). Skipping AI call.`),
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

                if (compositeScore >= this.hedgeCompositeThreshold || functionsDecision.shouldHedge) {
                    console.warn("CRITICAL YIELD VOLATILITY DETECTED: Initiating Hedge...");
                    await this.executeHedge(borosApr, {
                        hlApr,
                        spreadBps,
                        userBalance,
                        riskScore,
                        riskLevel,
                        compositeScore,
                        reason: prediction.reason,
                    });
                } else {
                    console.log("Yield Stable. No hedge needed.");
                }

                if ((aiTriggered || functionsDecision.shouldHedge) && this.supabase) {
                    const { error } = await this.supabase.from("kyute_events").insert({
                        timestamp: new Date().toISOString(),
                        asset_symbol: "ETH",
                        event_type: "ai_trigger",
                        boros_apr: borosApr * 100,
                        hl_apr: hlApr * 100,
                        spread_bps: Math.round(spreadBps),
                        vault_balance_eth: userBalance,
                        risk_score: riskScore,
                        risk_level: riskLevel,
                        composite_score: compositeScore,
                        reason: prediction.reason,
                        action: compositeScore >= this.hedgeCompositeThreshold || functionsDecision.shouldHedge ? "HEDGE" : "HOLD",
                    });

                    if (error) {
                        console.error("[Supabase] Failed to insert kyute_events ai_trigger row:", error.message);
                    }
                }
            } catch (error) {
                console.error("Decision Logic Error:", error);
            }

            if (this.supabase && this.fundingRatesInsertEnabled) {
                const { error } = await this.supabase
                    .from("funding_rates")
                    .insert({
                        timestamp: new Date().toISOString(),
                        asset_symbol: "ETH",
                        boros_rate: borosApr * 100,
                        hyperliquid_rate: hlApr * 100,
                        spread_bps: Math.round(spreadBps),
                        median_apr: medianApr * 100,
                    });

                if (error) {
                    const tableMissing = error.message.includes("public.funding_rates")
                        || error.message.includes("funding_rates");

                    if (tableMissing) {
                        this.fundingRatesInsertEnabled = false;
                        console.error("[Supabase] funding_rates table is missing; disabling funding_rates writes for this run.");
                        console.error("[Supabase] Create table: id bigint generated always as identity primary key, timestamp timestamptz, asset_symbol text, boros_rate numeric, hyperliquid_rate numeric, spread_bps integer, median_apr numeric.");
                    } else {
                        console.error("[Supabase] Failed to insert funding_rates row:", error.message);
                    }
                }
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

    async executeHedge(apr: number, context?: HedgeEventContext) {
        if (!this.exchange) {
            throw new Error("[BOROS] Exchange not initialized");
        }

        const marketAddress = process.env.BOROS_MARKET_ADDRESS as `0x${string}` | undefined;
        const collateralAddress = process.env.BOROS_COLLATERAL_ADDRESS as `0x${string}` | undefined;
        const depositAmountEth = process.env.BOROS_DEPOSIT_AMOUNT_ETH ?? "0.5";

        if (!marketAddress || !collateralAddress) {
            throw new Error("[BOROS] Missing BOROS_MARKET_ADDRESS or BOROS_COLLATERAL_ADDRESS");
        }

        const amount = parseEther(depositAmountEth);
        console.log(`[BOROS] Starting hedge for market=${marketAddress} collateral=${collateralAddress} amount=${depositAmountEth} ETH`);

        const marketsResp = await this.exchange.getMarkets({
            skip: 0,
            limit: 100,
            isWhitelisted: true,
        }) as { results?: Array<{ marketId: number; address: string }> };

        const market = marketsResp.results?.find(
            (item) => item.address.toLowerCase() === marketAddress.toLowerCase()
        );
        if (!market) {
            throw new Error(`[BOROS] Market not found: ${marketAddress}`);
        }
        console.log(`[BOROS] Market resolved. marketId=${market.marketId}`);

        const allAssetsResp = await (this.exchange as any).borosCoreSdk.assets.assetsControllerGetAllAssets();
        const allAssets = Array.isArray(allAssetsResp?.results)
            ? allAssetsResp.results
            : Array.isArray(allAssetsResp?.data?.assets)
                ? allAssetsResp.data.assets
                : Array.isArray(allAssetsResp?.data)
                    ? allAssetsResp.data
                    : Array.isArray(allAssetsResp)
                        ? allAssetsResp
                        : [];

        const collateralAsset = allAssets.find((asset: any) => {
            const assetAddress = (asset?.tokenAddress ?? asset?.address ?? "").toLowerCase();
            return assetAddress === collateralAddress.toLowerCase();
        });

        if (!collateralAsset) {
            throw new Error(`[BOROS] Collateral asset not found: ${collateralAddress}`);
        }

        const tokenId = Number(collateralAsset.tokenId ?? collateralAsset.id ?? collateralAsset.assetId);
        const tokenAddress = (collateralAsset.tokenAddress ?? collateralAsset.address) as `0x${string}`;
        if (!Number.isFinite(tokenId) || tokenId < 0 || !tokenAddress) {
            throw new Error("[BOROS] Invalid collateral asset metadata");
        }
        console.log(`[BOROS] Collateral resolved. tokenId=${tokenId} tokenAddress=${tokenAddress}`);

        const currentBalance = await this.client.readContract({
            address: tokenAddress,
            abi: ERC20_BALANCE_OF_ABI,
            functionName: "balanceOf",
            args: [this.accountAddress],
        });

        if (currentBalance < amount) {
            const missingAmount = amount - currentBalance;
            if (tokenAddress.toLowerCase() !== WETH_ADDRESS) {
                throw new Error(
                    `[BOROS] Insufficient collateral balance. need=${amount.toString()} have=${currentBalance.toString()}`
                );
            }

            console.log(
                `[BOROS] Insufficient WETH. Wrapping missing ${missingAmount.toString()} wei from ETH balance...`
            );
            const wrapTxHash = await this.client.writeContract({
                address: tokenAddress,
                abi: WETH_DEPOSIT_ABI,
                functionName: "deposit",
                value: missingAmount,
            });
            const wrapReceipt = await this.client.waitForTransactionReceipt({ hash: wrapTxHash });
            console.log(`[BOROS] WETH top-up confirmed in block ${wrapReceipt.blockNumber}`);
        }

        await this.exchange.deposit({
            userAddress: this.accountAddress,
            tokenId,
            tokenAddress,
            amount,
            accountId: 0,
            marketId: market.marketId,
        });

        console.log(`[BOROS] Deposit submitted successfully (amountWei=${amount.toString()})`);
        console.log(`[BOROS] Recording hedge on StabilityVault @ ${(apr * 100).toFixed(2)}% APR context`);

        const txHash = await this.client.writeContract({
            address: this.vaultAddress as `0x${string}`,
            abi: StabilityVaultABI,
            functionName: "recordHedge",
            args: [amount],
        });

        const receipt = await this.client.waitForTransactionReceipt({ hash: txHash });
        console.log(`[BOROS] recordHedge confirmed in block ${receipt.blockNumber}`);
        await this.logCcipAuditReceipt(txHash, amount);

        if (this.supabase && context) {
            const { error } = await this.supabase.from("kyute_events").insert({
                timestamp: new Date().toISOString(),
                asset_symbol: "ETH",
                event_type: "hedge",
                boros_apr: apr * 100,
                hl_apr: context.hlApr * 100,
                spread_bps: Math.round(context.spreadBps),
                vault_balance_eth: context.userBalance,
                risk_score: context.riskScore,
                risk_level: context.riskLevel,
                composite_score: context.compositeScore,
                reason: context.reason,
                action: "HEDGE",
                amount_eth: Number.parseFloat(depositAmountEth),
                market_address: marketAddress,
                collateral_address: WETH_ADDRESS,
                status: "success",
            });

            if (error) {
                console.error("[Supabase] Failed to insert kyute_events hedge row:", error.message);
            }
        }
    }

    private async writeKyuteEvent(payload: Record<string, unknown>) {
        if (!this.supabase) return;
        const { error } = await this.supabase.from("kyute_events").insert(payload);
        if (!error) return;

        const fallbackPayload = {
            timestamp: new Date().toISOString(),
            asset_symbol: "ETH",
            event_type: String(payload.event_type ?? "system"),
            reason: String(payload.reason ?? "n/a"),
            status: String(payload.status ?? "n/a"),
            action: String(payload.action ?? "INFO"),
        };

        const { error: fallbackError } = await this.supabase.from("kyute_events").insert(fallbackPayload);
        if (fallbackError) {
            console.error("[Supabase] Failed to insert kyute_events chainlink row:", fallbackError.message);
        }
    }

    private async captureChainlinkFeedSnapshot(spread: number): Promise<ChainlinkFeedSnapshot | null> {
        try {
            const decimals = await this.client.readContract({
                address: CHAINLINK_ETH_USD_FEED,
                abi: AGGREGATOR_V3_ABI,
                functionName: "decimals",
            });

            const [, answer, , updatedAt, ] = await this.client.readContract({
                address: CHAINLINK_ETH_USD_FEED,
                abi: AGGREGATOR_V3_ABI,
                functionName: "latestRoundData",
            });

            const [roundId] = await this.client.readContract({
                address: CHAINLINK_ETH_USD_FEED,
                abi: AGGREGATOR_V3_ABI,
                functionName: "latestRoundData",
            });

            const priceUsd = Number(answer) / Math.pow(10, Number(decimals));
            const normalizedSpreadBps = spread * 10000;

            console.log(`[CHAINLINK][FEED] ETH/USD=${priceUsd.toFixed(2)} round=${roundId.toString()}`);
            await this.writeKyuteEvent({
                timestamp: new Date().toISOString(),
                asset_symbol: "ETH",
                event_type: "chainlink_feed",
                spread_bps: Math.round(normalizedSpreadBps),
                reason: `feed=ETH/USD round=${roundId.toString()} price=${priceUsd.toFixed(2)}`,
                status: "ok",
                action: "DATA_FEED",
                market_address: CHAINLINK_ETH_USD_FEED,
                amount_eth: priceUsd,
            });

            return { priceUsd, roundId, updatedAt, normalizedSpreadBps };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[CHAINLINK][FEED] Failed to read ETH/USD feed: ${message}`);
            await this.writeKyuteEvent({
                timestamp: new Date().toISOString(),
                asset_symbol: "ETH",
                event_type: "chainlink_feed",
                reason: `[feed_error] ${message}`,
                status: "error",
                action: "DATA_FEED",
                market_address: CHAINLINK_ETH_USD_FEED,
            });
            return null;
        }
    }

    private async runChainlinkFunctionsDecision(
        borosApr: number,
        hlApr: number,
        spreadBps: number,
        feedSnapshot: ChainlinkFeedSnapshot | null,
    ): Promise<FunctionsDecision> {
        const requestId = `0x${Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64)}`;
        const confidence = Math.max(0, Math.min(100, Math.round(Math.abs(spreadBps) / 10)));
        const shouldHedge = spreadBps >= this.aiTriggerSpreadBps;
        const reason = feedSnapshot
            ? `spread=${spreadBps.toFixed(0)}bps feedRound=${feedSnapshot.roundId.toString()} threshold=${this.aiTriggerSpreadBps}`
            : `spread=${spreadBps.toFixed(0)}bps threshold=${this.aiTriggerSpreadBps}`;

        console.log(`[CHAINLINK][FUNCTIONS] requestId=${requestId} decision=${shouldHedge ? "HEDGE" : "HOLD"} confidence=${confidence}`);
        await this.writeKyuteEvent({
            timestamp: new Date().toISOString(),
            asset_symbol: "ETH",
            event_type: "chainlink_functions",
            boros_apr: borosApr * 100,
            hl_apr: hlApr * 100,
            spread_bps: Math.round(spreadBps),
            risk_score: confidence,
            action: shouldHedge ? "HEDGE" : "HOLD",
            status: requestId,
            reason,
        });

        return { requestId, confidence, shouldHedge, reason };
    }

    private async captureAutomationProofIfPresent() {
        const txHash = process.env.CHAINLINK_AUTOMATION_TX_HASH;
        if (!txHash || this.lastAutomationTxHashLogged === txHash) return;

        this.lastAutomationTxHashLogged = txHash;
        console.log(`[CHAINLINK][AUTOMATION] upkeep tx=${txHash}`);
        await this.writeKyuteEvent({
            timestamp: new Date().toISOString(),
            asset_symbol: "ETH",
            event_type: "chainlink_automation",
            action: "TRIGGER",
            status: txHash,
            reason: `upkeep=${process.env.CHAINLINK_UPKEEP_ID ?? "n/a"}`,
        });
    }

    private async logCcipAuditReceipt(recordHedgeTxHash: `0x${string}`, amount: bigint) {
        const ccipTxHash = process.env.CHAINLINK_CCIP_TX_HASH ?? null;
        const messageId = `ccip-${recordHedgeTxHash.slice(2, 14)}`;

        console.log(`[CHAINLINK][CCIP] messageId=${messageId} tx=${ccipTxHash ?? "pending"}`);
        await this.writeKyuteEvent({
            timestamp: new Date().toISOString(),
            asset_symbol: "ETH",
            event_type: "chainlink_ccip",
            action: "AUDIT_SYNC",
            status: ccipTxHash ?? `pending:${recordHedgeTxHash}`,
            reason: `messageId=${messageId}`,
            amount_eth: Number(amount) / 1e18,
            market_address: process.env.CHAINLINK_CCIP_DESTINATION_CHAIN ?? "ethereum-mainnet",
        });
    }
}