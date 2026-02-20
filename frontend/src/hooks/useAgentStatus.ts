"use client";

import { useEffect, useState } from "react";

export interface AgentSnapshot {
    timestamp: string;
    asset_symbol: string;
    boros_apr: number;
    hl_apr: number;
    spread_bps: number;
    vault_balance_eth: number;
}

export interface HedgeEvent {
    timestamp: string;
    asset_symbol: string;
    boros_apr: number;
    hl_apr: number;
    spread_bps: number;
    amount_eth: number;
    market_address: string;
    status: string;
}

export interface AiDecision {
    timestamp: string;
    asset_symbol: string;
    boros_apr: number;
    hl_apr: number;
    spread_bps: number;
    risk_score: number;
    risk_level: string;
    composite_score: number;
    reason: string;
    action: string;
}

interface SourceState {
    ok: boolean;
    error: string | null;
    rows: number;
}

interface AgentStatusResponse {
    latest:  AgentSnapshot | null;
    history: AgentSnapshot[];
    hedges:  HedgeEvent[];
    aiLogs:  AiDecision[];
    degraded?: boolean;
    warnings?: string[];
    generatedAt?: string;
    sources?: {
        snapshots: SourceState;
        hedges: SourceState;
        aiLogs: SourceState;
    };
}

export function useAgentStatus() {
    const [data, setData] = useState<AgentStatusResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function fetchStatus() {
            try {
                const res = await fetch("/api/agent-status");
                if (!res.ok) throw new Error(`Status ${res.status}`);
                const json = (await res.json()) as AgentStatusResponse;
                if (!cancelled) {
                    setData(json);
                    setLastUpdated(json.generatedAt ?? new Date().toISOString());
                    if (json.degraded) {
                        const warningMessage = json.warnings?.[0] ?? "Data feed degraded";
                        setError(`Degraded mode: ${warningMessage}`);
                    } else {
                        setError(null);
                    }
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : "Failed to load agent status";
                if (!cancelled) {
                    setError(message);
                }
            } finally {
                if (!cancelled) setLoading(false);
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
        degraded: data?.degraded ?? false,
        warnings: data?.warnings ?? [],
        sources: data?.sources ?? null,
        lastUpdated,
        latest:  data?.latest  ?? null,
        history: data?.history ?? [],
        hedges:  data?.hedges  ?? [],
        aiLogs:  data?.aiLogs  ?? [],
    };
}