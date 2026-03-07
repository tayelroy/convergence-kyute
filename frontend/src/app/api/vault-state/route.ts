import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, formatUnits, http, isAddress, type Address } from "viem";
import { DEFAULT_MARKET_YU_TOKENS, VAULT_ABI } from "@/lib/kyute-vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ZERO_BIGINT = BigInt(0);
const DEFAULT_AGENT_SIDECAR_URL = "http://127.0.0.1:8791";
const DEFAULT_BOROS_MARKET_IDS: Record<string, number> = {
  ETH: 41,
  BTC: 61,
};

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

const getVaultAddress = (): Address | null => {
  const raw = String(readServerEnv("NEXT_PUBLIC_KYUTE_VAULT_ADDRESS") ?? "").trim();
  return isAddress(raw) ? (raw as Address) : null;
};

const getRpcUrl = (): string => {
  return (
    String(readServerEnv("NEXT_PUBLIC_KYUTE_RPC_URL") ?? "").trim() ||
    String(readServerEnv("ANVIL_RPC_URL") ?? "").trim() ||
    "http://127.0.0.1:8545"
  );
};

const getAgentSidecarUrl = (): string => {
  return readServerEnv("KYUTE_AGENT_SIDECAR_URL") ?? DEFAULT_AGENT_SIDECAR_URL;
};

const defaultBorosMarketAddressForCoin = (coin: string): string | null => {
  if (coin === "BTC") {
    const btc = (readServerEnv("NEXT_PUBLIC_BOROS_BTC_MARKET_ADDRESS") ?? "").trim().toLowerCase();
    return /^0x[a-fA-F0-9]{40}$/.test(btc) ? btc : null;
  }

  const eth = (readServerEnv("NEXT_PUBLIC_BOROS_MARKET_ADDRESS") ?? "").trim().toLowerCase();
  return /^0x[a-fA-F0-9]{40}$/.test(eth) ? eth : null;
};

const inferCoinFromYuToken = (yuToken: Address | null, requestedCoin: string | null): string => {
  const normalizedRequested = String(requestedCoin ?? "").trim().toUpperCase();
  if (normalizedRequested) return normalizedRequested;
  if (!yuToken) return "ETH";
  if (yuToken.toLowerCase() === DEFAULT_MARKET_YU_TOKENS.BTC.toLowerCase()) return "BTC";
  return "ETH";
};

type RawVaultPosition = readonly [
  Address,
  boolean,
  bigint,
  bigint,
  boolean,
  Address,
  bigint,
  bigint,
  bigint,
  boolean,
  boolean,
];

type SidecarSnapshotResponse = {
  ok?: boolean;
  snapshot?: {
    vault?: {
      position?: {
        asset?: Address;
        isLong?: boolean;
        notional?: string;
        leverage?: string;
        hasBorosHedge?: boolean;
        yuToken?: Address;
        lastUpdateTimestamp?: string;
        targetHedgeNotional?: string;
        currentHedgeNotional?: string;
        currentHedgeIsLong?: boolean;
        targetHedgeIsLong?: boolean;
      };
    };
  };
  error?: string;
};

const fetchAgentSnapshot = async (args: {
  walletAddress: Address;
  vaultAddress: Address;
  yuToken: Address | null;
  coin: string;
}) => {
  const marketAddress = defaultBorosMarketAddressForCoin(args.coin);
  const marketId = DEFAULT_BOROS_MARKET_IDS[args.coin] ?? null;
  const params = new URLSearchParams({
    walletAddress: args.walletAddress,
    vaultAddress: args.vaultAddress,
    coin: args.coin,
  });
  if (args.yuToken) {
    params.set("yuToken", args.yuToken);
  }
  if (marketId) {
    params.set("borosMarketId", String(marketId));
  }
  if (marketAddress) {
    params.set("borosMarketAddress", marketAddress);
  }

  const response = await fetch(
    `${getAgentSidecarUrl().replace(/\/+$/, "")}/internal/agent-snapshot?${params.toString()}`,
    {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
    },
  );

  if (!response.ok) {
    throw new Error(`agent sidecar snapshot failed ${response.status}: ${await response.text()}`);
  }

  const json = (await response.json()) as SidecarSnapshotResponse;
  if (!json.ok || !json.snapshot?.vault?.position) {
    throw new Error(json.error ?? "agent sidecar snapshot unavailable");
  }

  const position = json.snapshot.vault.position;
  return [
    position.asset ?? ZERO_ADDRESS,
    Boolean(position.isLong),
    BigInt(position.notional ?? "0"),
    BigInt(position.leverage ?? "0"),
    Boolean(position.hasBorosHedge),
    position.yuToken ?? ZERO_ADDRESS,
    BigInt(position.lastUpdateTimestamp ?? "0"),
    BigInt(position.targetHedgeNotional ?? "0"),
    BigInt(position.currentHedgeNotional ?? "0"),
    Boolean(position.currentHedgeIsLong),
    Boolean(position.targetHedgeIsLong),
  ] as RawVaultPosition;
};

