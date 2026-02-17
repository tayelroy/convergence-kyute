"use client";

import React from "react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { TickerTape } from "@/components/dashboard/TickerTape";
import { ConsensusTable } from "@/components/dashboard/ConsensusTable";
import { HealthWidget } from "@/components/dashboard/HealthWidget";
import { KlineChartProWrapper } from "@/components/dashboard/KlineChartPro";
import { ExecutionConsole } from "@/components/dashboard/ExecutionConsole";
import { PredictedFundingWidget } from "@/components/dashboard/PredictedFundingWidget";
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
                    <div className="h-[500px]">
                        <KlineChartProWrapper /> {/* BTC Chart */}
                    </div>

                    {/* Main Table */}
                    <div className="flex-1">
                        <ConsensusTable />
                    </div>

                </div>

                {/* RIGHT COLUMN: Execution & Logs (4 cols) */}
                <div className="col-span-4 flex flex-col h-full space-y-6">
                    <PredictedFundingWidget />
                    <ExecutionConsole />
                </div>

            </main>
        </DashboardLayout>
    );
}
