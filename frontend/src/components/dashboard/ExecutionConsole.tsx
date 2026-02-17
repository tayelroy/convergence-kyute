
"use client";

import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "lucide-react";

const INITIAL_LOGS = [
    "[SYSTEM] kYUte Agent initialized v1.0.0",
    "[INFO] Connecting to Arbitrum Sepolia RPC...",
    "[SUCCESS] Wallet Connected: 0x71C...9A2",
    "[MONITOR] Savings Balance: 6,293.21 USD",
    "[AI] Querying Gemini Pro for BTC Volatility...",
    "[AI] Risk Score: 45/100 (Moderate)",
    "[GUARD] Yield is stable. No hedge required.",
    "[UPDATE] USDe APY: 15.4% | Boros Short Cost: 8.2%",
    "[HIBERNATE] Sleeping for 30s...",
];

export function ExecutionConsole() {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [logs, setLogs] = useState(INITIAL_LOGS);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        // Simulate live logs
        const interval = setInterval(() => {
            const newLog = Math.random() > 0.7
                ? `[MONITOR] Heartbeat: All Systems Normal`
                : Math.random() > 0.5
                    ? `[AI] Re-evaluating Market Sentiment...`
                    : null;

            if (newLog) {
                setLogs(prev => [...prev.slice(-19), newLog]);
            }
        }, 5000);
        return () => clearInterval(interval);
    }, []);

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    if (!mounted) return null;

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
                {logs.map((log, i) => (
                    <div key={i} className="opacity-80 hover:opacity-100 border-l-2 border-transparent hover:border-[#4bf3a6] pl-2 transition-all">
                        <span className="text-[#444] mr-2 text-[10px]">
                            {new Date().toLocaleTimeString([], { hour12: false })}
                        </span>
                        {log}
                    </div>
                ))}
                {/* Blinking cursor */}
                <div className="pl-2 animate-pulse text-[#00ff00]">_</div>
            </div>
        </div>
    );
}
