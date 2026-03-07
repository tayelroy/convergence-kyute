"use client";

import React, { useMemo, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import type { HedgeEvent } from "@/hooks/useAgentStatus";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { TickerTape } from "@/components/dashboard/TickerTape";
import { SavingsPortfolio } from "@/components/dashboard/SavingsPortfolio";
import { ExecutionConsole } from "@/components/dashboard/ExecutionConsole";
import { BorosHedgeChart } from "@/components/dashboard/BorosHedgeChart";
import { useAgentStatus } from "@/hooks/useAgentStatus";
import { useHyperliquidDashboard } from "@/hooks/use-hyperliquid-dashboard";
import { useKyuteVaultState } from "@/hooks/use-kyute-vault-state";
import { getCachedWalletAddress } from "@/lib/hl-wallet-cache";
import { DEFAULT_MARKET_YU_TOKENS } from "@/lib/kyute-vault";

const canonicalWalletFromEnv = (() => {
  const raw = String(process.env.NEXT_PUBLIC_CANONICAL_HL_WALLET ?? "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw.toLowerCase() : null;
})();

const MARKET_CONFIGS = [
  {
    coin: "ETH",
    pair: "ETHUSDC",
    title: "ETH / USDC",
    yuToken: DEFAULT_MARKET_YU_TOKENS.ETH,
    borosMarketId: 41,
    borosMarketAddress: String(process.env.NEXT_PUBLIC_BOROS_MARKET_ADDRESS ?? "").trim().toLowerCase() || null,
  },
  {
    coin: "BTC",
    pair: "BTCUSDC",
    title: "BTC / USDC",
    yuToken: DEFAULT_MARKET_YU_TOKENS.BTC,
    borosMarketId: 61,
    borosMarketAddress: String(process.env.NEXT_PUBLIC_BOROS_BTC_MARKET_ADDRESS ?? "").trim().toLowerCase() || null,
  },
] as const;

type MarketViewModel = {
  coin: string;
  title: string;
  live: ReturnType<typeof useHyperliquidDashboard>;
  liveVault: ReturnType<typeof useKyuteVaultState>;
  marketHedges: HedgeEvent[];
  hedgeHistoryPoints: Array<{ timestamp: number; amountYu: number }>;
  hedgeAmountYu: number;
  hasHedge: boolean;
  hedgeSide: "LONG" | "SHORT" | null;
  hedgeLastTimestamp: string | null;
  hlPositionLastUpdated: number | null;
  ratesSourceLabel: string | null;
  borosAprDisplay: string;
  hlAprDisplay: string;
  spreadBps: number | null;
  yieldAlert: string;
  alertTitle: string;
  hedgeDebugLabel: string | null;
  hedgeDebugDetails: string | null;
};

const normalizeAssetSymbol = (value: string | null | undefined) => String(value ?? "").trim().toUpperCase();

const buildHedgeHistoryPoints = (
  hedges: HedgeEvent[],
  currentAmountYu: number,
  configured: boolean,
  hedgeLastTimestamp: string | null,
  zeroSeriesSeed: number,
) => {
  const sorted = [...hedges].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const points: Array<{ timestamp: number; amountYu: number }> = [];

  for (const hedge of sorted) {
    if (String(hedge.status ?? "").toLowerCase() !== "success") continue;
    const ts = new Date(hedge.timestamp).getTime();
    if (!Number.isFinite(ts)) continue;
    const running = Number(hedge.running_size_eth);
    if (Number.isFinite(running)) {
      points.push({ timestamp: ts, amountYu: Math.max(0, running) });
      continue;
    }
    const amount = Number(hedge.amount_eth ?? 0);
    points.push({ timestamp: ts, amountYu: Number.isFinite(amount) ? Math.max(0, amount) : 0 });
  }

  if (configured) {
    const currentPointTs = hedgeLastTimestamp ? new Date(hedgeLastTimestamp).getTime() : zeroSeriesSeed;
    const lastPoint = points[points.length - 1] ?? null;
    if (points.length === 0 && currentAmountYu > 0.0000001) {
      points.push({ timestamp: currentPointTs - 30 * 60 * 1000, amountYu: 0 });
    }
    if (!lastPoint || Math.abs(lastPoint.amountYu - currentAmountYu) > 0.0000001) {
      points.push({ timestamp: currentPointTs, amountYu: currentAmountYu });
    }
  }

  if (points.length > 0) return points;
  return [
    { timestamp: zeroSeriesSeed - 30 * 60 * 1000, amountYu: 0 },
    { timestamp: zeroSeriesSeed, amountYu: 0 },
  ];
};

export default function DashboardPage() {
  const account = useActiveAccount();
  const {
    hedges,
    aiLogs,
    chainlinkAutomation,
        chainlinkFunctions,
        chainlinkFeed,
        chainlinkCcip,
        creLogLines,
        loading,
        error,
        degraded,
    warnings,
    lastUpdated,
  } = useAgentStatus();

  const borosWallet = useMemo(() => {
    if (canonicalWalletFromEnv) return canonicalWalletFromEnv;
    return account?.address ?? getCachedWalletAddress() ?? undefined;
  }, [account?.address]);

  const ethLive = useHyperliquidDashboard({
    coin: "ETH",
    pair: "ETHUSDC",
    borosMarketId: MARKET_CONFIGS[0].borosMarketId,
    borosMarketAddress: MARKET_CONFIGS[0].borosMarketAddress,
    walletAddress: borosWallet,
  });
  const btcLive = useHyperliquidDashboard({
    coin: "BTC",
    pair: "BTCUSDC",
    borosMarketId: MARKET_CONFIGS[1].borosMarketId,
    borosMarketAddress: MARKET_CONFIGS[1].borosMarketAddress,
    walletAddress: borosWallet,
  });

  const ethVault = useKyuteVaultState(borosWallet, DEFAULT_MARKET_YU_TOKENS.ETH);
  const btcVault = useKyuteVaultState(borosWallet, DEFAULT_MARKET_YU_TOKENS.BTC);
  const sharedVaultState = ethVault.configured ? ethVault : btcVault;
  const [zeroSeriesSeed] = useState(() => Date.now());

  const hedgesByAsset = useMemo(() => {
    const grouped = new Map<string, HedgeEvent[]>();
    for (const hedge of hedges) {
      const key = normalizeAssetSymbol(hedge.asset_symbol);
      if (!key) continue;
      const existing = grouped.get(key) ?? [];
      existing.push(hedge);
      grouped.set(key, existing);
    }
    for (const [, rows] of grouped) {
      rows.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }
    return grouped;
  }, [hedges]);

  const marketModels: MarketViewModel[] = [
    {
      coin: "ETH",
      title: MARKET_CONFIGS[0].title,
      live: ethLive,
      liveVault: ethVault,
      marketHedges: [],
      hedgeHistoryPoints: [],
      hedgeAmountYu: 0,
      hasHedge: false,
      hedgeSide: null,
      hedgeLastTimestamp: null,
      hlPositionLastUpdated: null,
      ratesSourceLabel: null,
      borosAprDisplay: "--",
      hlAprDisplay: "--",
      spreadBps: null,
      yieldAlert: "",
      alertTitle: "",
      hedgeDebugLabel: null,
      hedgeDebugDetails: null,
    },
    {
      coin: "BTC",
      title: MARKET_CONFIGS[1].title,
      live: btcLive,
      liveVault: btcVault,
      marketHedges: [],
      hedgeHistoryPoints: [],
      hedgeAmountYu: 0,
      hasHedge: false,
      hedgeSide: null,
      hedgeLastTimestamp: null,
      hlPositionLastUpdated: null,
      ratesSourceLabel: null,
      borosAprDisplay: "--",
      hlAprDisplay: "--",
      spreadBps: null,
      yieldAlert: "",
      alertTitle: "",
      hedgeDebugLabel: null,
      hedgeDebugDetails: null,
    },
  ].map((market) => {
    const marketHedges = hedgesByAsset.get(market.coin) ?? [];
    const latestHedge = marketHedges[0] ?? null;
    const fallbackLiveHedgeAmountYu = Number.isFinite(Number(latestHedge?.running_size_eth))
      ? Number(latestHedge?.running_size_eth)
      : Number(latestHedge?.amount_eth ?? 0);
    const derivedHedgeAmountYu = Number.isFinite(fallbackLiveHedgeAmountYu) ? Math.max(0, fallbackLiveHedgeAmountYu) : 0;
    const liveHedgeAmountYu = Math.max(0, Number(market.liveVault.currentHedgeAmountYu ?? 0));
    const hedgeAmountYu = market.liveVault.configured ? liveHedgeAmountYu : derivedHedgeAmountYu;
    const hasHedge = market.liveVault.configured
      ? market.liveVault.hasBorosHedge && hedgeAmountYu > 0.0000001
      : hedgeAmountYu > 0.0000001;
    const hedgeSide = hasHedge
      ? market.liveVault.configured
        ? market.liveVault.currentHedgeIsLong
          ? "LONG"
          : "SHORT"
        : latestHedge?.hedge_side ?? null
      : null;
    const hedgeLastTimestamp = market.liveVault.positionLastUpdate
      ? new Date(market.liveVault.positionLastUpdate).toISOString()
      : latestHedge?.timestamp ?? null;
    const hedgeHistoryPoints = buildHedgeHistoryPoints(
      marketHedges,
      hedgeAmountYu,
      market.liveVault.configured,
      hedgeLastTimestamp,
      zeroSeriesSeed,
    );
    const spreadBps = market.live.hlSpreadBps;
    const borosAprDisplay = market.live.borosImpliedApr != null
      ? `${market.live.borosImpliedApr.toFixed(2)}%`
      : loading
        ? "..."
        : "--";
    const hlAprDisplay = market.live.hlFundingApr != null
      ? `${market.live.hlFundingApr.toFixed(2)}%`
      : loading
        ? "..."
        : "--";
    const yieldAlert = spreadBps != null
      ? `Spread is ${spreadBps.toFixed(1)} bps (HL ${hlAprDisplay} vs Boros ${borosAprDisplay}); ${hasHedge ? `hedge is active${hedgeSide ? ` (${hedgeSide})` : ""}.` : "no hedge is open."}`
      : "Live sidecar data unavailable for this market.";
    const hlPositionLastUpdated = market.live.positionLastUpdate ?? market.live.historyPoints[market.live.historyPoints.length - 1]?.timestamp ?? null;
    const decision = market.live.hedgeDecision;
    const hedgeDebugLabel = decision
      ? !decision.enabled
        ? "Market disabled"
        : decision.action === "OPEN_HEDGE"
          ? `Open ${decision.targetHedgeIsLong ? "long" : "short"} YU`
          : decision.action === "CLOSE_HEDGE"
            ? "Close hedge"
            : decision.shouldHedge
              ? "Hedge already in sync"
              : "No hedge required"
      : null;
    const hedgeDebugDetails = decision
      ? [
          decision.mode ? `mode ${decision.mode}` : null,
          decision.exposure ? `exposure ${decision.exposure}` : null,
          decision.edgeBp != null ? `edge ${decision.edgeBp}bp` : null,
          decision.shouldHedge === false && decision.entryThresholdBp != null
            ? `entry ${decision.entryThresholdBp}bp`
            : null,
          decision.shouldHedge === true && decision.exitThresholdBp != null && decision.action === "SKIP"
            ? `exit ${decision.exitThresholdBp}bp`
            : null,
          decision.reason,
        ]
          .filter(Boolean)
          .join(" • ")
      : null;

    const alertTitle = decision
      ? decision.executeNeeded
        ? "HEDGE ACTION NEEDED"
        : decision.shouldHedge
          ? "HEDGE ACTIVE"
          : "MONITORING SPREAD"
      : hasHedge
        ? "HEDGE ACTIVE"
        : "MONITORING SPREAD";

    return {
      ...market,
      marketHedges,
      hedgeHistoryPoints,
      hedgeAmountYu,
      hasHedge,
      hedgeSide,
      hedgeLastTimestamp,
      hlPositionLastUpdated,
      ratesSourceLabel: market.live.ratesSourceLabel,
      borosAprDisplay,
      hlAprDisplay,
      spreadBps,
      yieldAlert,
      alertTitle,
      hedgeDebugLabel,
      hedgeDebugDetails,
    };
  });

  const syncLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString([], { hour12: false })
    : null;

  return (
    <DashboardLayout className="min-h-full">
      <TickerTape
        markets={marketModels.map((market) => ({
          label: market.coin,
          borosRate: market.live.borosImpliedApr,
          hyperliquidRate: market.live.hlFundingApr,
          spreadBps: market.spreadBps,
        }))}
        lastSyncLabel={syncLabel}
        degraded={degraded}
      />

      <main className="space-y-4 p-3 md:p-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {marketModels.map((market) => (
            <section key={market.coin} className="space-y-3">
              <div className="rounded-sm border border-[#1a1a1a] bg-[linear-gradient(180deg,#090b0f,#07090c)] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-mono uppercase tracking-[0.22em] text-white">{market.title}</h2>
                    <p className="mt-1 text-[10px] font-mono uppercase tracking-[0.16em] text-[#5f6777]">
                      HL {market.live.positionSide ?? "FLAT"} | wallet {borosWallet ?? "--"}
                    </p>
                  </div>
                  <div className="text-right text-[10px] font-mono uppercase tracking-[0.16em] text-[#5f6777]">
                    <div>Boros {market.borosAprDisplay}</div>
                    <div>Hyperliquid {market.hlAprDisplay}</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
                <div className="min-h-0 rounded-sm border border-[#1a1a1a] bg-[radial-gradient(circle_at_top,#11151c,#07090c_70%)] p-4 lg:col-span-12">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
                    <div className="flex-1 rounded-sm border border-[#1d2733] bg-[linear-gradient(145deg,#0c0f14,#0a0b10)] px-4 py-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-mono uppercase tracking-[0.4em] text-[#5b6472]">Yield Alert</p>
                          <p className="mt-2 text-sm font-mono font-bold uppercase tracking-wide text-orange-400">{market.alertTitle}</p>
                        </div>
                        <div className="rounded-full border border-[#2a2f36] px-3 py-1 text-[10px] font-mono uppercase text-[#7a828f]">
                          {market.coin} • {market.ratesSourceLabel ?? "SOURCE OFFLINE"}
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-[#d7c2a8]">{market.yieldAlert}</p>
                      <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] font-mono text-[#7a828f]">
                        <span className="rounded-sm border border-[#1d232b] px-2 py-1">Spread {market.spreadBps != null ? `${market.spreadBps.toFixed(1)} bps` : "--"}</span>
                        <span className="rounded-sm border border-[#1d232b] px-2 py-1">HL {market.live.positionSide ?? "FLAT"}</span>
                        <span className="rounded-sm border border-[#1d232b] px-2 py-1">Wallet {borosWallet ? borosWallet.slice(0, 6) : "--"}</span>
                        {market.hedgeDebugLabel && (
                          <span className="rounded-sm border border-[#2a3320] bg-[#11170d] px-2 py-1 text-[#b6c693]">
                            {market.hedgeDebugLabel}
                          </span>
                        )}
                      </div>
                      {market.hedgeDebugDetails && (
                        <p className="mt-3 text-[11px] font-mono leading-relaxed text-[#8f9aa6]">
                          {market.hedgeDebugDetails}
                        </p>
                      )}
                      {((market.live.error || error || degraded || market.spreadBps == null) && !loading) && (
                        <p className="mt-3 text-[11px] font-mono text-yellow-300/80">
                          {market.live.error
                            ? `Data status: ${market.live.error}`
                            : error
                              ? `Data status: ${error}`
                              : market.spreadBps == null
                                ? "Data status: live sidecar feed unavailable."
                                : "Data status: degraded telemetry mode."}
                        </p>
                      )}
                      {warnings.length > 0 && (
                        <p className="mt-2 truncate text-[10px] font-mono text-yellow-200/60">{warnings[0]}</p>
                      )}
                    </div>

                    <div className="grid w-full gap-3 lg:w-[220px]">
                      <div className="rounded-sm border border-[#19322c] bg-[linear-gradient(180deg,#0b1412,#07100d)] px-3 py-3 text-right">
                        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#4c7564]">Boros Apr</p>
                        <p className="mt-2 text-3xl font-mono leading-none text-emerald-400">{market.borosAprDisplay}</p>
                        <p className="mt-2 text-[10px] font-mono uppercase text-[#5a6a64]">Implied • {market.coin}</p>
                      </div>
                      <div className="rounded-sm border border-[#1a2a3a] bg-[linear-gradient(180deg,#0b1219,#070c12)] px-3 py-3 text-right">
                        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#567197]">HL Funding</p>
                        <p className="mt-2 text-3xl font-mono leading-none text-[#6aa7ff]">{market.hlAprDisplay}</p>
                        <p className="mt-2 text-[10px] font-mono uppercase text-[#5b6a7c]">Live • {market.coin}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="min-h-0 min-w-0 lg:col-span-12">
                  <BorosHedgeChart
                    assetLabel={market.coin}
                    points={market.hedgeHistoryPoints}
                    currentAmountYu={market.hedgeAmountYu}
                    hedgeSide={market.hasHedge ? market.hedgeSide : null}
                    lastUpdatedAt={market.hedgeLastTimestamp ? new Date(market.hedgeLastTimestamp).toLocaleString() : null}
                    loading={loading}
                  />
                </div>
              </div>
            </section>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="h-[300px] lg:col-span-3">
            <SavingsPortfolio
              loading={loading}
              title="SAVINGS PORTFOLIO"
              liveVaultBalance={sharedVaultState.totalAssetsEth}
              liveVaultAssetLabel="mCOLL"
            />
          </div>

          <div className="h-[300px] lg:col-span-9">
                <ExecutionConsole
                    aiLogs={aiLogs}
                    hedges={hedges}
                    chainlinkAutomation={chainlinkAutomation}
                    chainlinkFunctions={chainlinkFunctions}
                    chainlinkFeed={chainlinkFeed}
                    chainlinkCcip={chainlinkCcip}
                    creLogLines={creLogLines}
                    loading={loading}
                />
          </div>
        </div>
      </main>
    </DashboardLayout>
  );
}
