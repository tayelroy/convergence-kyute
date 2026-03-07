"use client";

import { Layers, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useActiveAccount } from "thirdweb/react";
import { useHyperliquidDashboard } from "@/hooks/use-hyperliquid-dashboard";
import { useKyuteVaultState } from "@/hooks/use-kyute-vault-state";
import { getCachedWalletAddress } from "@/lib/hl-wallet-cache";
import { DEFAULT_MARKET_YU_TOKENS } from "@/lib/kyute-vault";

const canonicalWalletFromEnv = (() => {
  const raw = String(process.env.NEXT_PUBLIC_CANONICAL_HL_WALLET ?? "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(raw) ? raw.toLowerCase() : null;
})();

const MARKETS = [
  {
    coin: "ETH",
    pair: "ETHUSDC",
    title: "ETH / USDC",
    yuToken: DEFAULT_MARKET_YU_TOKENS.ETH,
    borosMarketAddress: String(process.env.NEXT_PUBLIC_BOROS_MARKET_ADDRESS ?? "").trim().toLowerCase() || null,
    borosMarketId: 41,
  },
  {
    coin: "BTC",
    pair: "BTCUSDC",
    title: "BTC / USDC",
    yuToken: DEFAULT_MARKET_YU_TOKENS.BTC,
    borosMarketAddress: String(process.env.NEXT_PUBLIC_BOROS_BTC_MARKET_ADDRESS ?? "").trim().toLowerCase() || null,
    borosMarketId: 61,
  },
] as const;

export default function PositionsPage() {
  const account = useActiveAccount();
  const walletAddress = canonicalWalletFromEnv ?? account?.address?.toLowerCase() ?? getCachedWalletAddress() ?? undefined;

  const ethLive = useHyperliquidDashboard({
    coin: "ETH",
    pair: "ETHUSDC",
    borosMarketAddress: MARKETS[0].borosMarketAddress,
    borosMarketId: MARKETS[0].borosMarketId,
    walletAddress,
  });
  const btcLive = useHyperliquidDashboard({
    coin: "BTC",
    pair: "BTCUSDC",
    borosMarketAddress: MARKETS[1].borosMarketAddress,
    borosMarketId: MARKETS[1].borosMarketId,
    walletAddress,
  });

  const ethVault = useKyuteVaultState(walletAddress, DEFAULT_MARKET_YU_TOKENS.ETH);
  const btcVault = useKyuteVaultState(walletAddress, DEFAULT_MARKET_YU_TOKENS.BTC);

  const rows = [
    {
      market: MARKETS[0],
      live: ethLive,
      vault: ethVault,
    },
    {
      market: MARKETS[1],
      live: btcLive,
      vault: btcVault,
    },
  ];

  const loading = ethVault.loading || btcVault.loading || ethLive.loading || btcLive.loading;
  const error = ethVault.error ?? btcVault.error ?? ethLive.error ?? btcLive.error ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Active Positions</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Live Boros hedge positions from the vault, aligned to the same wallet and markets the agent uses.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {error && !loading ? (
          <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-5 text-sm text-yellow-200">
            Vault state unavailable: {error}
          </div>
        ) : null}

        {rows.map(({ market, live, vault }) => {
          const hasHedge = vault.hasBorosHedge && vault.currentHedgeAmountYu > 0.0000001;
          const hedgeSide = hasHedge ? (vault.currentHedgeIsLong ? "LONG" : "SHORT") : "NO HEDGE";
          const hlSide = live.positionSide ?? "FLAT";
          const latestApr = live.borosImpliedApr ?? null;
          return (
            <div
              key={market.coin}
              className="rounded-xl border border-white/[0.06] bg-[#0c0c14] p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm font-semibold text-white">{market.title}</span>
                  <span
                    className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                      hasHedge
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-neutral-500/10 text-neutral-400 border-white/[0.08]"
                    }`}
                  >
                    {hedgeSide}
                  </span>
                </div>
                <div className={`flex items-center gap-1 ${hasHedge ? "text-emerald-400" : "text-neutral-400"}`}>
                  {hasHedge ? (
                    vault.currentHedgeIsLong ? (
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowDownRight className="h-3.5 w-3.5" />
                    )
                  ) : null}
                  <span className="text-xs font-mono">{vault.currentHedgeAmountYu.toFixed(4)} YU</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-mono uppercase text-neutral-500">Current hedge</p>
                  <p className="text-sm font-mono text-white">{vault.currentHedgeAmountYu.toFixed(4)} YU</p>
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase text-neutral-500">HL exposure</p>
                  <p className="text-sm font-mono text-white">
                    {hlSide} {live.totalOpenNow.toFixed(4)} {market.coin}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase text-neutral-500">Target hedge</p>
                  <p className="text-sm font-mono text-white">
                    {hasHedge ? (vault.currentHedgeIsLong ? "LONG YU" : "SHORT YU") : "NONE"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase text-neutral-500">Current Boros APR</p>
                  <p className="text-sm font-mono text-emerald-400">
                    {latestApr != null ? `${latestApr.toFixed(2)}%` : "--"}
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-white/[0.04] space-y-1">
                <p className="text-[10px] font-mono text-neutral-600 truncate">
                  Wallet: {walletAddress ?? "--"}
                </p>
                <p className="text-[10px] font-mono text-neutral-600 truncate">
                  Boros market: {market.borosMarketAddress ?? `marketId=${market.borosMarketId}`}
                </p>
                <p className="text-[10px] font-mono text-neutral-600">
                  Last update: {vault.positionLastUpdate ? new Date(vault.positionLastUpdate).toLocaleString() : "--"}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
