"use client";

import React from "react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { TickerTape } from "@/components/dashboard/TickerTape";
import { SavingsPortfolio } from "@/components/dashboard/SavingsPortfolio";
import { YieldRiskGauge } from "@/components/dashboard/YieldRiskGauge";
import { GuardianControls } from "@/components/dashboard/GuardianControls";
import { ExecutionConsole } from "@/components/dashboard/ExecutionConsole";
import { useAgentStatus } from "@/hooks/useAgentStatus";
import { ShieldAlert, Bell, Settings, Wallet } from "lucide-react";

export default function DashboardPage() {
    const { latest, loading } = useAgentStatus();

    const borosAprDisplay = loading ? "..." : latest ? `${latest.boros_apr.toFixed(2)}%` : "--";
    const hlAprDisplay    = loading ? "..." : latest ? `${latest.hl_apr.toFixed(2)}%`    : "--";
    const spreadDisplay   = loading ? "..." : latest ? `${(latest.spread_bps / 100).toFixed(2)}%` : "--";

    return (
        <DashboardLayout>
            <TickerTape
                assetSymbol={latest?.asset_symbol}
                borosRate={latest?.boros_apr}
                hyperliquidRate={latest?.hl_apr}
                spreadBps={latest?.spread_bps}
            />

            <main className="flex-1 overflow-hidden p-6 grid grid-cols-12 gap-6 min-h-0">

                {/* LEFT COLUMN */}
                <div className="col-span-8 flex flex-col h-full gap-6 overflow-hidden">

                    {/* Header Row */}
                    <div className="flex-none flex items-center justify-between">
                        <div>
                            <div className="flex items-center gap-2">
                                <ShieldAlert className="text-[#00ff9d]" size={24} />
                                <h1 className="text-2xl font-bold text-white tracking-tight">kYUte SAVINGS GUARD</h1>
                            </div>
                            <p className="text-xs text-[#666] font-mono mt-1 ml-8">
                                AI-POWERED YIELD PROTECTION • ARBITRUM ONE (MAINNET FORK)
                            </p>
                        </div>

                        <div className="flex items-center space-x-3">
                            <button className="flex items-center gap-2 px-3 py-1.5 border border-[#1a1a1a] bg-[#0a0a0a] rounded-sm text-xs text-[#888] hover:text-white transition-colors">
                                <Wallet size={14} />
                                <span>{latest ? `${latest.asset_symbol} Vault` : "No Wallet"}</span>
                            </button>
                            <button className="p-2 border border-[#1a1a1a] bg-[#0a0a0a] text-[#666] hover:text-white transition-colors rounded-sm">
                                <Bell size={16} />
                            </button>
                            <button className="p-2 border border-[#1a1a1a] bg-[#0a0a0a] text-[#666] hover:text-white transition-colors rounded-sm">
                                <Settings size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Quick Stats Row */}
                    <div className="grid grid-cols-3 gap-4">
                        <div className="p-4 bg-[linear-gradient(45deg,#0a0a0a,#111)] border border-[#1a1a1a] rounded-sm">
                            <p className="text-[10px] text-[#666] uppercase tracking-wider">Boros APR</p>
                            <p className="text-2xl font-mono text-white mt-1">{borosAprDisplay}</p>
                        </div>
                        <div className="p-4 bg-[linear-gradient(45deg,#0a0a0a,#111)] border border-[#1a1a1a] rounded-sm">
                            <p className="text-[10px] text-[#666] uppercase tracking-wider">HL Funding APR</p>
                            <p className="text-2xl font-mono text-[#00ff9d] mt-1">{hlAprDisplay}</p>
                        </div>
                        <div className="p-4 bg-[linear-gradient(45deg,#0a0a0a,#111)] border border-[#1a1a1a] rounded-sm">
                            <p className="text-[10px] text-[#666] uppercase tracking-wider">Spread</p>
                            <p className="text-2xl font-mono text-[#fbbf24] mt-1">{spreadDisplay}</p>
                        </div>
                    </div>

                    {/* Main Portfolio Table */}
                    <div className="flex-1 min-h-0 relative overflow-hidden">
                        <SavingsPortfolio />
                    </div>

                </div>

                {/* RIGHT COLUMN */}
                <div className="col-span-4 flex flex-col h-full gap-4 overflow-hidden">

                    {/* 1. AI Risk Gauge */}
                    <div className="flex-none">
                        <YieldRiskGauge />
                    </div>

                    {/* 2. Guardian Controls */}
                    <div className="flex-none">
                        <GuardianControls />
                    </div>

                    {/* 3. Yield Alert */}
                    <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-sm">
                        <div className="flex gap-2">
                            <Bell size={14} className="text-blue-400 mt-1 shrink-0" />
                            <div>
                                <h4 className="text-xs font-bold text-blue-400">Yield Alert</h4>
                                <p className="text-[10px] text-blue-200/70 mt-1 leading-tight">
                                    {latest
                                        ? `Spread is ${latest.spread_bps} bps. AI trigger at ${process.env.NEXT_PUBLIC_AI_TRIGGER_BPS ?? "800"} bps.`
                                        : "kYUte is monitoring yield spreads..."}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* 4. Execution Logs */}
                    <div className="flex-1 min-h-0 relative overflow-hidden">
                        <ExecutionConsole />
                    </div>
                </div>

            </main>
        </DashboardLayout>
    );
}