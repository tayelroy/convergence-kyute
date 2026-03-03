"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, Loader2 } from "lucide-react";
import { useActiveAccount, useActiveWalletChain, useSwitchActiveWalletChain } from "thirdweb/react";
import { executeEthOrderClientSide } from "@/lib/hyperliquid-client";
import { HYPERLIQUID_TESTNET_CHAIN_ID, hyperliquidEvmTestnet } from "@/lib/chains";

type OpenEthResponse = {
  ok: boolean;
  error?: string;
  orderResponse?: unknown;
  details?: {
    minimumSizeEth?: number;
    requestedNotionalUsd?: number;
    midPriceUsd?: number;
  };
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    const candidates = [obj.message, obj.shortMessage, obj.details, obj.error];
    for (const c of candidates) {
      if (typeof c === "string" && c.length > 0) return c;
    }
    try {
      return JSON.stringify(obj);
    } catch {
      return "Order submission/signing failed.";
    }
  }
  return "Order submission/signing failed.";
};

const DEFAULT_POSITION_USD = "25";
const DEFAULT_LEVERAGE = "3";

export function OpenEthPositionCard() {
  const account = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const switchActiveWalletChain = useSwitchActiveWalletChain();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [positionUsd, setPositionUsd] = useState(DEFAULT_POSITION_USD);
  const [leverage, setLeverage] = useState(DEFAULT_LEVERAGE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<OpenEthResponse | null>(null);

  const parsedPositionUsd = useMemo(() => Number(positionUsd), [positionUsd]);
  const parsedLeverage = useMemo(() => Number(leverage), [leverage]);
  const isPositionValid = Number.isFinite(parsedPositionUsd) && parsedPositionUsd > 0;
  const isLeverageValid = Number.isFinite(parsedLeverage) && parsedLeverage >= 1 && parsedLeverage <= 50;
  const isCorrectChain = activeChain?.id === HYPERLIQUID_TESTNET_CHAIN_ID;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isPositionValid) {
      setResult({ ok: false, error: "Enter a valid USDC position size greater than 0." });
      return;
    }
    if (!isLeverageValid) {
      setResult({ ok: false, error: "Leverage must be between 1 and 50." });
      return;
    }
    if (!account) {
      setResult({ ok: false, error: "Connect your wallet first." });
      return;
    }
    if (!isCorrectChain) {
      try {
        await switchActiveWalletChain(hyperliquidEvmTestnet);
      } catch {
        setResult({
          ok: false,
          error: "Wrong network. Switch wallet to Hyperliquid EVM Testnet (chain 998) and retry.",
        });
        return;
      }
    }
    if (parsedPositionUsd < 10) {
      setResult({ ok: false, error: "Minimum order value is $10." });
      return;
    }

    setIsSubmitting(true);
    setResult(null);
    try {
      const payload = await executeEthOrderClientSide({
        account,
        side,
        positionUsd: parsedPositionUsd,
        leverage: parsedLeverage,
        testnet: true,
      });
      setResult({ ok: true, orderResponse: payload.orderResponse });
    } catch (error) {
      const message = getErrorMessage(error);
      setResult({ ok: false, error: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-4 rounded-sm border border-[#1a1a1a] bg-[linear-gradient(145deg,#0a0a0a,#0f0f0f)]">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Open ETH Position</h3>
        <span className="text-[10px] px-2 py-1 rounded-sm border border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
          Min $10
        </span>
      </div>

      <p className="text-[11px] text-[#7a7a7a] mt-2">
        Signs and submits from your connected wallet directly on Hyperliquid testnet. Minimum order value is $10.
      </p>

      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setSide("buy")}
            className={`h-9 rounded-sm border text-xs font-semibold transition-colors ${
              side === "buy"
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                : "border-[#2a2a2a] bg-[#070707] text-[#9a9a9a] hover:text-white"
            }`}
          >
            BUY
          </button>
          <button
            type="button"
            onClick={() => setSide("sell")}
            className={`h-9 rounded-sm border text-xs font-semibold transition-colors ${
              side === "sell"
                ? "border-rose-500/40 bg-rose-500/15 text-rose-300"
                : "border-[#2a2a2a] bg-[#070707] text-[#9a9a9a] hover:text-white"
            }`}
          >
            SELL
          </button>
        </div>

        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-[#6a6a6a]">Position (USDC)</span>
          <div className="relative mt-1">
            <ArrowUpDown size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#4a4a4a]" />
            <input
              value={positionUsd}
              onChange={(e) => setPositionUsd(e.target.value)}
              inputMode="decimal"
              className="w-full h-9 pl-7 pr-2 rounded-sm bg-[#050505] border border-[#2a2a2a] text-white text-sm outline-none focus:border-[#4bf3a6]/60"
              placeholder="25"
            />
          </div>
        </label>

        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-[#6a6a6a]">Leverage (x)</span>
          <input
            value={leverage}
            onChange={(e) => setLeverage(e.target.value)}
            inputMode="decimal"
            className="mt-1 w-full h-9 px-2 rounded-sm bg-[#050505] border border-[#2a2a2a] text-white text-sm outline-none focus:border-[#4bf3a6]/60"
            placeholder="3"
          />
        </label>

        <button
          type="submit"
          disabled={isSubmitting || !isPositionValid || !isLeverageValid}
          className="w-full h-9 rounded-sm bg-[#0adf8a] text-[#04130d] text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#18f39a] transition-colors"
        >
          {isSubmitting ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Submitting
            </span>
          ) : (
            "Open ETH Position"
          )}
        </button>
      </form>

      {result && (
        <div
          className={`mt-3 p-2 rounded-sm border text-[11px] ${
            result.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
          }`}
        >
          {result.ok ? "Order request submitted successfully." : result.error ?? "Order request failed."}
          {!result.ok && result.details?.minimumSizeEth && (
            <div className="mt-1 text-[10px] text-rose-200/80">
              Minimum size now: {result.details.minimumSizeEth.toFixed(6)} ETH
            </div>
          )}
        </div>
      )}

      {!account && (
        <p className="mt-2 text-[10px] text-yellow-300/80">
          Wallet not connected. Connect wallet in header to sign orders.
        </p>
      )}

      {account && !isCorrectChain && (
        <div className="mt-2 p-2 rounded-sm border border-yellow-500/30 bg-yellow-500/10 text-[10px] text-yellow-200 flex items-center justify-between gap-2">
          <span>Wrong network. Use Hyperliquid EVM Testnet (chain 998).</span>
          <button
            type="button"
            className="h-7 px-2 rounded-sm border border-yellow-400/50 text-yellow-100 hover:bg-yellow-400/10"
            onClick={() => {
              void switchActiveWalletChain(hyperliquidEvmTestnet);
            }}
          >
            Switch Network
          </button>
        </div>
      )}
    </div>
  );
}
