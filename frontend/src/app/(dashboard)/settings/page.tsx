"use client";

import { Settings, Bell, Shield, Sliders } from "lucide-react";

export default function SettingsPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-white">Settings</h1>
                <p className="text-sm text-neutral-500 mt-1">
                    Configure vault parameters and notification preferences.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Execution Settings */}
                <div className="rounded-xl border border-white/[0.06] bg-[#0c0c14] p-5 space-y-5">
                    <div className="flex items-center gap-2">
                        <Sliders className="h-4 w-4 text-emerald-400" />
                        <h2 className="text-sm font-semibold text-white">
                            Execution Parameters
                        </h2>
                    </div>

                    <div className="space-y-4">
                        <SettingRow
                            label="Min Spread Threshold"
                            value="20 bps"
                            description="Minimum net spread required to trigger an execution."
                        />
                        <SettingRow
                            label="Max Leverage"
                            value="100x"
                            description="Maximum leverage applied to new positions."
                        />
                        <SettingRow
                            label="Scan Interval"
                            value="5 min"
                            description="CRE cron trigger frequency for market scanning."
                        />
                        <SettingRow
                            label="Large Cap Leverage Cap"
                            value="50x"
                            description="Reduced leverage for BTC/ETH with <20min reversion."
                        />
                    </div>
                </div>

                {/* Notification Settings */}
                <div className="rounded-xl border border-white/[0.06] bg-[#0c0c14] p-5 space-y-5">
                    <div className="flex items-center gap-2">
                        <Bell className="h-4 w-4 text-emerald-400" />
                        <h2 className="text-sm font-semibold text-white">Notifications</h2>
                    </div>

                    <div className="space-y-4">
                        <ToggleRow label="Trade Executions" enabled={true} />
                        <ToggleRow label="Spread Alerts (>500 bps)" enabled={true} />
                        <ToggleRow label="Position Liquidation Warnings" enabled={true} />
                        <ToggleRow label="Daily P&L Summary" enabled={false} />
                    </div>
                </div>

                {/* Security */}
                <div className="rounded-xl border border-white/[0.06] bg-[#0c0c14] p-5 space-y-5">
                    <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-emerald-400" />
                        <h2 className="text-sm font-semibold text-white">Security</h2>
                    </div>

                    <div className="space-y-4">
                        <SettingRow
                            label="Vault Contract"
                            value="0xKyut...eVault"
                            description="On-chain vault contract receiving CRE reports."
                        />
                        <SettingRow
                            label="CRE Forwarder"
                            value="Chainlink DON"
                            description="Authorized report signer for EVM write capability."
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

function SettingRow({
    label,
    value,
    description,
}: {
    label: string;
    value: string;
    description: string;
}) {
    return (
        <div className="flex items-center justify-between py-2 border-b border-white/[0.03] last:border-0">
            <div>
                <p className="text-sm text-white">{label}</p>
                <p className="text-[11px] text-neutral-600 mt-0.5">{description}</p>
            </div>
            <span className="text-sm font-mono text-emerald-400 shrink-0 ml-4">
                {value}
            </span>
        </div>
    );
}

function ToggleRow({
    label,
    enabled,
}: {
    label: string;
    enabled: boolean;
}) {
    return (
        <div className="flex items-center justify-between py-2 border-b border-white/[0.03] last:border-0">
            <p className="text-sm text-white">{label}</p>
            <div
                className={`w-9 h-5 rounded-full relative transition-colors ${enabled ? "bg-emerald-500/30" : "bg-white/[0.08]"
                    }`}
            >
                <div
                    className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${enabled
                            ? "left-[18px] bg-emerald-400"
                            : "left-0.5 bg-neutral-500"
                        }`}
                />
            </div>
        </div>
    );
}
