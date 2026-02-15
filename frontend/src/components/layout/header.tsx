"use client";

import { ConnectButton } from "thirdweb/react";
import { arbitrum } from "thirdweb/chains";
import { client } from "@/lib/thirdweb";
import { Activity } from "lucide-react";

export function Header() {
    return (
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/[0.06] bg-[#07070a]/80 backdrop-blur-xl px-6">
            {/* Left — Page context */}
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1">
                    <Activity className="h-3 w-3 text-emerald-400" />
                    <span className="text-xs font-mono text-emerald-400">LIVE</span>
                </div>
                <span className="text-xs font-mono text-neutral-600">
                    Arbitrum One
                </span>
            </div>

            {/* Right — Wallet */}
            <ConnectButton
                client={client}
                chain={arbitrum}
                connectButton={{
                    label: "Connect Wallet",
                    style: {
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#e5e5e5",
                        fontSize: "13px",
                        fontFamily: "var(--font-mono)",
                        borderRadius: "10px",
                        padding: "8px 16px",
                        height: "38px",
                    },
                }}
                theme="dark"
            />
        </header>
    );
}
