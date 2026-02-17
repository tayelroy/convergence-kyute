"use client";

import React from "react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { TickerTape } from "@/components/dashboard/TickerTape";
import { ConsensusTable } from "@/components/dashboard/ConsensusTable";
import { HealthWidget } from "@/components/dashboard/HealthWidget";
import dynamic from "next/dynamic";

const KlineChartProWrapper = dynamic(
    () => import("@/components/dashboard/KlineChartPro").then((mod) => mod.KlineChartProWrapper),
    { ssr: false }
);
import { ExecutionConsole } from "@/components/dashboard/ExecutionConsole";
import { PredictedFundingWidget } from "@/components/dashboard/PredictedFundingWidget";
import { Wallet, Settings, Bell } from "lucide-react";

export default function DashboardPage() {
    return (
        <DashboardLayout>
            {/* 1. Header / Ticker */}
            <TickerTape />

            <main className="flex-1 overflow-hidden p-6 grid grid-cols-12 gap-6 min-h-0">

                {/* LEFT COLUMN: Main Data (8 cols) */}
                <div className="col-span-8 flex flex-col h-full gap-6 overflow-hidden">

                    {/* Header Row - Fixed Height */}
                    <div className="flex-none flex items-center justify-between">
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

                    {/* Charts Row - Flexible Height (takes ~60% of remaining space) */}
                    <div className="flex-[3] min-h-0 relative border border-[#1a1a1a] bg-[#050505] overflow-hidden rounded-sm">
                        <KlineChartProWrapper /> {/* BTC Chart */}
                    </div>

                    {/* Main Table - Flexible Height (takes ~40% of remaining space) */}
                    <div className="flex-[2] min-h-0 relative overflow-hidden">
                        <ConsensusTable />
                    </div>

                </div>

                {/* RIGHT COLUMN: Execution & Logs (4 cols) */}
                <div className="col-span-4 flex flex-col h-full gap-6 overflow-hidden">
                    <div className="flex-none">
                        <PredictedFundingWidget />
                    </div>

                    <div className="flex-1 min-h-0 relative overflow-hidden">
                        <ExecutionConsole />
                    </div>
                </div>

            </main>
        </DashboardLayout>
    );
}
