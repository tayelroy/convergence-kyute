"use client";

import { History, ExternalLink, CheckCircle2, XCircle, Clock } from "lucide-react";

const mockHistory = [
    {
        id: "1",
        asset: "BTC",
        action: "EXECUTE",
        spreadBps: 650,
        notional: 1_000_000,
        profit: 342.5,
        status: "executed" as const,
        timestamp: "2026-02-16 00:45:12",
        txHash: "0xabc123...def456",
    },
    {
        id: "2",
        asset: "ETH",
        action: "SKIP",
        spreadBps: 140,
        notional: 0,
        profit: 0,
        status: "skipped" as const,
        timestamp: "2026-02-16 00:40:08",
        txHash: null,
    },
    {
        id: "3",
        asset: "SOL",
        action: "EXECUTE",
        spreadBps: 830,
        notional: 750_000,
        profit: 186.2,
        status: "executed" as const,
        timestamp: "2026-02-16 00:35:44",
        txHash: "0x789ghi...jkl012",
    },
    {
        id: "4",
        asset: "DOGE",
        action: "EXECUTE",
        spreadBps: 1260,
        notional: 500_000,
        profit: 98.7,
        status: "pending" as const,
        timestamp: "2026-02-16 00:30:21",
        txHash: "0xmno345...pqr678",
    },
];

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
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-white">Trade History</h1>
                <p className="text-sm text-neutral-500 mt-1">
                    View past arbitrage scans and executed trades.
                </p>
            </div>

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
                        {mockHistory.map((row) => {
                            const status = statusConfig[row.status];
                            const StatusIcon = status.icon;
                            return (
                                <tr
                                    key={row.id}
                                    className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                                >
                                    <td className="px-5 py-3.5 text-xs font-mono text-neutral-400">
                                        {row.timestamp}
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
                                            ? `$${(row.notional / 1_000).toFixed(0)}K`
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
