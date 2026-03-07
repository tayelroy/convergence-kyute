import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { fetchBorosImpliedAprQuote } from "@/lib/boros";

export const runtime = "nodejs";

type PredictedFundingVenue = [string, { fundingRate: string; nextFundingTime?: number } | null];
type PredictedFundingRow = [string, PredictedFundingVenue[]];

const HL_INFO_MAINNET = "https://api.hyperliquid.xyz/info";
const DEFAULT_BOROS_MARKET_ADDRESS = "0x8db1397beb16a368711743bc42b69904e4e82122";
const SYNC_MIN_INTERVAL_MS = 60_000;

const minuteBucketIso = () => new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();

let cachedRootEnv: Record<string, string> | null = null;

const parseEnvFile = (contents: string): Record<string, string> => {
  const entries: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = normalized.slice(0, separatorIndex).trim();
    let value = normalized.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
};

const readRootEnv = (): Record<string, string> => {
  if (cachedRootEnv) return cachedRootEnv;

  const candidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    cachedRootEnv = parseEnvFile(fs.readFileSync(candidate, "utf8"));
    return cachedRootEnv;
  }

  cachedRootEnv = {};
  return cachedRootEnv;
};

const readServerEnv = (key: string): string | undefined => {
  const processValue = process.env[key]?.trim();
  if (processValue) return processValue;
  const rootValue = readRootEnv()[key]?.trim();
  if (rootValue) return rootValue;
  return undefined;
};

const BOROS_MARKET_ADDRESS = (
  readServerEnv("BOROS_MARKET_ADDRESS") ??
  readServerEnv("NEXT_PUBLIC_BOROS_MARKET_ADDRESS") ??
  DEFAULT_BOROS_MARKET_ADDRESS
).toLowerCase();
const BOROS_CORE_API_URL = readServerEnv("BOROS_CORE_API_URL");

const resolveBorosMarketAddress = (coin: string): string | null => {
  const normalizedCoin = coin.trim().toUpperCase();
  if (normalizedCoin === "ETH") {
    return BOROS_MARKET_ADDRESS;
  }

  const coinSpecific = (
    readServerEnv(`BOROS_${normalizedCoin}_MARKET_ADDRESS`) ??
    readServerEnv(`NEXT_PUBLIC_BOROS_${normalizedCoin}_MARKET_ADDRESS`) ??
    ""
  ).trim();
  return coinSpecific ? coinSpecific.toLowerCase() : null;
};

const formatSyncError = (error: unknown): string => {
  if (!error || typeof error !== "object") {
    return typeof error === "string" ? error : "rates sync failed";
  }

  const maybeAxios = error as {
    message?: string;
    response?: { status?: number; data?: unknown };
  };
  const status = maybeAxios.response?.status;
  const data = maybeAxios.response?.data;

  if (status && data !== undefined) {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    return `${maybeAxios.message ?? "rates sync failed"} (status=${status}, data=${payload})`;
  }

  if (maybeAxios.message) return maybeAxios.message;
  return "rates sync failed";
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const coin = (url.searchParams.get("coin") ?? "ETH").trim().toUpperCase();
    const requestedMarketAddress = (url.searchParams.get("marketAddress") ?? "").trim().toLowerCase();
    const borosMarketAddress = requestedMarketAddress || resolveBorosMarketAddress(coin);
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
      const latestBorosPromise = (() => {
        let query = supabase
          .from("boros_implied_rates")
          .select("timestamp,asset_symbol,market_address,implied_apr,source")
          .eq("network", "mainnet")
          .eq("asset_symbol", coin);

        if (borosMarketAddress) {
          query = query.eq("market_address", borosMarketAddress);
        }

        return query
          .order("timestamp", { ascending: false })
          .limit(1)
          .maybeSingle();
      })();

      const [{ data: latestFunding, error: latestFundingError }, { data: latestBoros, error: latestBorosError }] =
        await Promise.all([
          supabase
            .from("hl_funding_rates")
            .select("timestamp,asset_symbol,venue,funding_rate,funding_apr,next_funding_time")
            .eq("network", "mainnet")
            .eq("asset_symbol", coin)
            .eq("venue", "HlPerp")
            .order("timestamp", { ascending: false })
            .limit(1)
            .maybeSingle(),
          latestBorosPromise,
        ]);

      if (latestFundingError) {
        throw new Error(`Supabase latest funding read failed: ${latestFundingError.message}`);
      }
      if (latestBorosError) {
        throw new Error(`Supabase latest boros read failed: ${latestBorosError.message}`);
      }
      const resolvedBoros = latestBoros;
      const borosSourcePath = latestBoros ? "boros_implied_rates_market" : "none";
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
          borosMarketAddress: borosMarketAddress ?? null,
          coin,
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
      const assetRow = predicted.find(([symbol]) => symbol.toUpperCase() === coin);
      const hlPerpVenue = assetRow?.[1]?.find(([venue]) => venue === "HlPerp");
      const fundingRateRaw = hlPerpVenue?.[1]?.fundingRate;
      const nextFundingTimeRaw = hlPerpVenue?.[1]?.nextFundingTime;
      const fundingRate = Number(fundingRateRaw ?? NaN);
      if (!Number.isFinite(fundingRate)) {
        throw new Error(`Could not parse ${coin} HlPerp funding rate from predictedFundings`);
      }
      const fundingApr = fundingRate * 24 * 365 * 100;

      const hlFundingRow = {
        timestamp: minuteBucketIso(),
        network: "mainnet",
        asset_symbol: coin,
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

      // 2) Pull latest Boros implied APR via the Boros SDK and persist.
      const borosLive = await fetchBorosImpliedAprQuote(coin, {
        marketAddress: borosMarketAddress ?? undefined,
        coreApiUrl: BOROS_CORE_API_URL,
      });
      const impliedRow = {
        timestamp: minuteBucketIso(),
        network: "mainnet",
        market_address: borosLive.marketAddress.toLowerCase(),
        asset_symbol: coin,
        implied_apr: borosLive.impliedAprPct,
        source: "boros_sdk",
      };
      const { error: impliedUpsertError } = await supabase
        .from("boros_implied_rates")
        .upsert(impliedRow, { onConflict: "network,market_address,timestamp" });
      if (impliedUpsertError) {
        throw new Error(`Supabase boros_implied_rates upsert failed: ${impliedUpsertError.message}`);
      }
    } catch (syncError) {
      syncWarning = formatSyncError(syncError);
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
          ? "No Boros source found from the SDK or boros_implied_rates."
          : null),
      cached: hasInitial,
      debug: {
        borosSourcePath: latest.borosSourcePath,
        borosMarketAddress:
          borosMarketAddress ??
          latest.latestBoros?.market_address ??
          initial.latestBoros?.market_address ??
          null,
        coin,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown rates-sync error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
