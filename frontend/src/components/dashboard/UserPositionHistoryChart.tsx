"use client";

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { useElementSize } from "@/hooks/use-element-size";
import { cn } from "@/lib/utils";

type Point = {
  timestamp: number;
  totalOpen: number;
};

interface UserPositionHistoryChartProps {
  points: Point[];
  currentSizeEth?: number | null;
  lastUpdatedAt?: string | null;
  loading?: boolean;
  className?: string;
}

const formatTs = (ts: number) =>
  new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
    day: "numeric",
  });

export function UserPositionHistoryChart({
  points,
  currentSizeEth = null,
  lastUpdatedAt = null,
  loading = false,
  className,
}: UserPositionHistoryChartProps) {
  const { ref: chartRef, size } = useElementSize<HTMLDivElement>();
  const sizeLabel = loading ? "..." : `${Number(currentSizeEth ?? 0).toFixed(4)} ETH`;
  const updatedLabel = lastUpdatedAt ?? "--";
  const chartPoints =
    points.length === 1
      ? [
          {
            timestamp: points[0].timestamp - 30 * 60 * 1000,
            totalOpen: points[0].totalOpen,
          },
          points[0],
        ]
      : points;
  const hasOnlyOneSnapshot = points.length === 1;

  return (
    <div className={cn("w-full min-w-0 min-h-[360px] overflow-hidden border border-[#1a1a1a] bg-[linear-gradient(180deg,#0a0a0a,#080808)] rounded-sm p-4", className)}>
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div>
          <h3 className="text-xs font-mono tracking-widest uppercase text-[#666]">HL POSITION (ETH)</h3>
          <p className="text-sm font-semibold text-white mt-1">Open Position Amount (ETH)</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-mono text-white">Current: {sizeLabel}</p>
          <p className="text-[10px] font-mono text-[#666] mt-1">Last update: {updatedLabel}</p>
        </div>
      </div>

      {loading && points.length === 0 ? (
        <div className="flex h-[280px] items-center justify-center text-xs font-mono text-[#666]">Loading chart...</div>
      ) : points.length === 0 ? (
        <div className="flex h-[280px] items-center justify-center text-xs font-mono text-[#666]">
          No historical ETH orders found.
        </div>
      ) : (
        <div ref={chartRef} className="h-[280px] min-w-0 w-full overflow-hidden">
          {size.width > 0 && size.height > 0 ? (
            <AreaChart width={size.width} height={size.height} data={chartPoints} margin={{ top: 8, right: 8, bottom: 8, left: -20 }}>
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
              <YAxis tick={{ fill: "#666", fontSize: 10 }} stroke="#252525" width={44} />
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
                dot={
                  hasOnlyOneSnapshot
                    ? { r: 3, fill: "#00d084", stroke: "#d8fff0", strokeWidth: 1 }
                    : false
                }
              />
            </AreaChart>
          ) : null}
        </div>
      )}
      {hasOnlyOneSnapshot ? (
        <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[#4d576b]">
          Only one live HL snapshot available so far.
        </p>
      ) : null}
    </div>
  );
}
