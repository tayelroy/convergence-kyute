
"use client";

import React from "react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { TickerTape } from "@/components/dashboard/TickerTape";
import { SavingsPortfolio } from "@/components/dashboard/SavingsPortfolio";
import { YieldRiskGauge } from "@/components/dashboard/YieldRiskGauge";
import { GuardianControls } from "@/components/dashboard/GuardianControls";
import { ExecutionConsole } from "@/components/dashboard/ExecutionConsole";
import { ShieldAlert, Bell, Settings, Wallet } from "lucide-react";

export default function DashboardPage() {
    return (
        <DashboardLayout>
            <TickerTape />

            <main className="flex-1 overflow-hidden p-6 grid grid-cols-12 gap-6 min-h-0">

                {/* LEFT COLUMN: Main Savings Dash (8 cols) */}
                <div className="col-span-8 flex flex-col h-full gap-6 overflow-hidden">

                    {/* Header Row */}
                    <div className="flex-none flex items-center justify-between">
                        <div>
                            <div className="flex items-center gap-2">
                                <ShieldAlert className="text-[#00ff9d]" size={24} />
                                <h1 className="text-2xl font-bold text-white tracking-tight">kYUte SAVINGS GUARD</h1>
                            </div>
                            <p className="text-xs text-[#666] font-mono mt-1 ml-8">
                                AI-POWERED YIELD PROTECTION • ARBITRUM SEPOLIA
                            </p>
                        </div>

                        <div className="flex items-center space-x-3">
                            <button className="flex items-center gap-2 px-3 py-1.5 border border-[#1a1a1a] bg-[#0a0a0a] rounded-sm text-xs text-[#888] hover:text-white transition-colors">
                                <Wallet size={14} />
                                <span>0x71C...9A2</span>
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
                            <p className="text-[10px] text-[#666] uppercase tracking-wider">Total Protected Value</p>
                            <p className="text-2xl font-mono text-white mt-1">$6,293.21</p>
                        </div>
                        <div className="p-4 bg-[linear-gradient(45deg,#0a0a0a,#111)] border border-[#1a1a1a] rounded-sm">
                            <p className="text-[10px] text-[#666] uppercase tracking-wider">Yield Earned (30d)</p>
                            <p className="text-2xl font-mono text-[#00ff9d] mt-1">+$142.84</p>
                        </div>
                        <div className="p-4 bg-[linear-gradient(45deg,#0a0a0a,#111)] border border-[#1a1a1a] rounded-sm">
                            <p className="text-[10px] text-[#666] uppercase tracking-wider">Hedge Costs</p>
                            <p className="text-2xl font-mono text-[#fbbf24] mt-1">-$12.50</p>
                        </div>
                    </div>

                    {/* Main Portfolio Table */}
                    <div className="flex-1 min-h-0 relative overflow-hidden">
                        <SavingsPortfolio />
                    </div>

                </div>

                {/* RIGHT COLUMN: AI & Controls (4 cols) */}
                <div className="col-span-4 flex flex-col h-full gap-4 overflow-hidden">

                    {/* 1. AI Risk Gauge */}
                    <div className="flex-none">
                        <YieldRiskGauge />
                    </div>

                    {/* 2. Guardian Controls */}
                    <div className="flex-none">
                        <GuardianControls />
                    </div>

                    {/* 3. Helper Info / Alerts */}
                    <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-sm">
                        <div className="flex gap-2">
                            <Bell size={14} className="text-blue-400 mt-1" />
                            <div>
                                <h4 className="text-xs font-bold text-blue-400">Yield Alert</h4>
                                <p className="text-[10px] text-blue-200/70 mt-1 leading-tight">
                                    USDe funding rates are spiking. AI predicts a 65% chance of correction in 4h. kYUte is monitoring.
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
