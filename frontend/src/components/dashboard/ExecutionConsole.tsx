
"use client";

import React, { useMemo, useRef, useEffect } from "react";
import { Terminal } from "lucide-react";
import type { AiDecision, HedgeEvent } from "@/hooks/useAgentStatus";

interface ExecutionConsoleProps {
    aiLogs: AiDecision[];
    hedges: HedgeEvent[];
    loading?: boolean;
}

export function ExecutionConsole({ aiLogs, hedges, loading = false }: ExecutionConsoleProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    const logs = useMemo(() => {
        const aiEntries = aiLogs.map((item) => ({
            timestamp: item.timestamp,
            message: `[AI] ${item.action} risk=${item.risk_score}/100 level=${item.risk_level} spread=${item.spread_bps}bps`,
        }));

        const hedgeEntries = hedges.map((item) => ({
            timestamp: item.timestamp,
            message: `[BOROS] ${item.status ?? "unknown"} amount=${Number(item.amount_eth ?? 0).toFixed(4)} ETH market=${item.market_address ?? "n/a"}`,
        }));

        return [...aiEntries, ...hedgeEntries]
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .slice(-25);
    }, [aiLogs, hedges]);

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div className="flex flex-col h-full bg-[#030303] border border-[#1a1a1a] rounded-sm font-mono text-xs overflow-hidden">
            <div className="flex items-center px-3 py-2 border-b border-[#1a1a1a] bg-[#0a0a0a]">
                <Terminal size={12} className="text-[#666] mr-2" />
                <span className="text-[#666] uppercase tracking-wider font-bold">Agent Activity Log</span>
            </div>

            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-3 space-y-1 text-[#4bf3a6]"
            >
                {loading && logs.length === 0 && (
                    <div className="opacity-80 pl-2 text-[#666]">Loading live events...</div>
                )}
                {!loading && logs.length === 0 && (
                    <div className="opacity-80 pl-2 text-[#666]">No events yet. Agent heartbeat will appear after first cycle.</div>
                )}
                {logs.map((log, i) => (
                    <div key={i} className="opacity-80 hover:opacity-100 border-l-2 border-transparent hover:border-[#4bf3a6] pl-2 transition-all">
                        <span className="text-[#444] mr-2 text-[10px]">
                            {new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}
                        </span>
                        {log.message}
                    </div>
                ))}
                {/* Blinking cursor */}
                <div className="pl-2 animate-pulse text-[#00ff00]">_</div>
            </div>
        </div>
    );
}
