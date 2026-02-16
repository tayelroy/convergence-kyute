"use client";

import React from "react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { TickerTape } from "@/components/dashboard/TickerTape";
import { ConsensusTable } from "@/components/dashboard/ConsensusTable";
import { HealthWidget } from "@/components/dashboard/HealthWidget";
import { SpreadChart } from "@/components/dashboard/SpreadChart";
import { ExecutionConsole } from "@/components/dashboard/ExecutionConsole";
import { Wallet, Settings, Bell } from "lucide-react";

export default function DashboardPage() {
    return (
        <DashboardLayout>
            {/* 1. Header / Ticker */}
            <TickerTape />

            <main className="flex-1 overflow-hidden p-6 grid grid-cols-12 gap-6">

                {/* LEFT COLUMN: Main Data (8 cols) */}
                <div className="col-span-8 flex flex-col space-y-6">

                    {/* Header Row */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-white tracking-tight">MARKET SURVEILLANCE</h1>
                            <p className="text-xs text-[#666] font-mono mt-1">
                                SESSION ID: CRE-8X92 • ARBITRUM SEPOLIA
                            </p>
                        </div>

                        <div className="flex items-center space-x-4">
                            <HealthWidget />
                            <button className="p-2 border border-[#1a1a1a] bg-[#0a0a0a] text-[#666] hover:text-white hover:border-[#333] transition-colors">
                                <Bell size={16} />
                            </button>
                            <button className="p-2 border border-[#1a1a1a] bg-[#0a0a0a] text-[#666] hover:text-white hover:border-[#333] transition-colors">
                                <Settings size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Charts Row */}
                    <div className="grid grid-cols-2 gap-4 h-40">
                        <SpreadChart /> {/* BTC Chart */}

                        {/* Info Panel / Total PnL (Mock) */}
                        <div className="bg-[#080808] border border-[#1a1a1a] p-4 flex flex-col justify-between">
                            <div>
                                <h3 className="text-xs text-[#666] uppercase">Total Vault PnL (Est.)</h3>
                                <div className="text-3xl font-bold text-[#00ff00] font-mono mt-2 flex items-baseline">
                                    +$1,294.05
                                    <span className="text-xs text-[#00ff00] ml-2 opacity-60">(+2.4%)</span>
                                </div>
                            </div>
                            <div className="flex items-center space-x-2 text-xs text-[#444]">
                                <Wallet size={12} />
                                <span>0x71C...92A1</span>
                            </div>
                        </div>
                    </div>

                    {/* Main Table */}
                    <div className="flex-1">
                        <ConsensusTable />
                    </div>

                </div>

                {/* RIGHT COLUMN: Execution & Logs (4 cols) */}
                <div className="col-span-4 flex flex-col h-full">
                    <ExecutionConsole />
                </div>

            </main>
        </DashboardLayout>
    );
}
