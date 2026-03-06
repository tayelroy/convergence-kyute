const DEFAULT_CHAIN_ID = 998;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export type ExecutorWalletBridgePayload = {
  userId?: number;
  walletAddress: string;
  vaultAddress?: string;
  chainId: number;
  testnet: boolean;
  issuedAt: string;
  expiresAt: string;
  signature: string;
};

type SignableAccount = {
  address: string;
  signMessage: (params: { message: string }) => Promise<string>;
};

const toPositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? "");
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
};

const normalizeVaultAddress = (value: string | undefined): string | undefined => {
  const candidate = String(value ?? "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(candidate) ? candidate : undefined;
};

export const getExecutorBridgeConfig = () => {
  const rawTestnet = String(process.env.NEXT_PUBLIC_HL_TESTNET ?? "").trim().toLowerCase();
  const testnet = rawTestnet === "" ? true : rawTestnet === "true";
  return {
    vaultAddress: normalizeVaultAddress(process.env.NEXT_PUBLIC_KYUTE_VAULT_ADDRESS),
    chainId: toPositiveInteger(process.env.NEXT_PUBLIC_KYUTE_CHAIN_ID, DEFAULT_CHAIN_ID),
    testnet,
    ttlMs: toPositiveInteger(process.env.NEXT_PUBLIC_KYUTE_BRIDGE_TTL_MS, DEFAULT_TTL_MS),
  };
};

export const buildExecutorWalletBridgeMessage = (params: {
  walletAddress: string;
  vaultAddress?: string;
  chainId: number;
  testnet: boolean;
  issuedAt: string;
  expiresAt: string;
}) => {
  const vaultLine = params.vaultAddress ?? "unscoped";
  return [
    "kYUte executor wallet registration",
    `wallet: ${params.walletAddress.toLowerCase()}`,
    `vault: ${vaultLine.toLowerCase()}`,
    `chainId: ${params.chainId}`,
    `testnet: ${params.testnet ? "true" : "false"}`,
    `issuedAt: ${params.issuedAt}`,
    `expiresAt: ${params.expiresAt}`,
  ].join("\n");
};

export const getExecutorBridgeCacheKey = (params: { walletAddress: string; vaultAddress?: string }) => {
  const vault = params.vaultAddress?.toLowerCase() ?? "unscoped";
  return `kyute_executor_bridge:${vault}:${params.walletAddress.toLowerCase()}`;
};

const isSignableAccount = (account: unknown): account is SignableAccount => {
  if (!account || typeof account !== "object") return false;
  const candidate = account as Partial<SignableAccount>;
  return typeof candidate.address === "string" && typeof candidate.signMessage === "function";
};

export const registerExecutorWallet = async (account: unknown): Promise<void> => {
  if (typeof window === "undefined") return;
  if (!isSignableAccount(account)) return;

  const config = getExecutorBridgeConfig();
  const cacheKey = getExecutorBridgeCacheKey({
    walletAddress: account.address,
    vaultAddress: config.vaultAddress,
  });

  try {
    const cachedRaw = window.localStorage.getItem(cacheKey);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw) as { expiresAt?: string } | null;
      const expiresAtMs = cached?.expiresAt ? new Date(cached.expiresAt).getTime() : 0;
      if (Number.isFinite(expiresAtMs) && expiresAtMs > Date.now() + 60_000) {
        return;
      }
    }
  } catch {
    // ignore cache parse errors and continue with a fresh registration
  }

  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + config.ttlMs).toISOString();
  const message = buildExecutorWalletBridgeMessage({
    walletAddress: account.address,
    vaultAddress: config.vaultAddress,
    chainId: config.chainId,
    testnet: config.testnet,
    issuedAt,
    expiresAt,
  });
  const signature = await account.signMessage({ message });
  const payload: ExecutorWalletBridgePayload = {
    walletAddress: account.address,
    vaultAddress: config.vaultAddress,
    chainId: config.chainId,
    testnet: config.testnet,
    issuedAt,
    expiresAt,
    signature,
  };

  const response = await fetch("/api/executor-wallet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as { ok?: boolean; error?: string; userId?: number };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `wallet bridge failed (${response.status})`);
  }

  window.localStorage.setItem(cacheKey, JSON.stringify({ expiresAt, userId: body.userId ?? null }));
};
