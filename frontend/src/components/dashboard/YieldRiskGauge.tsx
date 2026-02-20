
"use client";

import React from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import type { AiDecision, AgentSnapshot } from "@/hooks/useAgentStatus";

interface YieldRiskGaugeProps {
    latest: AgentSnapshot | null;
    aiLogs: AiDecision[];
    loading?: boolean;
}

export function YieldRiskGauge({ latest, aiLogs, loading = false }: YieldRiskGaugeProps) {
    const latestAi = aiLogs[0] ?? null;
    const fallbackRisk = latest ? Math.min(100, Math.max(0, Math.round(latest.spread_bps / 10))) : 0;
    const riskScore = latestAi?.risk_score ?? fallbackRisk;
    const gaugeValue = loading ? 0 : riskScore;

    const data = [
        { name: "Risk", value: gaugeValue },
        { name: "Safety", value: 100 - gaugeValue },
    ];

    const getColor = (score: number) => {
        if (score < 30) return "#00ff9d";
        if (score < 70) return "#fbbf24";
        return "#ef4444";
    };

    return (
        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-sm p-4 flex flex-col items-center justify-center">
            <div className="w-full flex justify-between items-center mb-2">
                <h3 className="text-xs text-[#666] font-mono tracking-wider">AI YIELD RISK</h3>
                <span className="text-[10px] text-[#444] font-mono">GEMINI 2.0 FLASH</span>
            </div>

            <div className="relative w-[120px] h-[120px]">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius={40}
                            outerRadius={55}
                            startAngle={180}
                            endAngle={0}
                            paddingAngle={5}
                            dataKey="value"
                        >
                            <Cell key="risk" fill={getColor(gaugeValue)} />
                            <Cell key="safety" fill="#1a1a1a" />
                        </Pie>
                    </PieChart>
                </ResponsiveContainer>
                <div className="absolute top-[60%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                    <span className="block text-2xl font-bold font-mono text-white">
                        {loading ? "--" : Math.round(gaugeValue)}
                    </span>
                    <span className="block text-[8px] text-[#666] uppercase">Volatility</span>
                </div>
            </div>

            <div className="mt-2 text-center">
                <p className="text-[10px] text-[#888]">
                    {loading
                        ? "Waiting for live AI signal"
                        : gaugeValue < 30
                            ? "Safe Zone"
                            : gaugeValue < 70
                                ? "Moderate Volatility"
                                : "Approaching Crash"}
                </p>
            </div>
        </div>
    );
}
