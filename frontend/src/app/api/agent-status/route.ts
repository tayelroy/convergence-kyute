import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseAnonKey) {
            return NextResponse.json(
                { error: "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY" },
                { status: 500 }
            );
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

        // Surface any errors
        if (snapshotsResult.error) {
            console.error("[AgentStatus] snapshots query failed:", snapshotsResult.error.message);
            return NextResponse.json({ error: snapshotsResult.error.message }, { status: 500 });
        }
        if (hedgesResult.error) {
            console.error("[AgentStatus] hedges query failed:", hedgesResult.error.message);
            return NextResponse.json({ error: hedgesResult.error.message }, { status: 500 });
        }
        if (aiLogsResult.error) {
            console.error("[AgentStatus] ai_logs query failed:", aiLogsResult.error.message);
            return NextResponse.json({ error: aiLogsResult.error.message }, { status: 500 });
        }

        const snapshots = snapshotsResult.data ?? [];

        return NextResponse.json({
            latest:   snapshots[0] ?? null,
            history:  snapshots,
            hedges:   hedgesResult.data ?? [],
            aiLogs:   aiLogsResult.data ?? [],
        });

    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("[AgentStatus] Unexpected error:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}