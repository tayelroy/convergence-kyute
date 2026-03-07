import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

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

type HedgeDirection = "open" | "close" | "unknown";
type HedgeSide = "LONG" | "SHORT" | null;

interface RawHedgeEvent {
    timestamp: string;
    asset_symbol: string | null;
    boros_apr: number | null;
    hl_apr: number | null;
    spread_bps: number | null;
    amount_eth: number | null;
    market_address: string | null;
    status: string | null;
    reason: string | null;
    action: string | null;
}

interface NormalizedHedgeEvent extends RawHedgeEvent {
    hedge_direction: HedgeDirection;
    hedge_side: HedgeSide;
    hedge_delta_eth: number;
    running_size_eth: number;
}

const toMillis = (timestamp: string): number => {
    const ms = new Date(timestamp).getTime();
    return Number.isFinite(ms) ? ms : 0;
};

const parseHedgeDirection = (row: RawHedgeEvent): HedgeDirection => {
    const action = String(row.action ?? "").toLowerCase();
    const reason = String(row.reason ?? "").toLowerCase();

    if (
        action.includes("open_hedge") ||
        action.includes("hedge_open") ||
        reason.includes("shouldhedge=true") ||
        reason.includes("after=true")
    ) {
        return "open";
    }
    if (
        action.includes("close_hedge") ||
        action.includes("hedge_close") ||
        reason.includes("shouldhedge=false") ||
        reason.includes("after=false")
    ) {
        return "close";
    }
    return "unknown";
};

const parseHedgeSide = (row: RawHedgeEvent): HedgeSide => {
    const text = `${row.action ?? ""} ${row.reason ?? ""} ${row.status ?? ""}`.toLowerCase();
    if (text.includes("islong=false") || text.includes("side=short") || text.includes(" short")) {
        return "SHORT";
    }
    if (text.includes("islong=true") || text.includes("side=long") || text.includes(" long")) {
        return "LONG";
    }
    return null;
};

const normalizeHedgeEvents = (rows: RawHedgeEvent[]): NormalizedHedgeEvent[] => {
    const sortedAsc = [...rows].sort((a, b) => toMillis(a.timestamp) - toMillis(b.timestamp));
    const runningByAsset = new Map<string, { running: number; side: HedgeSide }>();

    const normalizedAsc = sortedAsc.map((row) => {
        const assetKey = String(row.asset_symbol ?? "UNKNOWN").toUpperCase();
        const amountEth = Number(row.amount_eth ?? 0);
        const amount = Number.isFinite(amountEth) ? Math.max(0, amountEth) : 0;
        const direction = parseHedgeDirection(row);
        const parsedSide = parseHedgeSide(row);
        const isSuccess = String(row.status ?? "").toLowerCase() === "success";
        const current = runningByAsset.get(assetKey) ?? { running: 0, side: null };
        let running = current.running;
        let side = current.side;
        const previousRunning = running;

        if (isSuccess) {
            if (direction === "open") {
                running += amount;
                side = parsedSide ?? side;
            } else if (direction === "close") {
                running = Math.max(0, running - amount);
                if (running === 0) side = null;
            } else if (amount > 0) {
                // Backward compatibility for older rows that stored absolute hedge amount only.
                running = amount;
                side = parsedSide ?? side;
            }

            if (running > 0 && parsedSide) {
                side = parsedSide;
            }
            if (running === 0) {
                side = null;
            }
        }

        runningByAsset.set(assetKey, { running, side });

        const delta = running - previousRunning;
        return {
            ...row,
            amount_eth: amount,
            hedge_direction: direction,
            hedge_side: running > 0 ? side : null,
            hedge_delta_eth: delta,
            running_size_eth: running,
        };
    });

    return normalizedAsc.sort((a, b) => toMillis(b.timestamp) - toMillis(a.timestamp));
};

