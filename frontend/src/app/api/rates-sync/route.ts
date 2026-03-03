import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type PredictedFundingVenue = [string, { fundingRate: string; nextFundingTime?: number } | null];
type PredictedFundingRow = [string, PredictedFundingVenue[]];

const HL_INFO_MAINNET = "https://api.hyperliquid.xyz/info";
const BOROS_CORE_API_BASE = process.env.BOROS_CORE_API_URL ?? "https://api-v2.pendle.finance";
const BOROS_MARKET_ADDRESS =
  process.env.BOROS_MARKET_ADDRESS ?? process.env.NEXT_PUBLIC_BOROS_MARKET_ADDRESS ?? "";
const BOROS_MARKET_ID = Number(process.env.BOROS_MARKET_ID ?? NaN);
const SYNC_MIN_INTERVAL_MS = 60_000;

let cachedBorosLookup: { base: string; marketId: number } | null = null;

const minuteBucketIso = () => new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();

const normalizeApr = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  // API may return percent (e.g. 12.3) or decimal (e.g. 0.123).
  return value > 3 ? value : value * 100;
};

const matchesBorosMarket = (market: Record<string, unknown>, coin: string, targetAddress: string): boolean => {
  const address = String(market?.address ?? "").toLowerCase();
  if (targetAddress && address === targetAddress) return true;
  const metadata = (market?.metadata ?? {}) as Record<string, unknown>;
  const imData = (market?.imData ?? {}) as Record<string, unknown>;
  const assetSymbol = String(metadata.assetSymbol ?? "").toUpperCase();
  const fundingRateSymbol = String(metadata.fundingRateSymbol ?? "").toUpperCase();
  const marketSymbol = String(imData.symbol ?? "").toUpperCase();
  const normalizedCoin = coin.toUpperCase();
  return (
    assetSymbol === normalizedCoin ||
    fundingRateSymbol === normalizedCoin ||
    marketSymbol.includes(normalizedCoin)
  );
};

const extractAprFromMarket = (market: Record<string, unknown>): number => {
  const data = (market.data ?? {}) as Record<string, unknown>;
  const raw = Number(data.ammImpliedApr ?? data.markApr ?? NaN);
  if (!Number.isFinite(raw)) {
    throw new Error(`Selected Boros market has no implied APR (market=${String(market.address ?? "unknown")})`);
  }
  return normalizeApr(raw);
};

const parseMarketFromPayload = (payload: unknown): Record<string, unknown> | null => {
  if (!payload || typeof payload !== "object") return null;
  const maybe = payload as Record<string, unknown>;
  if (maybe.address || maybe.data || maybe.metadata || maybe.imData) return maybe;
  if (maybe.result && typeof maybe.result === "object") return maybe.result as Record<string, unknown>;
  if (maybe.data && typeof maybe.data === "object") return maybe.data as Record<string, unknown>;
  return null;
};

