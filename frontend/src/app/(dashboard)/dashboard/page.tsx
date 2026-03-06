"use client";

import React, { useMemo, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { TickerTape } from "@/components/dashboard/TickerTape";
import { SavingsPortfolio } from "@/components/dashboard/SavingsPortfolio";
import { YieldRiskGauge } from "@/components/dashboard/YieldRiskGauge";
import { ExecutionConsole } from "@/components/dashboard/ExecutionConsole";
import { UserPositionHistoryChart } from "@/components/dashboard/UserPositionHistoryChart";
import { BorosHedgeChart } from "@/components/dashboard/BorosHedgeChart";
import { useAgentStatus } from "@/hooks/useAgentStatus";
import { useBorosMockHedge } from "@/hooks/useBorosMockHedge";
import { useHyperliquidDashboard } from "@/hooks/use-hyperliquid-dashboard";
import { getCachedWalletAddress } from "@/lib/hl-wallet-cache";

export default function DashboardPage() {
    const account = useActiveAccount();
    const {
        latest,
        hedges,
        aiLogs,
        chainlinkAutomation,
        chainlinkFunctions,
        chainlinkFeed,
        chainlinkCcip,
        loading,
        error,
        degraded,
        warnings,
        lastUpdated,
    } = useAgentStatus();
    const live = useHyperliquidDashboard();
    const isForcedExecutionMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
    const borosWallet = useMemo(
        () => account?.address ?? getCachedWalletAddress() ?? undefined,
        [account?.address],
    );
    const liveBoros = useBorosMockHedge(isForcedExecutionMode ? borosWallet : undefined);
    const borosAprDisplay =
        live.borosImpliedApr != null ? `${live.borosImpliedApr.toFixed(2)}%` : loading ? "..." : latest ? `${latest.boros_apr.toFixed(2)}%` : "--";
    const hlAprDisplay = live.hlFundingApr != null ? `${live.hlFundingApr.toFixed(2)}%` : latest ? `${latest.hl_apr.toFixed(2)}%` : "--";
    const latestHedge = hedges[0] ?? null;
    const liveRunningHedgeEth = Number(latestHedge?.running_size_eth ?? 0);
    const positionLastPoint = live.historyPoints[live.historyPoints.length - 1] ?? null;
    const hlPositionLastUpdated = live.positionLastUpdate ?? positionLastPoint?.timestamp ?? null;

    const fallbackLiveHedgeAmountYu = Number.isFinite(liveRunningHedgeEth)
        ? liveRunningHedgeEth
        : Number(latestHedge?.amount_eth ?? 0);
    const derivedHedgeAmountYu = Number.isFinite(fallbackLiveHedgeAmountYu) ? Math.max(0, fallbackLiveHedgeAmountYu) : 0;
    const hedgeAmountYu =
        isForcedExecutionMode && liveBoros.enabled
            ? Math.max(0, Number(liveBoros.amountYu ?? 0))
            : derivedHedgeAmountYu;
    const hasHedge = hedgeAmountYu > 0.0000001;
    const hedgeSide = hasHedge
        ? isForcedExecutionMode && liveBoros.enabled
            ? liveBoros.isLong
                ? "LONG"
                : "SHORT"
            : (latestHedge?.hedge_side ?? null)
        : null;
    const hedgeLastTimestamp =
        isForcedExecutionMode && liveBoros.enabled
            ? lastUpdated
            : (latestHedge?.timestamp ?? null);
    const [zeroSeriesSeed] = useState(() => Date.now());
    const hedgeHistoryPoints = useMemo(() => {
        const sorted = [...hedges].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        const points: Array<{ timestamp: number; amountYu: number }> = [];
        for (const h of sorted) {
            if (String(h.status ?? "").toLowerCase() !== "success") continue;
            const ts = new Date(h.timestamp).getTime();
            if (!Number.isFinite(ts)) continue;
            const running = Number(h.running_size_eth);
            if (Number.isFinite(running)) {
                points.push({ timestamp: ts, amountYu: Math.max(0, running) });
                continue;
            }
            const amt = Number(h.amount_eth ?? 0);
            points.push({ timestamp: ts, amountYu: Number.isFinite(amt) ? Math.max(0, amt) : 0 });
        }

        if (isForcedExecutionMode && liveBoros.enabled) {
            const currentAmountYu = Math.max(0, Number(liveBoros.amountYu ?? 0));
            const currentPointTs = hedgeLastTimestamp
                ? new Date(hedgeLastTimestamp).getTime()
                : zeroSeriesSeed;
            const lastPoint = points[points.length - 1] ?? null;
            if (!lastPoint || Math.abs(lastPoint.amountYu - currentAmountYu) > 0.0000001) {
                points.push({ timestamp: currentPointTs, amountYu: currentAmountYu });
            }
        }

        if (points.length > 0) return points;
        return [
            { timestamp: zeroSeriesSeed - 30 * 60 * 1000, amountYu: 0 },
            { timestamp: zeroSeriesSeed, amountYu: 0 },
        ];
    }, [hedges, hedgeLastTimestamp, isForcedExecutionMode, liveBoros.amountYu, liveBoros.enabled, zeroSeriesSeed]);
    const spreadBps = live.hlSpreadBps ?? latest?.spread_bps ?? null;
    const yieldAlert = spreadBps != null
        ? `Spread is ${spreadBps.toFixed(1)} bps (HL ${hlAprDisplay} vs Boros ${borosAprDisplay}); ${hasHedge ? `hedge is active${hedgeSide ? ` (${hedgeSide})` : ""}.` : "no hedge is open."}`
        : "Spread and hedge decision will appear after the first live cycle.";
    const syncLabel = lastUpdated
        ? new Date(lastUpdated).toLocaleTimeString([], { hour12: false })
        : null;
    const alertTitle = hasHedge ? "HEDGE INTERVENTION REQUIRED" : "MONITORING SPREAD";

    return (
        <DashboardLayout className="min-h-full">
            <TickerTape
                borosRate={live.borosImpliedApr ?? latest?.boros_apr}
                hyperliquidRate={live.hlFundingApr}
                spreadBps={live.hlSpreadBps ?? latest?.spread_bps}
                lastSyncLabel={syncLabel}
                degraded={degraded}
            />

            <main className="p-3 md:p-4">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
                    <div className="min-h-0 border border-[#1a1a1a] bg-[linear-gradient(180deg,#090b0f,#07090c)] rounded-sm p-4 lg:col-span-6">
                        <h3 className="text-xs font-mono tracking-widest uppercase text-[#666]">YIELD ALERT</h3>
                        <div className="mt-3 rounded-sm border border-[#7a3d15] bg-[#2a1708] px-4 py-3">
                            <p className="text-sm font-bold font-mono uppercase tracking-wide text-orange-400">{alertTitle}</p>
                            <p className="text-sm mt-3 leading-relaxed text-[#e0c3a4]">{yieldAlert}</p>
                            {(error || degraded || !latest) && !loading && (
                                <p className="text-[11px] mt-3 text-yellow-300/80 font-mono">
                                    {error
                                        ? `Data status: ${error}`
                                        : !latest
                                            ? "Data status: awaiting first live snapshot."
                                            : "Data status: degraded telemetry mode."}
                                </p>
                            )}
                            {warnings.length > 0 && (
                                <p className="text-[10px] mt-2 text-yellow-200/60 font-mono truncate">
                                    {warnings[0]}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="min-h-[180px] border border-[#1a1a1a] bg-[linear-gradient(180deg,#090b0f,#07090c)] rounded-sm p-4 lg:col-span-3">
                        <h3 className="text-xs font-mono tracking-widest uppercase text-[#666]">BOROS FUNDING</h3>
                        <div className="mt-6 text-center">
                            <p className="text-[10px] text-[#666] font-mono uppercase">IMPLIED APR</p>
                            <p className="mt-2 text-4xl leading-none font-mono text-emerald-400">{borosAprDisplay}</p>
                            <p className="mt-2 text-[10px] text-[#5e6575] font-mono italic">Last 24h Avg</p>
                        </div>
                    </div>

                    <div className="min-h-[180px] border border-[#1a1a1a] bg-[linear-gradient(180deg,#090b0f,#07090c)] rounded-sm p-4 lg:col-span-3">
                        <h3 className="text-xs font-mono tracking-widest uppercase text-[#666]">HL FUNDING</h3>
                        <div className="mt-6 text-center">
                            <p className="text-[10px] text-[#666] font-mono uppercase">LIVE RATE</p>
                            <p className="mt-2 text-4xl leading-none font-mono text-[#53a2ff]">{hlAprDisplay}</p>
                            <p className="mt-2 text-[10px] text-[#5e6575] font-mono italic">Next Epoch</p>
                        </div>
                    </div>

                    <div className="min-h-0 min-w-0 lg:col-span-6">
                        <UserPositionHistoryChart
                            points={live.historyPoints}
                            currentSizeEth={live.totalOpenNow}
                            lastUpdatedAt={hlPositionLastUpdated ? new Date(hlPositionLastUpdated).toLocaleString() : null}
                            loading={live.loading}
                        />
                    </div>

                    <div className="min-h-0 min-w-0 lg:col-span-6">
                        <BorosHedgeChart
                            points={hedgeHistoryPoints}
                            currentAmountYu={hedgeAmountYu}
                            hedgeSide={hasHedge ? hedgeSide : null}
                            lastUpdatedAt={hedgeLastTimestamp ? new Date(hedgeLastTimestamp).toLocaleString() : null}
                            loading={loading}
                            modeLabel={isForcedExecutionMode ? "Forced execution mode" : null}
                        />
                    </div>

                    <div className="min-h-[300px] lg:col-span-3">
                        <SavingsPortfolio latest={latest} hedges={hedges} loading={loading} title="SAVINGS PORTFOLIO" />
                    </div>

                    <div className="min-h-[300px] lg:col-span-6">
                        <ExecutionConsole
                            aiLogs={aiLogs}
                            hedges={hedges}
                            chainlinkAutomation={chainlinkAutomation}
                            chainlinkFunctions={chainlinkFunctions}
                            chainlinkFeed={chainlinkFeed}
                            chainlinkCcip={chainlinkCcip}
                            loading={loading}
                        />
                    </div>

                    <div className="min-h-[300px] min-w-0 lg:col-span-3">
                        <YieldRiskGauge
                            latest={latest}
                            aiLogs={aiLogs}
                            loading={loading}
                            title="VOLATILITY INDEX"
                            sourceLabel={null}
                        />
                    </div>
                </div>
            </main>
        </DashboardLayout>
    );
}
