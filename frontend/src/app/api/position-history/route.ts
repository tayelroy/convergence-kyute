import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Fill = {
  coin?: string;
  side?: "B" | "A";
  sz?: string;
  time?: number;
};

type Point = {
  timestamp: string;
  total_open: number;
};

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

const buildSeriesFromFills = (fills: Fill[], coin: string): Point[] => {
  const relevant = fills
    .filter((f) => String(f.coin ?? "").toUpperCase() === coin.toUpperCase())
    .sort((a, b) => Number(a.time ?? 0) - Number(b.time ?? 0));

  let running = 0;
  const points: Point[] = [];
  for (const fill of relevant) {
    const sz = Number(fill.sz ?? 0);
    if (!Number.isFinite(sz) || sz <= 0) continue;
    running += fill.side === "B" ? sz : -sz;
    points.push({
      timestamp: new Date(Number(fill.time ?? Date.now())).toISOString(),
      total_open: running,
    });
  }
  return points;
};

const dedupePointsByTimestamp = (points: Point[]): Point[] => {
  const byTs = new Map<string, Point>();
  for (const point of points) {
    byTs.set(point.timestamp, point);
  }
  return Array.from(byTs.values()).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
};

const fetchFillsByTime = async (wallet: string, testnet: boolean): Promise<Fill[]> => {
  const baseUrl = testnet ? "https://api.hyperliquid-testnet.xyz" : "https://api.hyperliquid.xyz";
  const now = Date.now();
  const startTime = now - 30 * 24 * 60 * 60 * 1000;
  const response = await fetch(`${baseUrl}/info`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "userFillsByTime",
      user: wallet.toLowerCase(),
      startTime,
      endTime: now,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Hyperliquid userFillsByTime failed ${response.status}: ${body}`);
  }
  return (await response.json()) as Fill[];
};

const fetchCurrentOpen = async (wallet: string, testnet: boolean, coin: string): Promise<number> => {
  const baseUrl = testnet ? "https://api.hyperliquid-testnet.xyz" : "https://api.hyperliquid.xyz";
  const response = await fetch(`${baseUrl}/info`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "clearinghouseState",
      user: wallet.toLowerCase(),
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Hyperliquid clearinghouseState failed ${response.status}: ${body}`);
  }
  const data = (await response.json()) as {
    assetPositions?: Array<{ position?: { coin?: string; szi?: string | number } }>;
  };
  const positions = Array.isArray(data.assetPositions) ? data.assetPositions : [];
  return positions.reduce((sum, row) => {
    const rowCoin = String(row?.position?.coin ?? "").toUpperCase();
    if (rowCoin !== coin.toUpperCase()) return sum;
    const szi = Number(row?.position?.szi ?? 0);
    if (!Number.isFinite(szi)) return sum;
    return sum + szi;
  }, 0);
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const wallet = (url.searchParams.get("wallet") ?? "").trim();
    const coin = (url.searchParams.get("coin") ?? "ETH").trim().toUpperCase();
    const testnet = (url.searchParams.get("testnet") ?? "true").toLowerCase() === "true";

    if (!WALLET_RE.test(wallet)) {
      return NextResponse.json({ ok: false, error: "Invalid wallet address" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { ok: false, error: "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE key (service role or anon)" },
        { status: 500 },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: existing, error: existingError } = await supabase
      .from("hl_position_history")
      .select("timestamp,total_open")
      .eq("network", testnet ? "testnet" : "mainnet")
      .eq("wallet_address", wallet.toLowerCase())
      .eq("coin", coin)
      .order("timestamp", { ascending: true })
      .limit(2000);

    if (existingError) {
      throw new Error(`Supabase read failed: ${existingError.message}`);
    }

    const pointsFromDb = (existing ?? []) as Point[];
    const latestTs = pointsFromDb.length > 0 ? new Date(pointsFromDb[pointsFromDb.length - 1].timestamp).getTime() : 0;
    const isFresh = latestTs > Date.now() - 60 * 1000;

    if (isFresh && pointsFromDb.length > 0) {
      return NextResponse.json({ ok: true, source: "supabase-cache", points: pointsFromDb });
    }

    let series = pointsFromDb;
    let syncWarning: string | null = null;
    try {
      const fills = await fetchFillsByTime(wallet, testnet);
      const built = buildSeriesFromFills(fills, coin);
      series = built.length > 0 ? dedupePointsByTimestamp(built) : series;

      if (series.length === 0) {
        const currentOpen = await fetchCurrentOpen(wallet, testnet, coin);
        if (Math.abs(currentOpen) > 0) {
          series = [
            {
              timestamp: new Date().toISOString(),
              total_open: currentOpen,
            },
          ];
        }
      }

      if (series.length > 0) {
        const rows = series.map((p) => ({
          timestamp: p.timestamp,
          network: testnet ? "testnet" : "mainnet",
          wallet_address: wallet.toLowerCase(),
          coin,
          total_open: p.total_open,
          source: "userFillsByTime",
        }));

        const { error: upsertError } = await supabase
          .from("hl_position_history")
          .upsert(rows, { onConflict: "wallet_address,coin,timestamp" });
        if (upsertError) {
          throw new Error(`Supabase upsert failed: ${upsertError.message}`);
        }
      }
    } catch (syncError) {
      syncWarning = syncError instanceof Error ? syncError.message : "position sync failed";
    }

    const { data: finalRows, error: finalError } = await supabase
      .from("hl_position_history")
      .select("timestamp,total_open")
      .eq("network", testnet ? "testnet" : "mainnet")
      .eq("wallet_address", wallet.toLowerCase())
      .eq("coin", coin)
      .order("timestamp", { ascending: true })
      .limit(2000);

    if (finalError) {
      throw new Error(`Supabase final read failed: ${finalError.message}`);
    }

    return NextResponse.json({
      ok: true,
      source: "supabase-sync",
      warning: syncWarning,
      points: finalRows ?? pointsFromDb ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown position-history error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
