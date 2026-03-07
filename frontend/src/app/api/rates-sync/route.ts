import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_AGENT_SIDECAR_URL = "http://127.0.0.1:8791";

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
      (value.startsWith("\"") && value.endsWith("\"")) ||
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

  const candidates = [
    path.resolve(process.cwd(), "..", ".env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", "frontend", ".env.local"),
    path.resolve(process.cwd(), "frontend", ".env.local"),
    path.resolve(process.cwd(), ".env.local"),
  ];
  const merged: Record<string, string> = {};
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    Object.assign(merged, parseEnvFile(fs.readFileSync(candidate, "utf8")));
  }

  cachedRootEnv = merged;
  return cachedRootEnv;
};

const readServerEnv = (key: string): string | undefined => {
  const processValue = process.env[key]?.trim();
  if (processValue) return processValue;
  const rootValue = readRootEnv()[key]?.trim();
  if (rootValue) return rootValue;
  return undefined;
};

const AGENT_SIDECAR_URL = readServerEnv("KYUTE_AGENT_SIDECAR_URL") ?? DEFAULT_AGENT_SIDECAR_URL;
const DEFAULT_BOROS_MARKET_IDS: Record<string, number> = {
  ETH: 41,
  BTC: 61,
};

const defaultBorosMarketAddressForCoin = (coin: string): string | null => {
  if (coin === "BTC") {
    const btc = (readServerEnv("NEXT_PUBLIC_BOROS_BTC_MARKET_ADDRESS") ?? "").trim().toLowerCase();
    return /^0x[a-fA-F0-9]{40}$/.test(btc) ? btc : null;
  }

  const eth = (readServerEnv("NEXT_PUBLIC_BOROS_MARKET_ADDRESS") ?? "").trim().toLowerCase();
  return /^0x[a-fA-F0-9]{40}$/.test(eth) ? eth : null;
};

const fetchAgentSnapshot = async (args: {
  walletAddress: string;
  vaultAddress: string | null;
  coin: string;
  marketAddress: string | null;
  marketId: number | null;
}) => {
  if (!/^0x[a-fA-F0-9]{40}$/.test(args.walletAddress)) {
    throw new Error("walletAddress is required for live sidecar rates");
  }

  if (!args.marketId || args.marketId <= 0) {
    throw new Error(`borosMarketId is required for ${args.coin} live sidecar rates`);
  }

  const params = new URLSearchParams({
    walletAddress: args.walletAddress,
    coin: args.coin,
    borosMarketId: String(args.marketId),
  });
  if (args.vaultAddress) {
    params.set("vaultAddress", args.vaultAddress);
  }
  if (args.marketAddress) {
    params.set("borosMarketAddress", args.marketAddress);
  }

  const response = await fetch(
    `${AGENT_SIDECAR_URL.replace(/\/+$/, "")}/internal/agent-snapshot?${params.toString()}`,
    {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
    },
  );

  if (!response.ok) {
    throw new Error(`agent sidecar snapshot failed ${response.status}: ${await response.text()}`);
  }

  const json = (await response.json()) as {
    ok?: boolean;
    snapshot?: {
      funding?: {
        averageFundingBp?: number;
      };
      decision?: {
        exposure?: string;
        shouldHedge?: boolean;
        targetHedgeIsLong?: boolean;
        edgeBp?: number;
        reason?: string;
        action?: string;
        executeNeeded?: boolean;
        entryThresholdBp?: number;
        exitThresholdBp?: number;
        enabled?: boolean;
        mode?: string;
      } | null;
      borosQuote?: {
        apr?: number | null;
        marketId?: number;
        marketAddress?: string | null;
        field?: string;
        source?: string;
      };
    };
    error?: string;
  };

  if (!json.ok || !json.snapshot) {
    throw new Error(json.error ?? "agent sidecar snapshot unavailable");
  }

  return json.snapshot;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const coin = (url.searchParams.get("coin") ?? "ETH").trim().toUpperCase();
    const fallbackWallet = (readServerEnv("NEXT_PUBLIC_CANONICAL_HL_WALLET") ?? "").trim().toLowerCase();
    const walletAddress = (url.searchParams.get("walletAddress") ?? fallbackWallet).trim().toLowerCase();
    const fallbackVaultAddress = (readServerEnv("NEXT_PUBLIC_KYUTE_VAULT_ADDRESS") ?? readServerEnv("KYUTE_VAULT_ADDRESS") ?? "")
      .trim()
      .toLowerCase();
    const vaultAddress = /^0x[a-fA-F0-9]{40}$/.test(fallbackVaultAddress) ? fallbackVaultAddress : null;
    const marketAddressRaw = (url.searchParams.get("marketAddress") ?? "").trim().toLowerCase();
    const marketAddress = /^0x[a-fA-F0-9]{40}$/.test(marketAddressRaw)
      ? marketAddressRaw
      : defaultBorosMarketAddressForCoin(coin);
    const marketIdRaw = Number(url.searchParams.get("borosMarketId") ?? "");
    const marketId = Number.isFinite(marketIdRaw) && marketIdRaw > 0
      ? Math.floor(marketIdRaw)
      : DEFAULT_BOROS_MARKET_IDS[coin] ?? null;

    const snapshot = await fetchAgentSnapshot({
      walletAddress,
      vaultAddress,
      coin,
      marketAddress,
      marketId,
    });

    const averageFundingBp = Number(snapshot.funding?.averageFundingBp ?? NaN);
    const borosApr = Number(snapshot.borosQuote?.apr ?? NaN);
    const fundingApr = Number.isFinite(averageFundingBp) ? averageFundingBp / 100 : null;
    const fundingRate = Number.isFinite(averageFundingBp) ? averageFundingBp / 10_000 / (24 * 365) : null;
    const timestamp = new Date().toISOString();

    return NextResponse.json({
      ok: true,
      source: "agent_sidecar_snapshot",
      funding: fundingApr != null
        ? {
            timestamp,
            asset_symbol: coin,
            venue: "HlPerp",
            funding_rate: fundingRate,
            funding_apr: fundingApr,
            next_funding_time: null,
            source: "agent_sidecar_snapshot",
          }
        : null,
      boros: Number.isFinite(borosApr)
        ? {
            timestamp,
            asset_symbol: coin,
            market_address: marketAddress ?? snapshot.borosQuote?.marketAddress ?? null,
            implied_apr: borosApr * 100,
            source: snapshot.borosQuote?.source ?? "agent_sidecar_snapshot",
            field: snapshot.borosQuote?.field ?? "markApr",
          }
        : null,
      decision: snapshot.decision ?? null,
      warning: null,
      cached: false,
      debug: {
        borosSourcePath: "agent_sidecar_snapshot",
        borosMarketAddress: marketAddress ?? snapshot.borosQuote?.marketAddress ?? null,
        borosMarketId: marketId ?? snapshot.borosQuote?.marketId ?? null,
        coin,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "live sidecar rates unavailable";
    return NextResponse.json(
      {
        ok: false,
        error: message,
        source: "agent_sidecar_snapshot",
      },
      { status: 502 },
    );
  }
}
