"use client";

import { useEffect, useMemo, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { getCachedWalletAddress, setCachedWalletAddress } from "@/lib/hl-wallet-cache";

type PositionPoint = {
  timestamp: number;
  totalOpen: number;
};

type PositionSide = "LONG" | "SHORT" | null;

type DashboardState = {
  assetSymbol: string;
  pair: string;
  loading: boolean;
  error: string | null;
  midPrice: number | null;
  hlFundingApr: number | null;
  hlSpreadBps: number | null;
  borosImpliedApr: number | null;
  midChangePct: number | null;
  totalOpenNow: number;
  positionSide: PositionSide;
  positionLastUpdate: number | null;
  historyPoints: PositionPoint[];
};

type UseHyperliquidDashboardOptions = {
  coin?: string;
  pair?: string;
  borosMarketAddress?: string | null;
};

const isTestnet = () => {
  const raw = process.env.NEXT_PUBLIC_HL_TESTNET;
  if (!raw) return true;
  return raw.toLowerCase() === "true";
};

const relayInfo = async (payload: Record<string, unknown>, testnet: boolean): Promise<unknown> => {
  const res = await fetch("/api/hyperliquid/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "info",
      testnet,
      payload,
    }),
  });
  const body = (await res.json()) as { ok: boolean; status?: number; data?: unknown; error?: string };
  if (!res.ok || !body.ok) {
    throw new Error(`relay info failed http=${res.status} upstream=${body.status ?? "n/a"} ${body.error ?? ""}`);
  }
  return body.data;
};

const toNumber = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const firstLevelPx = (side: unknown): number | null => {
  if (!Array.isArray(side) || side.length === 0) return null;
  const level = side[0] as unknown;
  if (Array.isArray(level)) return toNumber(level[0]);
  if (typeof level === "object" && level !== null) {
    const row = level as { px?: string | number; p?: string | number };
    return toNumber(row.px ?? row.p);
  }
  return null;
};

const parseSpreadBpsFromL2Book = (data: unknown): number | null => {
  const root = data as { levels?: [unknown, unknown] } | undefined;
  const levels = root?.levels;
  if (!Array.isArray(levels) || levels.length < 2) return null;
  const bestBid = firstLevelPx(levels[0]);
  const bestAsk = firstLevelPx(levels[1]);
  if (bestBid == null || bestAsk == null || bestBid <= 0 || bestAsk <= 0 || bestAsk < bestBid) return null;
  const mid = (bestBid + bestAsk) / 2;
  if (!Number.isFinite(mid) || mid <= 0) return null;
  return ((bestAsk - bestBid) / mid) * 10_000;
};

const parseCurrentOpenFromClearinghouse = (
  data: unknown,
  coin = "ETH",
): { totalOpen: number; side: PositionSide; signedOpen: number } => {
  const root = data as { assetPositions?: Array<{ position?: { coin?: string; szi?: string | number } }> } | undefined;
  const arr = root?.assetPositions;
  if (!Array.isArray(arr)) return { totalOpen: 0, side: null, signedOpen: 0 };
  const signedTotal = arr.reduce((acc, row) => {
    const c = String(row?.position?.coin ?? "");
    if (c !== coin) return acc;
    const szi = Number(row?.position?.szi ?? 0);
    if (!Number.isFinite(szi)) return acc;
    return acc + szi;
  }, 0);

  if (signedTotal > 0) return { totalOpen: signedTotal, side: "LONG", signedOpen: signedTotal };
  if (signedTotal < 0) return { totalOpen: Math.abs(signedTotal), side: "SHORT", signedOpen: signedTotal };
  return { totalOpen: 0, side: null, signedOpen: 0 };
};

const cacheKey = (address: string, coin: string) => `hl_dashboard_points_${coin.toLowerCase()}_${address.toLowerCase()}`;

const inferWalletFromSessionCache = (): string | null => {
  if (typeof window === "undefined") return null;
  try {
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (!key) continue;
      if (!key.startsWith("hl_dashboard_points_")) continue;
      const address = key.split("_").pop()?.trim() ?? "";
      if (/^0x[a-fA-F0-9]{40}$/.test(address)) return address.toLowerCase();
    }
  } catch {
    // ignore storage access issues
  }
  return null;
};

const fetchPersistedSeries = async (wallet: string, testnet: boolean, coin: string): Promise<PositionPoint[]> => {
  const qs = new URLSearchParams({
    wallet,
    coin,
    testnet: testnet ? "true" : "false",
  });
  const response = await fetch(`/api/position-history?${qs.toString()}`);
  const body = (await response.json()) as { ok: boolean; points?: Array<{ timestamp: string; total_open: number }>; error?: string };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `position-history failed (${response.status})`);
  }
  return (body.points ?? [])
    .map((p) => ({
      timestamp: new Date(p.timestamp).getTime(),
      totalOpen: Number(p.total_open),
    }))
    .filter((p) => Number.isFinite(p.timestamp) && Number.isFinite(p.totalOpen));
};

