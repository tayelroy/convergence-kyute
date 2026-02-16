"use client";

import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "lucide-react";

const INITIAL_LOGS = [
    "[SYSTEM] CRE Workflow initialized v1.0.2",
    "[INFO] Connecting to Arbitrum Sepolia RPC...",
    "[SUCCESS] Connected to network. Block: 18274921",
    "[WORKER] Fetching funding rates...",
    "[DEBUG] Binance BTC: -0.0033%",
    "[DEBUG] Hyperliquid BTC: 0.0050%",
    "[CONSENSUS] BTC Median Rate: 0.84% APR",
    "[BOROS] Fixed Rate: 0.50% APR",
    "[OPPORTUNITY] Spread +34bps > Threshold. Preparing swap...",
];

export function ExecutionConsole() {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [logs] = useState(INITIAL_LOGS);
    const [mounted, setMounted] = useState(false);
    const [timeStr, setTimeStr] = useState("");

    useEffect(() => {
        setMounted(true);
        setTimeStr(new Date().toLocaleTimeString([], { hour12: false }));
    }, []);

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    if (!mounted) return null; // or a skeleton

    return (
        <div className="flex flex-col h-full bg-[#030303] border border-[#1a1a1a] font-mono text-xs">
            <div className="flex items-center px-3 py-2 border-b border-[#1a1a1a] bg-[#0a0a0a]">
                <Terminal size={12} className="text-[#666] mr-2" />
                <span className="text-[#666] uppercase tracking-wider font-bold">Execution Logs</span>
            </div>

            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-3 space-y-1 text-[#4bf3a6]"
            >
                {logs.map((log, i) => (
                    <div key={i} className="opacity-80 hover:opacity-100">
                        <span className="text-[#333] mr-2">
                            {timeStr}
                        </span>
                        {log}
                    </div>
                ))}
                {/* Blinking cursor */}
                <div className="animate-pulse text-[#00ff00]">_</div>
            </div>
        </div>
    );
}
