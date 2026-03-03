"use client";

import { ConnectButton } from "thirdweb/react";
import { useActiveAccount } from "thirdweb/react";
import { client, hasThirdwebClient } from "@/lib/thirdweb";
import { hyperliquidEvmTestnet } from "@/lib/chains";
import { Activity } from "lucide-react";
import { useEffect } from "react";
import { setCachedWalletAddress } from "@/lib/hl-wallet-cache";

export function Header() {
    const account = useActiveAccount();

    useEffect(() => {
        setCachedWalletAddress(account?.address);
    }, [account?.address]);

    return (
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/[0.06] bg-[#07070a]/80 backdrop-blur-xl px-6">
            {/* Left — Page context */}
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1">
                    <Activity className="h-3 w-3 text-emerald-400" />
                    <span className="text-xs font-mono text-emerald-400">LIVE</span>
                </div>
                <span className="text-xs font-mono text-neutral-600">
                    Hyperliquid EVM Testnet
                </span>
            </div>

            {/* Right — Wallet */}
            {hasThirdwebClient && client ? (
                <ConnectButton
                    client={client}
                    chain={hyperliquidEvmTestnet}
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
                    detailsButton={{
                        connectedAccountName: "Connected",
                        connectedAccountAvatarUrl:
                            "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=",
                    }}
                    theme="dark"
                />
            ) : (
                <span className="text-[11px] font-mono text-yellow-300/80 border border-yellow-500/30 rounded px-2 py-1">
                    Missing NEXT_PUBLIC_THIRDWEB_CLIENT_ID
                </span>
            )}
        </header>
    );
}