const getSettledBigInt = (result: PromiseSettledResult<unknown>): bigint => {
  if (result.status !== "fulfilled") return ZERO_BIGINT;
  return typeof result.value === "bigint" ? result.value : ZERO_BIGINT;
};

export async function GET(request: Request) {
  try {
    const vaultAddress = getVaultAddress();
    if (!vaultAddress) {
      return NextResponse.json({ ok: false, error: "Vault address not configured" }, { status: 500 });
    }

    const url = new URL(request.url);
    const walletAddress = String(url.searchParams.get("walletAddress") ?? "").trim();
    const yuTokenRaw = String(url.searchParams.get("yuToken") ?? "").trim();
    const userAddress = isAddress(walletAddress) ? (walletAddress as Address) : (ZERO_ADDRESS as Address);
    const yuToken = isAddress(yuTokenRaw) ? (yuTokenRaw as Address) : null;
    const coin = inferCoinFromYuToken(yuToken, url.searchParams.get("coin"));
    const rpcUrl = getRpcUrl();

    const publicClient = createPublicClient({
      transport: http(rpcUrl),
    });
    const bytecode = await publicClient.getBytecode({ address: vaultAddress });
    if (!bytecode || bytecode === "0x") {
      throw new Error(`Vault address ${vaultAddress} is not a deployed contract on ${rpcUrl}`);
    }

    const position = await fetchAgentSnapshot({
      walletAddress: userAddress,
      vaultAddress,
      yuToken,
      coin,
    });

    const [totalAssetsResult, sharesResult] = await Promise.allSettled([
      publicClient.readContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: "totalAssets",
        args: [],
      }),
      userAddress === ZERO_ADDRESS
        ? Promise.resolve(ZERO_BIGINT)
        : publicClient.readContract({
            address: vaultAddress,
            abi: VAULT_ABI,
            functionName: "balanceOf",
            args: [userAddress],
          }),
    ]);

    const totalAssetsWei = getSettledBigInt(totalAssetsResult);
    const sharesWei = getSettledBigInt(sharesResult);
    const userAssetsResult = sharesWei > ZERO_BIGINT
      ? await Promise.allSettled([
          publicClient.readContract({
            address: vaultAddress,
            abi: VAULT_ABI,
            functionName: "convertToAssets",
            args: [sharesWei],
          }),
        ])
      : [{ status: "fulfilled", value: ZERO_BIGINT } satisfies PromiseFulfilledResult<bigint>];
    const userAssetsWei = getSettledBigInt(userAssetsResult[0]);
    const warnings = [
      totalAssetsResult.status === "rejected" ? `totalAssets read failed: ${totalAssetsResult.reason instanceof Error ? totalAssetsResult.reason.message : String(totalAssetsResult.reason)}` : null,
      sharesResult.status === "rejected" ? `balanceOf read failed: ${sharesResult.reason instanceof Error ? sharesResult.reason.message : String(sharesResult.reason)}` : null,
      userAssetsResult[0]?.status === "rejected" ? `convertToAssets read failed: ${userAssetsResult[0].reason instanceof Error ? userAssetsResult[0].reason.message : String(userAssetsResult[0].reason)}` : null,
    ].filter(Boolean);

    return NextResponse.json({
      ok: true,
      vaultAddress,
      totalAssetsWei: totalAssetsWei.toString(),
      totalAssetsEth: Number(formatUnits(totalAssetsWei, 18)),
      userAssetsWei: userAssetsWei.toString(),
      userAssetsEth: Number(formatUnits(userAssetsWei, 18)),
      sharesWei: sharesWei.toString(),
      hasPosition: position[2] > ZERO_BIGINT,
      hasBorosHedge: Boolean(position[4]),
      hlNotionalWei: position[2].toString(),
      hlNotionalEth: Number(formatUnits(position[2], 18)),
      currentHedgeNotionalWei: position[8].toString(),
      currentHedgeAmountYu: Number(formatUnits(position[8], 18)),
      currentHedgeIsLong: Boolean(position[9]),
      positionLastUpdate: position[6] > ZERO_BIGINT ? Number(position[6]) * 1000 : null,
      yuToken: position[5],
      warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read vault state";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