const findLatestRunJson = (scriptDirName: string): string | null => {
    const broadcastRoot = path.resolve(process.cwd(), "../contracts/broadcast", scriptDirName);
    if (!fs.existsSync(broadcastRoot)) return null;

    let newestFile: string | null = null;
    let newestMtime = -1;
    for (const entry of fs.readdirSync(broadcastRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const runLatest = path.join(broadcastRoot, entry.name, "run-latest.json");
        if (!fs.existsSync(runLatest)) continue;
        const mtime = fs.statSync(runLatest).mtimeMs;
        if (mtime > newestMtime) {
            newestMtime = mtime;
            newestFile = runLatest;
        }
    }
    return newestFile;
};

const parseLatestContractAddress = (runFile: string, preferredContractNames: string[]): string | null => {
    try {
        const raw = fs.readFileSync(runFile, "utf8");
        const json = JSON.parse(raw) as {
            transactions?: Array<{ contractName?: string; contractAddress?: string; transactionType?: string }>;
            receipts?: Array<{ contractAddress?: string }>;
        };
        const txs = json.transactions ?? [];
        const preferred = txs.find((tx) =>
            preferredContractNames.includes(String(tx.contractName ?? "")) &&
            /^0x[a-fA-F0-9]{40}$/.test(String(tx.contractAddress ?? "")),
        );
        if (preferred?.contractAddress) return preferred.contractAddress.toLowerCase();

        const created = [...txs]
            .reverse()
            .find((tx) =>
                String(tx.transactionType ?? "").toUpperCase() === "CREATE" &&
                /^0x[a-fA-F0-9]{40}$/.test(String(tx.contractAddress ?? "")),
            );
        if (created?.contractAddress) return created.contractAddress.toLowerCase();

        const receipt = [...(json.receipts ?? [])]
            .reverse()
            .find((entry) => /^0x[a-fA-F0-9]{40}$/.test(String(entry.contractAddress ?? "")));
        return receipt?.contractAddress?.toLowerCase() ?? null;
    } catch {
        return null;
    }
};

const resolveActiveRouterAddress = (): string | null => {
    const envCandidate = String(process.env.BOROS_ROUTER_ADDRESS ?? process.env.NEXT_PUBLIC_BOROS_ROUTER_ADDRESS ?? "")
        .trim()
        .toLowerCase();
    if (/^0x[a-fA-F0-9]{40}$/.test(envCandidate) && envCandidate !== "0x0000000000000000000000000000000000000000") {
        return envCandidate;
    }

    const runFile = findLatestRunJson("DeployMockBorosRouter.s.sol");
    if (!runFile) return null;
    return parseLatestContractAddress(runFile, ["MockBorosRouter"]);
};

const CRE_LOG_PATH = "/tmp/kyute_cre.log";
const CRE_USER_LOG_RE = /^(\d{4}-\d{2}-\d{2}T[^\s]+)\s+\[USER LOG\]\s+(.*)$/;
const CRE_RESULT_MARKER_RE = /^✓ Workflow Simulation Result:\s*$/;

const parseCreWorkflowLogEvents = (): Array<{ timestamp: string; status: string; reason: string; action: string }> => {
    if (!fs.existsSync(CRE_LOG_PATH)) return [];
    try {
        const lines = fs.readFileSync(CRE_LOG_PATH, "utf8").split(/\r?\n/).filter(Boolean);
        const events: Array<{ timestamp: string; status: string; reason: string; action: string }> = [];
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            const userLog = line.match(CRE_USER_LOG_RE);
            if (userLog) {
                const [, timestamp, message] = userLog;
                events.push({
                    timestamp,
                    status: "success",
                    reason: message,
                    action: "CRE_USER_LOG",
                });
                continue;
            }
            if (CRE_RESULT_MARKER_RE.test(line)) {
                const next = (lines[i + 1] ?? "").trim();
                if (next.startsWith("\"") && next.endsWith("\"")) {
                    events.push({
                        timestamp: new Date().toISOString(),
                        status: "success",
                        reason: `Workflow Simulation Result: ${next}`,
                        action: "WORKFLOW_RESULT",
                    });
                }
            }
        }
        return events.sort((a, b) => toMillis(b.timestamp) - toMillis(a.timestamp)).slice(0, 30);
    } catch {
        return [];
    }
};

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
        const activeRouterAddress = resolveActiveRouterAddress();

        // Run all event queries in parallel
        const [snapshotsResult, hedgesResult, aiLogsResult, automationResult, functionsResult, feedResult, ccipResult] = await Promise.all([
            supabase
                .from("kyute_events")
                .select("timestamp, asset_symbol, boros_apr, hl_apr, spread_bps, vault_balance_eth, market_address")
                .eq("event_type", "snapshot")
                .order("timestamp", { ascending: false })
                .limit(50),

            supabase
                .from("kyute_events")
                .select("timestamp, asset_symbol, boros_apr, hl_apr, spread_bps, amount_eth, market_address, status, reason, action")
                .eq("event_type", "hedge")
                .order("timestamp", { ascending: false })
                .limit(100),

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
        const snapshotsRaw = snapshotsResult.data ?? [];
        const hedgesRaw = (hedgesResult.data ?? []) as RawHedgeEvent[];
        const snapshots = activeRouterAddress
            ? snapshotsRaw.filter((row) => String((row as { market_address?: string | null }).market_address ?? "").toLowerCase() === activeRouterAddress)
            : snapshotsRaw;
        const hedges = normalizeHedgeEvents(
            activeRouterAddress
                ? hedgesRaw.filter((row) => String(row.market_address ?? "").toLowerCase() === activeRouterAddress)
                : hedgesRaw,
        );
        const aiLogs = aiLogsResult.data ?? [];
        const chainlinkAutomationRows = (automationResult.data ?? []) as Array<{
            timestamp: string;
            status: string;
            reason: string;
            action: string;
        }>;
        const chainlinkAutomation = [...parseCreWorkflowLogEvents(), ...chainlinkAutomationRows]
            .sort((a, b) => toMillis(b.timestamp) - toMillis(a.timestamp))
            .slice(0, 40);
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
