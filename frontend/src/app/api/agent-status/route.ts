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
    chainlinkAutomation: unknown[];
    chainlinkFunctions: unknown[];
    chainlinkFeed: unknown[];
    chainlinkCcip: unknown[];
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
            chainlinkAutomation: [],
            chainlinkFunctions: [],
            chainlinkFeed: [],
            chainlinkCcip: [],
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

        // Run all event queries in parallel
        const [snapshotsResult, hedgesResult, aiLogsResult, automationResult, functionsResult, feedResult, ccipResult] = await Promise.all([
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

            supabase
                .from("kyute_events")
                .select("timestamp, status, reason, action")
                .eq("event_type", "chainlink_automation")
                .order("timestamp", { ascending: false })
                .limit(10),

            supabase
                .from("kyute_events")
                .select("timestamp, action, status, spread_bps, risk_score, reason")
                .eq("event_type", "chainlink_functions")
                .order("timestamp", { ascending: false })
                .limit(10),

            supabase
                .from("kyute_events")
                .select("timestamp, status, reason, amount_eth, market_address")
                .eq("event_type", "chainlink_feed")
                .order("timestamp", { ascending: false })
                .limit(10),

            supabase
                .from("kyute_events")
                .select("timestamp, action, status, reason, market_address, amount_eth")
                .eq("event_type", "chainlink_ccip")
                .order("timestamp", { ascending: false })
                .limit(10),
        ]);

        const warnings: string[] = [];
        const snapshots = snapshotsResult.data ?? [];
        const hedges = hedgesResult.data ?? [];
        const aiLogs = aiLogsResult.data ?? [];
        const chainlinkAutomation = automationResult.data ?? [];
        const chainlinkFunctions = functionsResult.data ?? [];
        const chainlinkFeedRaw = feedResult.data ?? [];
        const chainlinkCcip = ccipResult.data ?? [];

        const chainlinkFeed = chainlinkFeedRaw.map((item) => {
            const reason = String(item.reason ?? "");
            const roundMatch = reason.match(/round=(\d+)/);
            return {
                ...item,
                feed_round: roundMatch?.[1],
            };
        });

        const response: AgentStatusResponse = {
            latest: snapshots[0] ?? null,
            history: snapshots,
            hedges,
            aiLogs,
            chainlinkAutomation,
            chainlinkFunctions,
            chainlinkFeed,
            chainlinkCcip,
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
        if (automationResult.error) {
            const message = `[chainlink_automation] ${automationResult.error.message}`;
            console.error("[AgentStatus] chainlink_automation query failed:", automationResult.error.message);
            warnings.push(message);
            response.degraded = true;
        }
        if (functionsResult.error) {
            const message = `[chainlink_functions] ${functionsResult.error.message}`;
            console.error("[AgentStatus] chainlink_functions query failed:", functionsResult.error.message);
            warnings.push(message);
            response.degraded = true;
        }
        if (feedResult.error) {
            const message = `[chainlink_feed] ${feedResult.error.message}`;
            console.error("[AgentStatus] chainlink_feed query failed:", feedResult.error.message);
            warnings.push(message);
            response.degraded = true;
        }
        if (ccipResult.error) {
            const message = `[chainlink_ccip] ${ccipResult.error.message}`;
            console.error("[AgentStatus] chainlink_ccip query failed:", ccipResult.error.message);
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
                chainlinkAutomation: [],
                chainlinkFunctions: [],
                chainlinkFeed: [],
                chainlinkCcip: [],
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