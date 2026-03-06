"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";

type HedgePoint = {
  timestamp: number;
  amountYu: number;
};

interface BorosHedgeChartProps {
  points: HedgePoint[];
  currentAmountYu?: number | null;
  hedgeSide?: string | null;
  lastUpdatedAt?: string | null;
  loading?: boolean;
  modeLabel?: string | null;
  className?: string;
}

const formatTs = (ts: number) =>
  new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
    day: "numeric",
  });

export function BorosHedgeChart({
  points,
  currentAmountYu = null,
  hedgeSide = null,
  lastUpdatedAt = null,
  loading = false,
  modeLabel = null,
  className,
}: BorosHedgeChartProps) {
  const hasHedge = Number(currentAmountYu ?? 0) > 0.0000001;
  const sizeLabel = loading ? "..." : hasHedge ? `${Number(currentAmountYu ?? 0).toFixed(4)} YU` : "No hedge";
  const updatedLabel = lastUpdatedAt ?? "--";

  return (
    <div className={cn("w-full min-w-0 h-full border border-[#1a1a1a] bg-[linear-gradient(180deg,#0a0a0a,#080808)] rounded-sm p-4 flex flex-col", className)}>
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div>
          <h3 className="text-xs font-mono tracking-widest uppercase text-[#666]">BOROS HEDGE (YU)</h3>
          <p className="text-sm font-semibold text-white mt-1">Vault Position (YU)</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-mono text-white">
            Current: {sizeLabel}
            {hasHedge && hedgeSide ? ` (${hedgeSide})` : ""}
          </p>
          <p className="text-[10px] font-mono text-[#666] mt-1">Last hedge: {updatedLabel}</p>
          {modeLabel && <p className="text-[10px] font-mono text-[#555] mt-1">{modeLabel}</p>}
        </div>
      </div>

      {loading && points.length === 0 ? (
        <div className="min-h-0 flex-1 flex items-center justify-center text-xs text-[#666] font-mono">Loading chart...</div>
      ) : points.length === 0 ? (
        <div className="min-h-0 flex-1 flex items-center justify-center text-xs text-[#666] font-mono">
          No hedge history yet.
        </div>
      ) : (
        <div className="min-h-0 flex-1 min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points}>
              <defs>
                <linearGradient id="borosHedgeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5ad8a6" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#5ad8a6" stopOpacity={0.05} />
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
                formatter={(value) => [`${Number(value).toFixed(4)} YU`, "Hedge size"]}
              />
              <Area
                type="monotone"
                dataKey="amountYu"
                stroke="#5ad8a6"
                strokeWidth={2}
                fill="url(#borosHedgeGradient)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
