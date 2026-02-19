"use client";

import { useEffect, useState } from "react";

export interface AgentSnapshot {
    timestamp: string;
    asset_symbol: string;
    boros_rate: number;
    hyperliquid_rate: number;
    spread_bps: number;
    median_apr: number;
}

interface AgentStatusResponse {
    latest: AgentSnapshot | null;
    history: AgentSnapshot[];
}

export function useAgentStatus() {
    const [data, setData] = useState<AgentStatusResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function fetchStatus() {
            try {
                const res = await fetch("/api/agent-status");
                if (!res.ok) {
                    throw new Error(`Status ${res.status}`);
                }

                const json = (await res.json()) as AgentStatusResponse;
                if (!cancelled) {
                    setData(json);
                    setError(null);
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : "Failed to load agent status";
                if (!cancelled) {
                    setError(message);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        fetchStatus();

        const interval = setInterval(fetchStatus, 30_000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, []);

    return {
        loading,
        error,
        latest: data?.latest ?? null,
        history: data?.history ?? [],
    };
}
