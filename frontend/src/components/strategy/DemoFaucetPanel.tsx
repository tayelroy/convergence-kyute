"use client";

import { useState, type ReactNode } from "react";
import { Droplets, Fuel, Wallet } from "lucide-react";
import { useActiveAccount } from "thirdweb/react";
import { formatAddress } from "@/lib/kyute-vault";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const DEMO_FAUCET_REFRESH_EVENT = "kyute-demo-faucet-funded";

type FaucetResponse = {
  ok: boolean;
  walletAddress?: string;
  ethAmount?: string;
  collateralAmount?: string;
  collateralSymbol?: string;
  txHashes?: string[];
  error?: string;
};

export function DemoFaucetPanel() {
  const account = useActiveAccount();
  const [isFunding, setIsFunding] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  if (!DEMO_MODE) {
    return null;
  }

  const onFundWallet = async () => {
    if (!account?.address) {
      setStatusMessage("Connect the wallet you want to fund first.");
      return;
    }

    try {
      setIsFunding(true);
      setStatusMessage(null);

      const response = await fetch("/api/demo-faucet", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          walletAddress: account.address,
        }),
      });

      const payload = (await response.json()) as FaucetResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Demo faucet funding failed.");
      }

      window.dispatchEvent(new CustomEvent(DEMO_FAUCET_REFRESH_EVENT));
      setStatusMessage(
        `Funded ${formatAddress(payload.walletAddress, 5)} with ${payload.ethAmount ?? "1"} ETH and ${payload.collateralAmount ?? "250"} ${payload.collateralSymbol ?? "mCOLL"}.`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Demo faucet funding failed.");
    } finally {
      setIsFunding(false);
    }
  };

  return (
    <aside className="rounded-[30px] border border-white/8 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_38%),linear-gradient(180deg,#0d1214,#090b0f)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-cyan-300/70">Demo wallet bootstrap</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Fund this wallet for local deposits</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-400">
            On local Anvil, the connected wallet needs both gas and mock collateral before the vault deposit rail can work. This faucet sends both.
          </p>
        </div>
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-right">
          <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-cyan-300/70">Recipient</p>
          <p className="mt-1 text-sm font-medium text-cyan-100">{formatAddress(account?.address, 5)}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="Gas" value="1 ETH" icon={<Fuel className="h-4 w-4" />} />
        <Metric label="Collateral" value="250 mCOLL" icon={<Droplets className="h-4 w-4" />} />
        <Metric label="Target" value="Connected wallet" icon={<Wallet className="h-4 w-4" />} />
      </div>

      <button
        type="button"
        onClick={() => void onFundWallet()}
        disabled={isFunding || !account?.address}
        className={`mt-5 inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl border px-4 text-xs font-mono uppercase tracking-[0.22em] transition-colors ${
          isFunding || !account?.address
            ? "cursor-not-allowed border-white/8 bg-white/[0.04] text-neutral-500"
            : "border-cyan-400/30 bg-cyan-400/12 text-cyan-100 hover:bg-cyan-400/18"
        }`}
      >
        {isFunding ? "Funding wallet" : "Fund connected wallet"}
      </button>

      <div className="mt-4 space-y-2 text-[11px] font-mono">
        {!account?.address ? <p className="text-neutral-400">Connect a wallet before using the demo faucet.</p> : null}
        {statusMessage ? <p className="text-cyan-100/90">{statusMessage}</p> : null}
        <p className="text-neutral-500">Local-only helper. This route should stay disabled outside demo mode.</p>
      </div>
    </aside>
  );
}

function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.22em] text-neutral-500">
        <span className="text-cyan-300/80">{icon}</span>
        {label}
      </div>
      <p className="mt-3 text-lg font-semibold tracking-tight text-white">{value}</p>
    </div>
  );
}
