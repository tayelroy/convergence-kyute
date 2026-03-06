import type { HTTPSendRequester } from "@chainlink/cre-sdk";

export type BorosAprSnapshot = {
  marketId: number;
  apr: number | null;
  field: "markApr";
  midApr: number | null;
  lastTradedApr: number | null;
  floatingApr: number | null;
  state?: string;
  source: "boros-core-api";
  asOf: number;
};

export const DEFAULT_BOROS_MARKET_ID = 41;
export const DEFAULT_BOROS_CORE_API_BASE_URL = "https://api.boros.finance/core/v1";

type BorosMarketResponse = {
  state?: string;
  data?: {
    markApr?: number | string | null;
    midApr?: number | string | null;
    lastTradedApr?: number | string | null;
    floatingApr?: number | string | null;
  };
};

const normalizeAprDecimal = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 3 ? numeric / 100 : numeric;
};

const buildMarketUrl = (baseUrl: string, marketId: number): string => {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (/\/markets\/\d+$/.test(trimmed)) return trimmed;
  return `${trimmed}/markets/${marketId}`;
};

export const fetchBorosAprSnapshot = (
  requester: HTTPSendRequester,
  baseUrl: string,
  marketId: number = DEFAULT_BOROS_MARKET_ID,
): BorosAprSnapshot => {
  const url = buildMarketUrl(baseUrl, marketId);
  const response = requester.sendRequest({
    url,
    method: "GET",
    headers: {
      accept: "application/json",
    },
    cacheSettings: {
      store: true,
      maxAge: "15s",
    },
  }).result();

  const jsonText = new TextDecoder().decode(response.body);
  const json = JSON.parse(jsonText) as BorosMarketResponse;
  const data = json?.data ?? {};

  return {
    marketId,
    apr: normalizeAprDecimal(data.markApr),
    field: "markApr",
    midApr: normalizeAprDecimal(data.midApr),
    lastTradedApr: normalizeAprDecimal(data.lastTradedApr),
    floatingApr: normalizeAprDecimal(data.floatingApr),
    state: json?.state,
    source: "boros-core-api",
    asOf: Date.now(),
  };
};

