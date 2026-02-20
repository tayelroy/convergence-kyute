"use client";

import { History, ExternalLink, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useMemo } from "react";
import { useAgentStatus } from "@/hooks/useAgentStatus";

const statusConfig = {
    executed: {
        icon: CheckCircle2,
        color: "text-emerald-400",
        bg: "bg-emerald-500/10 border-emerald-500/20",
    },
    skipped: {
        icon: XCircle,
        color: "text-neutral-500",
        bg: "bg-white/[0.03] border-white/[0.06]",
    },
    pending: {
        icon: Clock,
        color: "text-yellow-400",
        bg: "bg-yellow-500/10 border-yellow-500/20",
    },
};

export default function HistoryPage() {
    const { aiLogs, hedges, loading, error, degraded, warnings } = useAgentStatus();

    const rows = useMemo(() => {
        const aiRows = aiLogs.map((log, index) => ({
            id: `ai-${index}-${log.timestamp}`,
            asset: log.asset_symbol,
            action: log.action,
            spreadBps: log.spread_bps,
            notional: 0,
            profit: 0,
            status: log.action === "HEDGE" ? "executed" as const : "skipped" as const,
            timestamp: log.timestamp,
            txHash: null as string | null,
        }));

        const hedgeRows = hedges.map((hedge, index) => ({
            id: `hedge-${index}-${hedge.timestamp}`,
            asset: hedge.asset_symbol,
            action: "EXECUTE",
            spreadBps: hedge.spread_bps,
            notional: Number(hedge.amount_eth ?? 0),
            profit: 0,
            status: hedge.status === "success" ? "executed" as const : "pending" as const,
            timestamp: hedge.timestamp,
            txHash: hedge.market_address ?? null,
        }));

        return [...aiRows, ...hedgeRows]
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 20);
    }, [aiLogs, hedges]);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-white">Trade History</h1>
                <p className="text-sm text-neutral-500 mt-1">
                    View past arbitrage scans and executed trades.
                </p>
            </div>

            {(error || degraded) && !loading && (
                <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 text-sm text-yellow-200">
                    {error ? `Data status: ${error}` : "Data status: degraded telemetry mode."}
                    {warnings.length > 0 && (
                        <p className="text-xs text-yellow-200/70 mt-2 font-mono">{warnings[0]}</p>
                    )}
                </div>
            )}

            <div className="rounded-xl border border-white/[0.06] bg-[#0c0c14] overflow-hidden">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-white/[0.04]">
                            {["Time", "Asset", "Action", "Spread", "Notional", "Profit", "Status", "Tx"].map(
                                (col) => (
                                    <th
                                        key={col}
                                        className="px-5 py-3 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-neutral-500"
                                    >
                                        {col}
                                    </th>
                                )
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {!loading && rows.length === 0 && (
                            <tr>
                                <td colSpan={8} className="px-5 py-6 text-center text-sm text-neutral-500">
                                    No live history events yet.
                                </td>
                            </tr>
                        )}
                        {rows.map((row) => {
                            const status = statusConfig[row.status];
                            const StatusIcon = status.icon;
                            return (
                                <tr
                                    key={row.id}
                                    className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                                >
                                    <td className="px-5 py-3.5 text-xs font-mono text-neutral-400">
                                        {new Date(row.timestamp).toLocaleString()}
                                    </td>
                                    <td className="px-5 py-3.5 text-sm font-semibold text-white">
                                        {row.asset}
                                    </td>
                                    <td className="px-5 py-3.5">
                                        <span
                                            className={`text-[10px] font-mono font-semibold px-2 py-1 rounded border ${status.bg} ${status.color}`}
                                        >
                                            {row.action}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3.5 text-sm font-mono text-yellow-400">
                                        {row.spreadBps} bps
                                    </td>
                                    <td className="px-5 py-3.5 text-sm font-mono text-neutral-300">
                                        {row.notional > 0
                                            ? `${row.notional.toFixed(4)} ETH`
                                            : "—"}
                                    </td>
                                    <td className="px-5 py-3.5 text-sm font-mono text-emerald-400">
                                        {row.profit > 0 ? `+$${row.profit.toFixed(2)}` : "—"}
                                    </td>
                                    <td className="px-5 py-3.5">
                                        <div className="flex items-center gap-1.5">
                                            <StatusIcon className={`h-3.5 w-3.5 ${status.color}`} />
                                            <span
                                                className={`text-xs font-mono capitalize ${status.color}`}
                                            >
                                                {row.status}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3.5">
                                        {row.txHash ? (
                                            <a
                                                href="#"
                                                className="flex items-center gap-1 text-xs font-mono text-neutral-500 hover:text-neutral-300 transition-colors"
                                            >
                                                {row.txHash}
                                                <ExternalLink className="h-3 w-3" />
                                            </a>
                                        ) : (
                                            <span className="text-xs font-mono text-neutral-600">
                                                —
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
