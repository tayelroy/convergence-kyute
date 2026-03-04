"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = {
  timestamp: number;
  totalOpen: number;
};

interface UserPositionHistoryChartProps {
  points: Point[];
  loading?: boolean;
}

const formatTs = (ts: number) =>
  new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
    day: "numeric",
  });

export function UserPositionHistoryChart({ points, loading = false }: UserPositionHistoryChartProps) {
  return (
    <div className="w-full min-w-0 h-[320px] border border-[#1a1a1a] bg-[linear-gradient(180deg,#0a0a0a,#080808)] rounded-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Open Position Amount (ETH)</h3>
        <span className="text-[10px] text-[#666] uppercase tracking-wider">Your positions on Hyperliquid</span>
      </div>

      {loading && points.length === 0 ? (
        <div className="h-[260px] flex items-center justify-center text-xs text-[#666] font-mono">Loading chart...</div>
      ) : points.length === 0 ? (
        <div className="h-[260px] flex items-center justify-center text-xs text-[#666] font-mono">
          No historical ETH orders found.
        </div>
      ) : (
        <div className="h-[260px] min-h-[260px] min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={260}>
            <AreaChart data={points}>
              <defs>
                <linearGradient id="openPosGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00d084" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#00d084" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1c1c1c" strokeDasharray="2 4" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTs}
                tick={{ fill: "#666", fontSize: 10 }}
                stroke="#252525"
                minTickGap={30}
              />
              <YAxis tick={{ fill: "#666", fontSize: 10 }} stroke="#252525" width={50} />
              <Tooltip
                contentStyle={{ background: "#090909", border: "1px solid #2a2a2a", color: "#fff" }}
                labelFormatter={(value) => formatTs(Number(value))}
                formatter={(value) => [`${Number(value).toFixed(4)} ETH`, "Open"]}
              />
              <Area
                type="monotone"
                dataKey="totalOpen"
                stroke="#00d084"
                strokeWidth={2}
                fill="url(#openPosGradient)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
