"use client";

import { useEffect, useMemo, useState } from "react";

type BorosMockResponse = {
  amount: string;
  isLong: boolean;
};

const POLL_INTERVAL_MS = 30_000;
const WEI_PER_TOKEN = 1e18;

const isDemoMode = (): boolean => {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
};

export function useBorosMockHedge(userAddress?: string, tokenAddress?: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("0");
  const [isLong, setIsLong] = useState(false);

  useEffect(() => {
    if (!isDemoMode() || !userAddress) {
      setAmount("0");
      setIsLong(false);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchPosition = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ user: userAddress });
        if (tokenAddress) params.set("token", tokenAddress);
        const response = await fetch(`/api/boros-mock?${params.toString()}`);
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const payload = (await response.json()) as BorosMockResponse;
        if (!cancelled) {
          setAmount(payload.amount ?? "0");
          setIsLong(Boolean(payload.isLong));
          setError(null);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to fetch Boros mock position";
        if (!cancelled) setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchPosition();
    const interval = setInterval(fetchPosition, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tokenAddress, userAddress]);

  const amountYu = useMemo(() => {
    const asNumber = Number(amount);
    if (!Number.isFinite(asNumber) || asNumber <= 0) return 0;
    return asNumber / WEI_PER_TOKEN;
  }, [amount]);

  return {
    enabled: isDemoMode(),
    loading,
    error,
    amount,
    amountYu,
    isLong,
    isActive: amount !== "0",
  };
}
