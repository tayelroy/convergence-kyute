import { createRequire } from "module";

export type FetchBorosImpliedAprOptions = {
  marketAddress?: string;
  coreApiUrl?: string;
};

export type BorosImpliedAprQuote = {
  impliedAprPct: number;
  marketAddress: string;
};

const MARKET_PAGE_SIZE = 100;
const MAX_MARKET_PAGES = 10;

type BorosSdk = {
  BorosBackend: {
    setCoreBackendUrl: (url: string) => void;
    getCoreSdk: () => {
      markets: {
        marketsControllerGetMarkets: (query?: {
          skip?: number;
          isWhitelisted?: boolean;
          limit?: number;
        }) => Promise<{ data?: { results?: Array<any> } }>;
      };
    };
  };
};

const require = createRequire(import.meta.url);
const { BorosBackend } = require("@pendle/sdk-boros") as BorosSdk;

const normalizeAprPct = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  // SDK/API can return decimal (0.123) or percent (12.3).
  return value > 3 ? value : value * 100;
};

const readFiniteNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const selectMarketApr = (market: any): number => {
  const ammImpliedApr = readFiniteNumber(market?.data?.ammImpliedApr);
  if (ammImpliedApr !== null && ammImpliedApr > 0) {
    return ammImpliedApr;
  }

  const fallbacks = [
    readFiniteNumber(market?.data?.midApr),
    readFiniteNumber(market?.data?.markApr),
    readFiniteNumber(market?.data?.lastTradedApr),
  ];

  for (const candidate of fallbacks) {
    if (candidate !== null) return candidate;
  }

  return NaN;
};

const pickMarket = (
  markets: Array<any>,
  coin: string,
  marketAddress?: string,
) => {
  if (!Array.isArray(markets) || markets.length === 0) return undefined;

  if (marketAddress) {
    const target = marketAddress.toLowerCase();
    const byAddress = markets.find((market) => String(market?.address ?? "").toLowerCase() === target);
    return byAddress;
  }

  const normalizedCoin = coin.toUpperCase();
  const matching = markets.filter((market) => {
    const metadataSymbol = String(market?.metadata?.assetSymbol ?? "").toUpperCase();
    const fundingSymbol = String(market?.metadata?.fundingRateSymbol ?? "").toUpperCase();
    const marketSymbol = String(market?.imData?.symbol ?? "").toUpperCase();
    return (
      metadataSymbol === normalizedCoin ||
      fundingSymbol === normalizedCoin ||
      marketSymbol.includes(normalizedCoin)
    );
  });

  if (matching.length === 0) return undefined;

  const withImplied = matching.find((market) => {
    const value = selectMarketApr(market);
    return Number.isFinite(value) && value > 0;
  });

  return withImplied ?? matching[0];
};

export const fetchBorosImpliedAprQuote = async (
  coin: string,
  options: FetchBorosImpliedAprOptions = {},
): Promise<BorosImpliedAprQuote> => {
  if (options.coreApiUrl) {
    BorosBackend.setCoreBackendUrl(options.coreApiUrl);
  }

  const coreSdk = BorosBackend.getCoreSdk();
  let selectedMarket: any | undefined;
  for (let page = 0; page < MAX_MARKET_PAGES; page += 1) {
    const response = await coreSdk.markets.marketsControllerGetMarkets({
      isWhitelisted: true,
      skip: page * MARKET_PAGE_SIZE,
      limit: MARKET_PAGE_SIZE,
    });
    const markets = response.data?.results ?? [];
    selectedMarket = pickMarket(markets, coin, options.marketAddress);
    if (selectedMarket) break;
    if (markets.length < MARKET_PAGE_SIZE) break;
  }

  if (!selectedMarket) {
    throw new Error(`No Boros market found for coin ${coin}`);
  }

  const rawApr = selectMarketApr(selectedMarket);
  if (!Number.isFinite(rawApr)) {
    throw new Error(`Boros market ${String(selectedMarket?.address ?? "unknown")} has no implied APR value`);
  }

  const marketAddress = String(selectedMarket?.address ?? options.marketAddress ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(marketAddress)) {
    throw new Error(`Boros market ${coin} resolved without a valid market address`);
  }

  return {
    impliedAprPct: normalizeAprPct(rawApr),
    marketAddress,
  };
};
