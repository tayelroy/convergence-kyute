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
        const { data, error } = await supabase
            .from("funding_rates")
            .select("timestamp, asset_symbol, boros_rate, hyperliquid_rate, spread_bps, median_apr")
            .order("timestamp", { ascending: false })
            .limit(50);

        if (error) {
            console.error("[AgentStatus] Failed to query funding_rates:", error.message);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({
            latest: data?.[0] ?? null,
            history: data ?? [],
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("[AgentStatus] Unexpected error:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
