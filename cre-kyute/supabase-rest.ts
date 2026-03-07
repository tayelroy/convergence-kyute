import type { HTTPSendRequester } from "@chainlink/cre-sdk";

export type SupabaseRestConfig = {
  supabaseUrl: string;
  supabaseKey: string;
};

export type SupabaseRestFetchResult = {
  statusCode: number;
  bodyText: string;
};

export type SupabaseRestFetch = (
  url: string,
  headers: Record<string, string>,
) => Promise<SupabaseRestFetchResult>;

type ResolveSupabaseRestConfigOptions = {
  supabaseUrl?: string;
  supabaseKey?: string;
};

const trimOrUndefined = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

export const assertHttpUrl = (name: string, value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} is missing`);
  }
  if (!/^https?:\/\/\S+$/i.test(trimmed)) {
    throw new Error(`${name} is not a valid absolute URL`);
  }
  return trimmed.replace(/\/+$/, "");
};

export const resolveSupabaseRestConfig = (
  options?: ResolveSupabaseRestConfigOptions,
): SupabaseRestConfig | null => {
  const supabaseUrl =
    trimOrUndefined(options?.supabaseUrl) ??
    trimOrUndefined(process.env.CRE_SUPABASE_URL) ??
    trimOrUndefined(process.env.SUPABASE_URL) ??
    trimOrUndefined(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseKey =
    trimOrUndefined(options?.supabaseKey) ??
    trimOrUndefined(process.env.SUPABASE_SERVICE_ROLE_KEY) ??
    trimOrUndefined(process.env.CRE_SUPABASE_KEY) ??
    trimOrUndefined(process.env.SUPABASE_KEY) ??
    trimOrUndefined(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return {
    supabaseUrl: assertHttpUrl("supabaseUrl", supabaseUrl),
    supabaseKey,
  };
};

const buildHeaders = (supabaseKey: string): Record<string, string> => ({
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
  Accept: "application/json",
});

export const fetchTextViaRequester = (
  requester: HTTPSendRequester,
  url: string,
  headers: Record<string, string>,
): SupabaseRestFetchResult => {
  const response = requester.sendRequest({
    url,
    method: "GET",
    headers,
    cacheSettings: {
      store: true,
      maxAge: "10s",
    },
  }).result();

  return {
    statusCode: response.statusCode,
    bodyText: new TextDecoder().decode(response.body),
  };
};

const nativeFetchText: SupabaseRestFetch = async (url, headers) => {
  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  return {
    statusCode: response.status,
    bodyText: await response.text(),
  };
};

const buildQueryString = (query: Record<string, string>): string => {
  return Object.entries(query)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
};

const buildSelectUrl = (
  supabaseUrl: string,
  table: string,
  query: Record<string, string>,
): string => `${supabaseUrl}/rest/v1/${table}?${buildQueryString(query)}`;

export const selectSupabaseRows = async <TRow>(params: {
  table: string;
  query: Record<string, string>;
  supabaseUrl?: string;
  supabaseKey?: string;
  fetcher?: SupabaseRestFetch;
}): Promise<TRow[]> => {
  const config = resolveSupabaseRestConfig({
    supabaseUrl: params.supabaseUrl,
    supabaseKey: params.supabaseKey,
  });
  if (!config) {
    return [];
  }

  const url = buildSelectUrl(config.supabaseUrl, params.table, params.query);
  const result = await (params.fetcher ?? nativeFetchText)(url, buildHeaders(config.supabaseKey));
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`Supabase REST select failed: ${result.statusCode} ${result.bodyText}`);
  }

  if (!result.bodyText.trim()) {
    return [];
  }

  const parsed = JSON.parse(result.bodyText) as unknown;
  return Array.isArray(parsed) ? (parsed as TRow[]) : [];
};
