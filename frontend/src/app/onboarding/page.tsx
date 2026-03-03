"use client";

import Link from "next/link";
import Image from "next/image";
import { ConnectButton } from "thirdweb/react";
import { ArrowRight, CheckCircle2, ExternalLink } from "lucide-react";
import { client, hasThirdwebClient } from "@/lib/thirdweb";
import { hyperliquidEvmTestnet } from "@/lib/chains";
import { useHlOpenPosition } from "@/hooks/use-hl-open-position";
import { useActiveAccount } from "thirdweb/react";
import { useEffect } from "react";
import { setCachedWalletAddress } from "@/lib/hl-wallet-cache";
import hyperliquidIcon from "./HL symbol_mint green.png";

export default function OnboardingPage() {
  const account = useActiveAccount();
  const { loading, hasOpenPosition, positions, isTestnet, error, refresh } = useHlOpenPosition(account?.address);

  useEffect(() => {
    setCachedWalletAddress(account?.address);
  }, [account?.address]);

  return (
    <main className="min-h-screen bg-[#05060a] text-white">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Kyute Onboarding</h1>
          {hasThirdwebClient && client ? (
            <ConnectButton
              client={client}
              chain={hyperliquidEvmTestnet}
              connectButton={{
                label: "Connect Wallet",
                style: {
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "#e5e5e5",
                  fontSize: "13px",
                  borderRadius: "10px",
                  padding: "8px 14px",
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
            <span className="text-[11px] font-mono text-yellow-300/90 border border-yellow-500/30 rounded px-2 py-1">
              Missing NEXT_PUBLIC_THIRDWEB_CLIENT_ID
            </span>
          )}
        </div>

        {!hasThirdwebClient && (
          <div className="mb-6 p-3 rounded-sm border border-yellow-500/30 bg-yellow-500/10 text-yellow-200 text-xs font-mono">
            Wallet connect is disabled. Add `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` to `frontend/.env.local`, then restart
            the frontend dev server.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className={`p-4 rounded-sm border ${account ? "border-emerald-500/30 bg-emerald-500/10" : "border-[#20242d] bg-[#0b0e14]"}`}>
            <p className="text-[10px] uppercase tracking-wider text-neutral-400">Step 1</p>
            <p className="mt-1 text-sm">Connect wallet</p>
            {account && <CheckCircle2 className="mt-2 h-4 w-4 text-emerald-400" />}
          </div>
          <div className={`p-4 rounded-sm border ${hasOpenPosition ? "border-emerald-500/30 bg-emerald-500/10" : "border-[#20242d] bg-[#0b0e14]"}`}>
            <p className="text-[10px] uppercase tracking-wider text-neutral-400">Step 2</p>
            <p className="mt-1 text-sm">Open ETH position (min $10)</p>
            {hasOpenPosition && <CheckCircle2 className="mt-2 h-4 w-4 text-emerald-400" />}
          </div>
          <div className={`p-4 rounded-sm border ${hasOpenPosition ? "border-emerald-500/30 bg-emerald-500/10" : "border-[#20242d] bg-[#0b0e14]"}`}>
            <p className="text-[10px] uppercase tracking-wider text-neutral-400">Step 3</p>
            <p className="mt-1 text-sm">Access dashboard</p>
            {hasOpenPosition && <CheckCircle2 className="mt-2 h-4 w-4 text-emerald-400" />}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <div className="p-5 rounded-sm border border-[#1c2028] bg-[#0b0e14]">
            <h2 className="text-sm font-semibold">Entry Requirement</h2>
            <p className="text-xs text-neutral-400 mt-2 leading-relaxed">
              Dashboard access requires an already-open Hyperliquid <span className="text-neutral-200">perp</span>{" "}
              position on testnet for your connected wallet.
            </p>
            <div className="mt-4 p-3 rounded-sm border border-[#2a2e37] bg-[#090c12] text-[11px] font-mono text-neutral-300">
              If you opened a position recently, wait a few seconds and click refresh.
            </div>
            <a
              href="https://app.hyperliquid-testnet.xyz/trade/ETH"
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-2 h-9 px-3 rounded-sm border border-sky-500/40 bg-sky-500/10 text-sky-300 text-xs font-semibold hover:bg-sky-500/20 transition-colors"
            >
              <Image
                src={hyperliquidIcon}
                alt="Hyperliquid"
                width={14}
                height={14}
                className="h-[14px] w-[14px]"
              />
              Open Position on Hyperliquid
              <ExternalLink size={13} className="opacity-90" />
            </a>
          </div>

          <div className="p-5 rounded-sm border border-[#1c2028] bg-[#0b0e14]">
            <h2 className="text-sm font-semibold">Access Gate Status</h2>
            <p className="text-xs text-neutral-400 mt-2">
              Dashboard is unlocked only when your connected wallet has an open Hyperliquid position.
            </p>

            <div className="mt-4 space-y-2 text-xs font-mono">
              <div className="text-neutral-400">
                wallet: <span className="text-neutral-200">{account?.address ?? "not connected"}</span>
              </div>
              <div className="text-neutral-400">
                network mode: <span className="text-neutral-200">{isTestnet ? "testnet" : "mainnet"}</span>
              </div>
              <div className="text-neutral-400">
                position:{" "}
                <span className={hasOpenPosition ? "text-emerald-300" : "text-yellow-300"}>
                  {loading ? "checking..." : hasOpenPosition ? "open position detected" : "no open position"}
                </span>
              </div>
              {error && <div className="text-rose-300">lookup error: {error}</div>}
            </div>

            {positions.length > 0 && (
              <div className="mt-4 border border-emerald-500/20 bg-emerald-500/5 rounded-sm p-2">
                <p className="text-[10px] uppercase tracking-wider text-emerald-300 mb-2">Detected Positions</p>
                <div className="space-y-1 text-[11px] font-mono text-emerald-100/90">
                  {positions.slice(0, 5).map((p) => (
                    <div key={`${p.coin}-${p.size}`} className="flex items-center justify-between">
                      <span>{p.coin}</span>
                      <span>{p.size > 0 ? "LONG" : "SHORT"} {Math.abs(p.size)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => void refresh()}
              className="mt-4 h-9 px-3 rounded-sm border border-[#2a2e37] text-xs text-neutral-200 hover:bg-white/[0.04] transition-colors"
            >
              Refresh Position Check
            </button>

            <div className="mt-5">
              <Link
                href="/dashboard"
                className={`inline-flex items-center gap-2 h-10 px-4 rounded-sm text-sm font-semibold transition-colors ${
                  hasOpenPosition
                    ? "bg-emerald-500/90 text-[#06140e] hover:bg-emerald-400"
                    : "bg-[#1c212a] text-neutral-500 pointer-events-none"
                }`}
              >
                Continue to Dashboard <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