const fetchBorosImpliedApr = async (coin: string): Promise<{ impliedAprPct: number; marketAddress: string }> => {
  const bases = Array.from(
    new Set([
      BOROS_CORE_API_BASE.replace(/\/+$/, ""),
      "https://api-v2.pendle.finance",
      "https://api.boros.finance",
    ]),
  );
  const candidates = bases.flatMap((base) => [`${base}/core/v1/markets`, `${base}/v1/markets`, `${base}/markets`]);

  const targetAddress = BOROS_MARKET_ADDRESS.toLowerCase();
  let response: Response | null = null;
  let lastError = "";

  const tryById = async (base: string, id: number): Promise<{ impliedAprPct: number; marketAddress: string } | null> => {
    const byIdUrl = `${base}/core/v1/markets/${id}`;
    const res = await fetch(byIdUrl, { method: "GET", headers: { accept: "application/json" } });
    if (!res.ok) {
      const body = await res.text();
      lastError = `${byIdUrl} -> ${res.status}: ${body}`;
      return null;
    }
    const payload = (await res.json()) as unknown;
    const market = parseMarketFromPayload(payload);
    if (!market) {
      lastError = `${byIdUrl} -> 200 but payload format unsupported`;
      return null;
    }
    if (!matchesBorosMarket(market, coin, targetAddress)) return null;
    cachedBorosLookup = { base, marketId: id };
    return {
      impliedAprPct: extractAprFromMarket(market),
      marketAddress: String(market.address || BOROS_MARKET_ADDRESS || "unknown"),
    };
  };

  // Fast path: re-use discovered market lookup.
  if (cachedBorosLookup) {
    const fast = await tryById(cachedBorosLookup.base, cachedBorosLookup.marketId);
    if (fast) return fast;
  }

  // If configured, prefer direct market-id lookup first.
  if (Number.isFinite(BOROS_MARKET_ID) && BOROS_MARKET_ID > 0) {
    for (const base of bases) {
      const direct = await tryById(base, BOROS_MARKET_ID);
      if (direct) return direct;
    }
  }
  for (const candidate of candidates) {
    const url = new URL(candidate);
    url.searchParams.set("isWhitelisted", "true");
    url.searchParams.set("limit", "200");
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (res.ok) {
      response = res;
      break;
    }
    const body = await res.text();
    lastError = `${url.toString()} -> ${res.status}: ${body}`;
  }

  if (response) {
    const payload = (await response.json()) as unknown;
    const root = payload as
      | { results?: unknown[]; data?: { results?: unknown[] } }
      | unknown[]
      | undefined;
    const markets = Array.isArray(root)
      ? root
      : Array.isArray(root?.results)
      ? root.results
      : Array.isArray(root?.data?.results)
      ? root.data.results
      : [];
    if (markets.length > 0) {
      const selected = (markets as Array<Record<string, unknown>>).find((market) =>
        matchesBorosMarket(market, coin, targetAddress),
      );
      if (selected) {
        return {
          impliedAprPct: extractAprFromMarket(selected),
          marketAddress: String(selected.address || BOROS_MARKET_ADDRESS || "unknown"),
        };
      }
    }
  }

  // Fallback path: endpoint may only expose /markets/:id.
  const idCandidates =
    Number.isFinite(BOROS_MARKET_ID) && BOROS_MARKET_ID > 0
      ? [BOROS_MARKET_ID]
      : Array.from({ length: 60 }, (_, i) => i + 1);

  let lastIdError = lastError;
  for (const base of bases) {
    for (const id of idCandidates) {
      const byId = await tryById(base, id);
      if (byId) return byId;
      lastIdError = lastError;
    }
  }

  throw new Error(`Boros API failed on list and id endpoints. Last error: ${lastIdError}`);
};

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { ok: false, error: "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE key (service role or anon)" },
        { status: 500 },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const readLatest = async () => {
      const [{ data: latestFunding, error: latestFundingError }, { data: latestBoros, error: latestBorosError }] =
        await Promise.all([
          supabase
            .from("hl_funding_rates")
            .select("timestamp,asset_symbol,venue,funding_rate,funding_apr,next_funding_time")
            .eq("network", "mainnet")
            .eq("asset_symbol", "ETH")
            .eq("venue", "HlPerp")
            .order("timestamp", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("boros_implied_rates")
            .select("timestamp,asset_symbol,market_address,implied_apr,source")
            .eq("network", "mainnet")
            .eq("asset_symbol", "ETH")
            .order("timestamp", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

      if (latestFundingError) {
        throw new Error(`Supabase latest funding read failed: ${latestFundingError.message}`);
      }
      if (latestBorosError) {
        throw new Error(`Supabase latest boros read failed: ${latestBorosError.message}`);
      }
      const resolvedBoros = latestBoros;
      const borosSourcePath = latestBoros ? "boros_implied_rates_mainnet" : "none";
      return { latestFunding, latestBoros: resolvedBoros, borosSourcePath };
    };

    // Return cached values if present, even when sync fails.
    const initial = await readLatest();
    const hasInitial = Boolean(initial.latestFunding || initial.latestBoros);
    const latestFundingTs = initial.latestFunding?.timestamp ? new Date(initial.latestFunding.timestamp).getTime() : 0;
    const latestBorosTs = initial.latestBoros?.timestamp ? new Date(initial.latestBoros.timestamp).getTime() : 0;
    const now = Date.now();
    const fundingFresh = latestFundingTs > now - SYNC_MIN_INTERVAL_MS;
    const borosFresh = latestBorosTs > now - SYNC_MIN_INTERVAL_MS;

    let syncWarning: string | null = null;
    if (fundingFresh && borosFresh) {
      return NextResponse.json({
        ok: true,
        funding: initial.latestFunding ?? null,
        boros: initial.latestBoros ?? null,
        warning: null,
        cached: true,
        debug: {
          borosSourcePath: initial.borosSourcePath,
          skippedSync: true,
        },
      });
    }

    try {
      // 1) Pull mainnet funding from Hyperliquid and persist.
      const hlResponse = await fetch(HL_INFO_MAINNET, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "predictedFundings" }),
      });
      if (!hlResponse.ok) {
        const body = await hlResponse.text();
        throw new Error(`Hyperliquid predictedFundings failed ${hlResponse.status}: ${body}`);
      }

      const predicted = (await hlResponse.json()) as PredictedFundingRow[];
      const ethRow = predicted.find(([symbol]) => symbol.toUpperCase() === "ETH");
      const hlPerpVenue = ethRow?.[1]?.find(([venue]) => venue === "HlPerp");
      const fundingRateRaw = hlPerpVenue?.[1]?.fundingRate;
      const nextFundingTimeRaw = hlPerpVenue?.[1]?.nextFundingTime;
      const fundingRate = Number(fundingRateRaw ?? NaN);
      if (!Number.isFinite(fundingRate)) {
        throw new Error("Could not parse ETH HlPerp funding rate from predictedFundings");
      }
      const fundingApr = fundingRate * 24 * 365 * 100;

      const hlFundingRow = {
        timestamp: minuteBucketIso(),
        network: "mainnet",
        asset_symbol: "ETH",
        venue: "HlPerp",
        funding_rate: fundingRate,
        funding_apr: fundingApr,
        next_funding_time: Number.isFinite(Number(nextFundingTimeRaw))
          ? new Date(Number(nextFundingTimeRaw)).toISOString()
          : null,
        funding_interval_hours: 1,
      };

      const { error: fundingUpsertError } = await supabase
        .from("hl_funding_rates")
        .upsert(hlFundingRow, { onConflict: "network,asset_symbol,venue,timestamp" });
      if (fundingUpsertError) {
        throw new Error(`Supabase hl_funding_rates upsert failed: ${fundingUpsertError.message}`);
      }

      // 2) Pull latest Boros implied APR directly from Boros Core API and persist.
      const borosLive = await fetchBorosImpliedApr("ETH");
      const impliedRow = {
        timestamp: minuteBucketIso(),
        network: "mainnet",
        market_address: borosLive.marketAddress,
        asset_symbol: "ETH",
        implied_apr: borosLive.impliedAprPct,
        source: "boros_core_api_v1_markets",
      };
      const { error: impliedUpsertError } = await supabase
        .from("boros_implied_rates")
        .upsert(impliedRow, { onConflict: "network,market_address,timestamp" });
      if (impliedUpsertError) {
        throw new Error(`Supabase boros_implied_rates upsert failed: ${impliedUpsertError.message}`);
      }
    } catch (syncError) {
      syncWarning = syncError instanceof Error ? syncError.message : "rates sync failed";
    }

    // 3) Return latest persisted values (post-sync or cached fallback).
    const latest = await readLatest();
    return NextResponse.json({
      ok: true,
      funding: latest.latestFunding ?? initial.latestFunding ?? null,
      boros: latest.latestBoros ?? initial.latestBoros ?? null,
      warning:
        syncWarning ??
        (!(latest.latestBoros ?? initial.latestBoros)
          ? "No Boros source found from boros core API or boros_implied_rates."
          : null),
      cached: hasInitial,
      debug: {
        borosSourcePath: latest.borosSourcePath,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown rates-sync error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
