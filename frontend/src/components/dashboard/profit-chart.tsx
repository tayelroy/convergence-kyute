"use client";

import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";
import { TrendingUp } from "lucide-react";
import type { ProfitDataPoint } from "@/types/boros";

interface ProfitChartProps {
    data: ProfitDataPoint[];
}

export function ProfitChart({ data }: ProfitChartProps) {
    return (
        <div className="rounded-xl border border-white/[0.06] bg-[#0c0c14] p-5">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-emerald-400" />
                    <h2 className="text-sm font-semibold text-white">
                        Realized Profit (Daily)
                    </h2>
                </div>
                <span className="text-xs font-mono text-emerald-400">
                    +${data[data.length - 1]?.cumulative.toFixed(2) ?? "0.00"}
                </span>
            </div>

            <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data}>
                    <defs>
                        <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#34d399" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(255,255,255,0.04)"
                        vertical={false}
                    />
                    <XAxis
                        dataKey="date"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#525252", fontSize: 11, fontFamily: "var(--font-mono)" }}
                    />
                    <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#525252", fontSize: 11, fontFamily: "var(--font-mono)" }}
                        tickFormatter={(v) => `$${v}`}
                    />
                    <Tooltip
                        contentStyle={{
                            background: "#141420",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: "10px",
                            fontFamily: "var(--font-mono)",
                            fontSize: "12px",
                            color: "#e5e5e5",
                        }}
                        formatter={(value: number | undefined) => [`$${(value ?? 0).toFixed(2)}`, "Profit"]}
                    />
                    <Area
                        type="monotone"
                        dataKey="cumulative"
                        stroke="#34d399"
                        strokeWidth={2}
                        fill="url(#profitGradient)"
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
