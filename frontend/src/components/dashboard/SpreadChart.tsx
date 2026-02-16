"use client";

import React from "react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

const DATA = [
    { time: "00:00", spread: 45 },
    { time: "04:00", spread: 55 },
    { time: "08:00", spread: 35 },
    { time: "12:00", spread: 70 },
    { time: "16:00", spread: 92 },
    { time: "20:00", spread: 65 },
    { time: "24:00", spread: 97 },
];

export function SpreadChart() {
    return (
        <div className="w-full h-40 bg-[#080808] border border-[#1a1a1a] p-4 relative">
            <h3 className="text-xs text-[#666] uppercase mb-2 absolute top-2 left-4 z-10">BTC Spread Trend (24h)</h3>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={DATA}>
                    <XAxis
                        dataKey="time"
                        tick={{ fill: "#333", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStartEnd"
                    />
                    <YAxis hide domain={['dataMin - 10', 'dataMax + 10']} />
                    <Tooltip
                        contentStyle={{ backgroundColor: "#000", border: "1px solid #333", color: "#fff" }}
                        itemStyle={{ color: "#00ff00" }}
                    />
                    <Line
                        type="monotone"
                        dataKey="spread"
                        stroke="#00ff00"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, fill: "#00ff00" }}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
