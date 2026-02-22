
"use client";

import React from "react";
import type {
    AiDecision,
    AgentSnapshot,
    HedgeEvent,
    ChainlinkAutomationEvent,
    ChainlinkFunctionsEvent,
    ChainlinkFeedEvent,
    ChainlinkCcipEvent,
} from "@/hooks/useAgentStatus";

interface GuardianControlsProps {
    latest: AgentSnapshot | null;
    aiLogs: AiDecision[];
    hedges: HedgeEvent[];
    chainlinkAutomation: ChainlinkAutomationEvent[];
    chainlinkFunctions: ChainlinkFunctionsEvent[];
    chainlinkFeed: ChainlinkFeedEvent[];
    chainlinkCcip: ChainlinkCcipEvent[];
    loading?: boolean;
}

export function GuardianControls({
    latest,
    aiLogs,
    hedges,
    chainlinkAutomation,
    chainlinkFunctions,
    chainlinkFeed,
    chainlinkCcip,
    loading = false,
}: GuardianControlsProps) {
    const aiTriggerBps = Number(process.env.NEXT_PUBLIC_AI_TRIGGER_BPS ?? "800");
    const hedgeThreshold = Number(process.env.NEXT_PUBLIC_HEDGE_COMPOSITE_THRESHOLD ?? "100");
    const latestAi = aiLogs[0] ?? null;
    const latestHedge = hedges[0] ?? null;
    const latestAutomation = chainlinkAutomation[0] ?? null;
    const latestFunctions = chainlinkFunctions[0] ?? null;
    const latestFeed = chainlinkFeed[0] ?? null;
    const latestCcip = chainlinkCcip[0] ?? null;

    const isActive = !loading && !!latest;
    const statusText = loading ? "STARTING" : isActive ? "ACTIVE" : "WAITING";

    return (
        <div className={`p-4 rounded-sm border transition-all duration-300 ${isActive ? "border-[#00ff9d] bg-[#00ff9d]/5" : "border-[#333] bg-[#0a0a0a]"}`}>
            <div className="flex justify-between items-center">
                <div>
                    <h3 className="text-white font-bold text-sm tracking-wider">AUTO-GUARD</h3>
                    <p className="text-[10px] text-[#666] font-mono mt-1">Autonomous Hedging Agent</p>
                </div>
                <span className={`text-[10px] font-mono px-2 py-1 rounded-sm border ${isActive ? "text-[#00ff9d] border-[#00ff9d]/30" : "text-[#888] border-[#333]"}`}>
                    {statusText}
                </span>
            </div>

            <div className="mt-4 border-t border-[#222] pt-3">
                <div className="flex justify-between text-[10px] font-mono text-[#888]">
                    <span>AI Trigger</span>
                    <span className="text-white">{aiTriggerBps} BPS</span>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-[#888] mt-1">
                    <span>Hedge Score Threshold</span>
                    <span className="text-white">{hedgeThreshold}</span>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-[#888] mt-1">
                    <span>Latest AI Decision</span>
                    <span className="text-white">{latestAi ? `${latestAi.action} (${latestAi.risk_score})` : "N/A"}</span>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-[#888] mt-1">
                    <span>Latest Hedge</span>
                    <span className="text-white">{latestHedge ? `${Number(latestHedge.amount_eth ?? 0).toFixed(4)} ETH` : "N/A"}</span>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-[#888] mt-1">
                    <span>Automation Tx</span>
                    <span className="text-white truncate max-w-[160px]">{latestAutomation?.status ?? "N/A"}</span>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-[#888] mt-1">
                    <span>Functions Req</span>
                    <span className="text-white truncate max-w-[160px]">{latestFunctions?.status ?? "N/A"}</span>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-[#888] mt-1">
                    <span>Feed Round</span>
                    <span className="text-white">{latestFeed?.feed_round ?? "N/A"}</span>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-[#888] mt-1">
                    <span>CCIP Tx</span>
                    <span className="text-white truncate max-w-[160px]">{latestCcip?.status ?? "N/A"}</span>
                </div>
            </div>

            {isActive && (
                <div className="mt-3 flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00ff9d] opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00ff9d]"></span>
                    </span>
                    <span className="text-[10px] text-[#00ff9d] font-mono">
                        MONITORING {latest ? `${latest.asset_symbol} SPREAD=${latest.spread_bps} BPS` : "LIVE FEED"}
                    </span>
                </div>
            )}
        </div>
    );
}