export function useHyperliquidDashboard(options: UseHyperliquidDashboardOptions = {}) {
  const account = useActiveAccount();
  const assetSymbol = String(options.coin ?? "ETH").trim().toUpperCase();
  const pair = String(options.pair ?? `${assetSymbol}USDC`).trim().toUpperCase();
  const borosMarketAddress = String(options.borosMarketAddress ?? "").trim().toLowerCase();
  const [state, setState] = useState<DashboardState>({
    assetSymbol,
    pair,
    loading: true,
    error: null,
    midPrice: null,
    hlFundingApr: null,
    hlSpreadBps: null,
    borosImpliedApr: null,
    midChangePct: null,
    totalOpenNow: 0,
    positionSide: null,
    positionLastUpdate: null,
    historyPoints: [],
  });

  useEffect(() => {
    let cancelled = false;
    const testnet = isTestnet();

    const run = async () => {
      const connectedWallet = account?.address?.toLowerCase();
      const cachedWallet = getCachedWalletAddress();
      const inferredWallet = inferWalletFromSessionCache();
      const wallet = connectedWallet || cachedWallet || inferredWallet;
      setCachedWalletAddress(connectedWallet);

      // Hydrate from cached points to avoid blank graph during hard refreshes.
      if (wallet) {
        try {
          const raw = sessionStorage.getItem(cacheKey(wallet, assetSymbol));
          if (raw) {
            const cached = JSON.parse(raw) as PositionPoint[];
            if (Array.isArray(cached) && cached.length > 0) {
              setState((s) => ({
                ...s,
                historyPoints: cached,
                totalOpenNow: cached[cached.length - 1].totalOpen,
                positionLastUpdate: cached[cached.length - 1].timestamp,
              }));
            }
          }
        } catch {
          // ignore cache parse errors
        }
      }

      setState((s) => ({ ...s, loading: true, error: null }));

      try {
        const [midsRaw, metaCtxRaw, ratesSyncRaw, l2BookRaw] = await Promise.all([
          relayInfo({ type: "allMids" }, testnet),
          relayInfo({ type: "metaAndAssetCtxs" }, testnet),
          fetch(`/api/rates-sync?${new URLSearchParams({
            coin: assetSymbol,
            ...(borosMarketAddress ? { marketAddress: borosMarketAddress } : {}),
          }).toString()}`).then(async (res) => {
            const body = (await res.json()) as {
              ok: boolean;
              error?: string;
              funding?: { funding_apr?: number };
              boros?: { implied_apr?: number };
            };
            if (!res.ok || !body.ok) {
              throw new Error(body.error ?? `rates-sync failed (${res.status})`);
            }
            return body;
          }),
          relayInfo({ type: "l2Book", coin: assetSymbol }, false),
        ]);

        const mids = midsRaw as Record<string, string>;
        const midPrice = toNumber(mids[assetSymbol]);

        const [, assetCtxs] = metaCtxRaw as [
          { universe: Array<{ name: string }> },
          Array<{ markPx?: string; prevDayPx?: string }>,
        ];
        const [meta] = metaCtxRaw as [{ universe: Array<{ name: string }> }, unknown[]];
        const assetIndex = meta.universe.findIndex((u) => u.name === assetSymbol);
        const assetCtx = assetIndex >= 0 ? assetCtxs[assetIndex] : undefined;
        const mark = toNumber(assetCtx?.markPx);
        const prev = toNumber(assetCtx?.prevDayPx);
        const midChangePct = mark != null && prev != null && prev > 0 ? ((mark - prev) / prev) * 100 : null;

        const hlFundingApr = toNumber(ratesSyncRaw.funding?.funding_apr);
        const hlSpreadBps = parseSpreadBpsFromL2Book(l2BookRaw);
        const borosImpliedApr = toNumber(ratesSyncRaw.boros?.implied_apr);
        let historyPoints: PositionPoint[] = [];
        let totalOpenNow = 0;
        let positionSide: PositionSide = null;
        let positionLastUpdate: number | null = null;

        if (wallet) {
          const [persistedResult, clearinghouseResult] = await Promise.allSettled([
            fetchPersistedSeries(wallet, testnet, assetSymbol),
            relayInfo({ type: "clearinghouseState", user: wallet }, testnet),
          ]);
          if (persistedResult.status === "fulfilled") {
            historyPoints = persistedResult.value;
          }
          if (clearinghouseResult.status === "fulfilled") {
            const currentPosition = parseCurrentOpenFromClearinghouse(clearinghouseResult.value, assetSymbol);
            const currentOpen = currentPosition.totalOpen;
            positionSide = currentPosition.side;
            positionLastUpdate = Date.now();
            if (historyPoints.length === 0 && currentOpen > 0) {
              historyPoints = [{ timestamp: Date.now(), totalOpen: currentPosition.signedOpen }];
            }
            if (historyPoints.length > 0) {
              const last = historyPoints[historyPoints.length - 1];
              if (Math.abs(last.totalOpen - currentPosition.signedOpen) > 1e-9) {
                historyPoints = [...historyPoints, { timestamp: Date.now(), totalOpen: currentPosition.signedOpen }];
              }
            }
            totalOpenNow =
              currentOpen > 0
                ? currentOpen
                : historyPoints.length > 0
                ? Math.abs(historyPoints[historyPoints.length - 1].totalOpen)
                : 0;
          } else {
            totalOpenNow = historyPoints.length > 0 ? Math.abs(historyPoints[historyPoints.length - 1].totalOpen) : 0;
          }
          if (positionLastUpdate == null && historyPoints.length > 0) {
            positionLastUpdate = historyPoints[historyPoints.length - 1].timestamp;
          }

          try {
            sessionStorage.setItem(cacheKey(wallet, assetSymbol), JSON.stringify(historyPoints));
          } catch {
            // ignore storage failures
          }
        }

        if (!cancelled) {
          setState({
            assetSymbol,
            pair,
            loading: false,
            error: null,
            midPrice,
            hlFundingApr,
            hlSpreadBps,
            borosImpliedApr,
            midChangePct,
            totalOpenNow,
            positionSide,
            positionLastUpdate,
            historyPoints,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to fetch Hyperliquid dashboard data";
        if (!cancelled) {
          setState((s) => ({ ...s, assetSymbol, pair, loading: false, error: message }));
        }
      }
    };

    void run();
    const id = setInterval(() => void run(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [account?.address, assetSymbol, borosMarketAddress, pair]);

  return useMemo(() => state, [state]);
}
