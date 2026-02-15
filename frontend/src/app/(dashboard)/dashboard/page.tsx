"use client";

import { LiveSpreadsTable } from "@/components/dashboard/live-spreads-table";
import { ProfitChart } from "@/components/dashboard/profit-chart";
import { VolumeChart } from "@/components/dashboard/volume-chart";
import { VaultHealthCard } from "@/components/dashboard/vault-health-card";
import {
    mockSpreads,
    mockVault,
    mockProfitData,
    mockVenueVolumes,
} from "@/lib/mock-data";

export default function DashboardPage() {
    const handleExecute = (asset: string) => {
        console.log(`Executing arbitrage on ${asset}...`);
    };

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div>
                <h1 className="text-xl font-semibold text-white">Dashboard</h1>
                <p className="text-sm text-neutral-500 mt-1">
                    Monitor funding rate spreads and vault performance.
                </p>
            </div>

            {/* Top Row: Vault Health + Profit Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <VaultHealthCard data={mockVault} />
                <ProfitChart data={mockProfitData} />
            </div>

            {/* Live Spreads Table */}
            <LiveSpreadsTable data={mockSpreads} onExecute={handleExecute} />

            {/* Bottom Row: Volume Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <VolumeChart data={mockVenueVolumes} />
            </div>
        </div>
    );
}
