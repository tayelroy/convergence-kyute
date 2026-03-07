"use client";

import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";

type VaultStateResponse = {
  ok: boolean;
  error?: string;
  vaultAddress?: string;
  totalAssetsWei?: string;
  totalAssetsEth?: number;
  userAssetsWei?: string;
  userAssetsEth?: number;
  sharesWei?: string;
  hasPosition?: boolean;
  hasBorosHedge?: boolean;
  hlNotionalWei?: string;
  hlNotionalEth?: number;
  currentHedgeNotionalWei?: string;
  currentHedgeAmountYu?: number;
  currentHedgeIsLong?: boolean;
  positionLastUpdate?: number | null;
  yuToken?: string;
};

const ZERO = BigInt(0);

export function useKyuteVaultState(userAddress?: string, yuToken?: Address) {
  const [state, setState] = useState<VaultStateResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const params = new URLSearchParams();
        if (userAddress) params.set("walletAddress", userAddress);
        if (yuToken) params.set("yuToken", yuToken);
        const res = await fetch(`/api/vault-state?${params.toString()}`, {
          cache: "no-store",
        });
        const body = (await res.json()) as VaultStateResponse;
        if (!res.ok || !body.ok) {
          throw new Error(body.error ?? `vault-state failed (${res.status})`);
        }
        if (!cancelled) {
          setState(body);
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            ok: false,
            error: error instanceof Error ? error.message : "vault-state unavailable",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    const id = setInterval(() => void run(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [userAddress, yuToken]);

  return useMemo(() => {
    const totalAssetsWei = BigInt(state?.totalAssetsWei ?? "0");
    const userAssetsWei = BigInt(state?.userAssetsWei ?? "0");
    const sharesWei = BigInt(state?.sharesWei ?? "0");
    const hlNotionalWei = BigInt(state?.hlNotionalWei ?? "0");
    const currentHedgeNotionalWei = BigInt(state?.currentHedgeNotionalWei ?? "0");

    return {
      configured: Boolean(state?.ok && state?.vaultAddress),
      loading,
      error: state?.ok === false ? state.error ?? null : null,
      vaultAddress: state?.vaultAddress,
      totalAssetsWei,
      totalAssetsEth: Number(state?.totalAssetsEth ?? 0),
      userAssetsWei,
      userAssetsEth: Number(state?.userAssetsEth ?? 0),
      sharesWei,
      hasPosition: Boolean(state?.hasPosition),
      hasBorosHedge: Boolean(state?.hasBorosHedge),
      hlNotionalWei: hlNotionalWei ?? ZERO,
      hlNotionalEth: Number(state?.hlNotionalEth ?? 0),
      currentHedgeNotionalWei: currentHedgeNotionalWei ?? ZERO,
      currentHedgeAmountYu: Number(state?.currentHedgeAmountYu ?? 0),
      currentHedgeIsLong: Boolean(state?.currentHedgeIsLong),
      positionLastUpdate: state?.positionLastUpdate ?? null,
      yuToken: state?.yuToken ?? null,
    };
  }, [loading, state]);
}
