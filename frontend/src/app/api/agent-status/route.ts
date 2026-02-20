import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type SourceKey = "snapshots" | "hedges" | "aiLogs";

interface SourceState {
    ok: boolean;
    error: string | null;
    rows: number;
}

interface AgentStatusResponse {
    latest: unknown | null;
    history: unknown[];
    hedges: unknown[];
    aiLogs: unknown[];
    degraded: boolean;
    warnings: string[];
    generatedAt: string;
    sources: Record<SourceKey, SourceState>;
}

export async function GET() {
    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        const emptyResponse: AgentStatusResponse = {
            latest: null,
            history: [],
            hedges: [],
            aiLogs: [],
            degraded: true,
            warnings: [],
            generatedAt: new Date().toISOString(),
            sources: {
                snapshots: { ok: false, error: "Not queried", rows: 0 },
                hedges: { ok: false, error: "Not queried", rows: 0 },
                aiLogs: { ok: false, error: "Not queried", rows: 0 },
            },
        };

        if (!supabaseUrl || !supabaseAnonKey) {
            const message = "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY";
            emptyResponse.warnings.push(message);
            emptyResponse.sources.snapshots.error = message;
            emptyResponse.sources.hedges.error = message;
            emptyResponse.sources.aiLogs.error = message;
            return NextResponse.json(emptyResponse, { status: 200 });
        }

        const supabase = createClient(supabaseUrl, supabaseAnonKey);

        // Run all three queries in parallel
        const [snapshotsResult, hedgesResult, aiLogsResult] = await Promise.all([
            supabase
                .from("kyute_events")
                .select("timestamp, asset_symbol, boros_apr, hl_apr, spread_bps, vault_balance_eth")
                .eq("event_type", "snapshot")
                .order("timestamp", { ascending: false })
                .limit(50),

            supabase
                .from("kyute_events")
                .select("timestamp, asset_symbol, boros_apr, hl_apr, spread_bps, amount_eth, market_address, status")
                .eq("event_type", "hedge")
                .order("timestamp", { ascending: false })
                .limit(10),

            supabase
                .from("kyute_events")
                .select("timestamp, asset_symbol, boros_apr, hl_apr, spread_bps, risk_score, risk_level, composite_score, reason, action")
                .eq("event_type", "ai_trigger")
                .order("timestamp", { ascending: false })
                .limit(10),
        ]);

        const warnings: string[] = [];
        const snapshots = snapshotsResult.data ?? [];
        const hedges = hedgesResult.data ?? [];
        const aiLogs = aiLogsResult.data ?? [];

        const response: AgentStatusResponse = {
            latest: snapshots[0] ?? null,
            history: snapshots,
            hedges,
            aiLogs,
            degraded: false,
            warnings,
            generatedAt: new Date().toISOString(),
            sources: {
                snapshots: {
                    ok: !snapshotsResult.error,
                    error: snapshotsResult.error?.message ?? null,
                    rows: snapshots.length,
                },
                hedges: {
                    ok: !hedgesResult.error,
                    error: hedgesResult.error?.message ?? null,
                    rows: hedges.length,
                },
                aiLogs: {
                    ok: !aiLogsResult.error,
                    error: aiLogsResult.error?.message ?? null,
                    rows: aiLogs.length,
                },
            },
        };

        if (snapshotsResult.error) {
            const message = `[snapshots] ${snapshotsResult.error.message}`;
            console.error("[AgentStatus] snapshots query failed:", snapshotsResult.error.message);
            warnings.push(message);
            response.degraded = true;
        }
        if (hedgesResult.error) {
            const message = `[hedges] ${hedgesResult.error.message}`;
            console.error("[AgentStatus] hedges query failed:", hedgesResult.error.message);
            warnings.push(message);
            response.degraded = true;
        }
        if (aiLogsResult.error) {
            const message = `[aiLogs] ${aiLogsResult.error.message}`;
            console.error("[AgentStatus] ai_logs query failed:", aiLogsResult.error.message);
            warnings.push(message);
            response.degraded = true;
        }

        return NextResponse.json(response, { status: 200 });

    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("[AgentStatus] Unexpected error:", message);
        return NextResponse.json(
            {
                latest: null,
                history: [],
                hedges: [],
                aiLogs: [],
                degraded: true,
                warnings: [`Unexpected API error: ${message}`],
                generatedAt: new Date().toISOString(),
                sources: {
                    snapshots: { ok: false, error: message, rows: 0 },
                    hedges: { ok: false, error: message, rows: 0 },
                    aiLogs: { ok: false, error: message, rows: 0 },
                },
            },
            { status: 200 }
        );
    }
}