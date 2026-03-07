
"use client";

import React, { useMemo } from "react";
import { Terminal } from "lucide-react";
import type {
    AiDecision,
    HedgeEvent,
    ChainlinkAutomationEvent,
    ChainlinkFunctionsEvent,
    ChainlinkFeedEvent,
    ChainlinkCcipEvent,
} from "@/hooks/useAgentStatus";

interface ExecutionConsoleProps {
    aiLogs: AiDecision[];
    hedges: HedgeEvent[];
    chainlinkAutomation: ChainlinkAutomationEvent[];
    chainlinkFunctions: ChainlinkFunctionsEvent[];
    chainlinkFeed: ChainlinkFeedEvent[];
    chainlinkCcip: ChainlinkCcipEvent[];
    loading?: boolean;
}

const TX_PATTERN = /0x[a-fA-F0-9]{64}/;

const extractTxHash = (...candidates: Array<string | null | undefined>) => {
    for (const candidate of candidates) {
        if (!candidate) continue;
        const match = candidate.match(TX_PATTERN);
        if (match) return match[0];
    }
    return null;
};

export function ExecutionConsole({
    aiLogs,
    hedges,
    chainlinkAutomation,
    chainlinkFunctions,
    chainlinkFeed,
    chainlinkCcip,
    loading = false,
}: ExecutionConsoleProps) {
    const logs = useMemo(() => {
        const aiEntries = aiLogs.map((item) => ({
            timestamp: item.timestamp,
            action: `AI ${item.action ?? "DECISION"}`,
            amountEth: null as number | null,
            txHash: extractTxHash(item.reason),
            detail: item.reason ?? null,
        }));

        const hedgeEntries = hedges.map((item) => ({
            timestamp: item.timestamp,
            action: `BOROS ${String(item.status ?? "UNKNOWN").toUpperCase()}`,
            amountEth: Number(item.amount_eth ?? 0),
            txHash: extractTxHash(item.reason, item.market_address, item.status),
            detail: item.reason ?? null,
        }));

        const automationEntries = chainlinkAutomation.map((item) => ({
            timestamp: item.timestamp,
            action: `AUTOMATION ${item.action ?? "EXECUTE"}`,
            amountEth: null as number | null,
            txHash: extractTxHash(item.status, item.reason),
            detail: item.reason ?? null,
        }));

        const functionsEntries = chainlinkFunctions.map((item) => ({
            timestamp: item.timestamp,
            action: `FUNCTIONS ${item.action ?? "REQUEST"}`,
            amountEth: null as number | null,
            txHash: extractTxHash(item.reason, item.status),
            detail: item.reason ?? null,
        }));

        const feedEntries = chainlinkFeed.map((item) => ({
            timestamp: item.timestamp,
            action: "FEED UPDATE",
            amountEth: Number(item.amount_eth ?? 0),
            txHash: extractTxHash(item.reason, item.status),
            detail: item.reason ?? null,
        }));

        const ccipEntries = chainlinkCcip.map((item) => ({
            timestamp: item.timestamp,
            action: `CCIP ${item.action ?? "SYNC"}`,
            amountEth: Number(item.amount_eth ?? 0),
            txHash: extractTxHash(item.status, item.reason, item.market_address),
            detail: item.reason ?? null,
        }));

        return [...aiEntries, ...hedgeEntries, ...automationEntries, ...functionsEntries, ...feedEntries, ...ccipEntries]
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 40);
    }, [aiLogs, hedges, chainlinkAutomation, chainlinkFunctions, chainlinkFeed, chainlinkCcip]);

    return (
        <div className="flex flex-col h-full bg-[#030303] border border-[#1a1a1a] rounded-sm font-mono text-xs overflow-hidden">
            <div className="flex items-center px-3 py-2 border-b border-[#1a1a1a] bg-[#0a0a0a]">
                <Terminal size={12} className="text-[#666] mr-2" />
                <span className="text-[#666] uppercase tracking-wider font-bold">Agent Activity Log</span>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-1 text-[#4bf3a6]">
                {loading && logs.length === 0 && (
                    <div className="opacity-80 pl-2 text-[#666]">Loading live events...</div>
                )}
                {!loading && logs.length === 0 && (
                    <div className="opacity-80 pl-2 text-[#666]">No events yet. Agent heartbeat will appear after first cycle.</div>
                )}
                {logs.map((log, i) => (
                    <div key={i} className="border-l-2 border-transparent hover:border-[#4bf3a6] pl-2 py-1 opacity-90 hover:opacity-100 transition-all">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[#444] text-[10px]">
                                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}
                            </span>
                            <span className="text-[#4bf3a6]">{log.action}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-3 flex-wrap text-[10px] text-[#7adbb2]">
                            {log.amountEth != null && (
                                <span>amount={log.amountEth.toFixed(4)} {log.action.startsWith("BOROS") ? "YU" : "ETH"}</span>
                            )}
                            {log.txHash && (
                                <span className="text-[#666] truncate max-w-[280px]">tx={log.txHash}</span>
                            )}
                        </div>
                        {log.detail ? (
                            <div className="mt-1 text-[10px] text-[#8ba58f] break-words">{log.detail}</div>
                        ) : null}
                    </div>
                ))}
            </div>
        </div>
    );
}
