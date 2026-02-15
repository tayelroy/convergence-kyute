"use client";

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell,
} from "recharts";
import { BarChart3 } from "lucide-react";
import type { VenueVolume } from "@/types/boros";

interface VolumeChartProps {
    data: VenueVolume[];
}

export function VolumeChart({ data }: VolumeChartProps) {
    return (
        <div className="rounded-xl border border-white/[0.06] bg-[#0c0c14] p-5">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-emerald-400" />
                    <h2 className="text-sm font-semibold text-white">
                        Venue Volume Distribution
                    </h2>
                </div>
                <span className="text-xs font-mono text-neutral-500">
                    ${(data.reduce((sum, d) => sum + d.volume, 0) / 1_000_000).toFixed(1)}M TOTAL
                </span>
            </div>

            <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data} barCategoryGap="30%">
                    <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(255,255,255,0.04)"
                        vertical={false}
                    />
                    <XAxis
                        dataKey="venue"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#525252", fontSize: 11, fontFamily: "var(--font-mono)" }}
                    />
                    <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#525252", fontSize: 11, fontFamily: "var(--font-mono)" }}
                        tickFormatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`}
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
                        formatter={(value: number | undefined) => [
                            `$${((value ?? 0) / 1_000).toFixed(0)}K`,
                            "Volume",
                        ]}
                    />
                    <Bar dataKey="volume" radius={[6, 6, 0, 0]}>
                        {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.8} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
