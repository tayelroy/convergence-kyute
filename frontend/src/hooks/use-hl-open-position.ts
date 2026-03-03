"use client";

import { useCallback, useEffect, useState } from "react";
import { setCachedWalletAddress } from "@/lib/hl-wallet-cache";

export type HlPerpPosition = {
  coin: string;
  size: number;
  entryPx?: number;
  leverage?: number;
  unrealizedPnl?: number;
};

type UseHlOpenPositionResult = {
  loading: boolean;
  hasOpenPosition: boolean;
  positions: HlPerpPosition[];
  isTestnet: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const getHlTestnetMode = (): boolean => {
  const raw = process.env.NEXT_PUBLIC_HL_TESTNET;
  // Default to testnet for current onboarding/dashboard gate flow.
  if (raw === undefined || raw === "") return true;
  return raw.toLowerCase() === "true";
};

const parsePositions = (data: unknown): HlPerpPosition[] => {
  const root = data as { assetPositions?: unknown[]; perpPositions?: unknown[] } | undefined;
  const positions = root?.assetPositions ?? root?.perpPositions;
  if (!Array.isArray(positions)) return [];

  return positions
    .map((entry) => {
      const item = entry as {
        coin?: string;
        szi?: string | number;
        entryPx?: string | number;
        unrealizedPnl?: string | number;
        leverage?: { value?: string | number };
        position?: {
          coin?: string;
          szi?: string | number;
          entryPx?: string | number;
          unrealizedPnl?: string | number;
          leverage?: { value?: string | number };
        };
      };
      const size = Number(item.position?.szi ?? item.szi ?? 0);
      const coin = String(item.position?.coin ?? item.coin ?? "");
      if (!Number.isFinite(size) || size === 0 || coin.length === 0) return null;

      const entryPxRaw = Number(item.position?.entryPx ?? item.entryPx ?? NaN);
      const pnlRaw = Number(item.position?.unrealizedPnl ?? item.unrealizedPnl ?? NaN);
      const levRaw = Number(item.position?.leverage?.value ?? item.leverage?.value ?? NaN);

      return {
        coin,
        size,
        ...(Number.isFinite(entryPxRaw) ? { entryPx: entryPxRaw } : {}),
        ...(Number.isFinite(pnlRaw) ? { unrealizedPnl: pnlRaw } : {}),
        ...(Number.isFinite(levRaw) ? { leverage: levRaw } : {}),
      } satisfies HlPerpPosition;
    })
    .filter((p): p is HlPerpPosition => p !== null);
};

export function useHlOpenPosition(address?: string): UseHlOpenPositionResult {
  const isTestnet = getHlTestnetMode();
  const [loading, setLoading] = useState(false);
  const [hasOpenPosition, setHasOpenPosition] = useState(false);
  const [positions, setPositions] = useState<HlPerpPosition[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) {
      setHasOpenPosition(false);
      setPositions([]);
      setError(null);
      setLoading(false);
      return;
    }

    setCachedWalletAddress(address);

    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/hyperliquid/relay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "info",
          testnet: isTestnet,
          payload: {
            type: "clearinghouseState",
            user: address.toLowerCase(),
          },
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Hyperliquid relay query failed: ${response.status} ${body}`);
      }

      const envelope = (await response.json()) as { ok: boolean; data?: unknown };
      if (!envelope.ok) {
        throw new Error("Hyperliquid relay returned non-ok response");
      }
      const parsedPositions = parsePositions(envelope.data);
      if (parsedPositions.length > 0) {
        setCachedWalletAddress(address);
      }
      setPositions(parsedPositions);
      setHasOpenPosition(parsedPositions.length > 0);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown position lookup error";
      setError(message);
      setPositions([]);
      setHasOpenPosition(false);
    } finally {
      setLoading(false);
    }
  }, [address, isTestnet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { loading, hasOpenPosition, positions, isTestnet, error, refresh };
}
