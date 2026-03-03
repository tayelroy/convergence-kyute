import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execute_perp_order } from "../main";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const loadEnvFile = (filePath: string) => {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
};

const autoLoadEnv = () => {
  const projectRoot = resolve(__dirname, "../../..");
  loadEnvFile(resolve(projectRoot, ".env"));
  loadEnvFile(resolve(projectRoot, "cre-kyute/.env"));
  loadEnvFile(resolve(projectRoot, "contracts/.env"));
};

const requiredEnv = (key: string): string => {
  const value = process.env[key];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value.trim();
};

const asNumber = (name: string, value: string | undefined, fallback?: number): number => {
  if (value === undefined || value === "") {
    if (fallback === undefined) throw new Error(`Missing numeric value: ${name}`);
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric value for ${name}: ${value}`);
  return parsed;
};

const asBool = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "y"].includes(value.toLowerCase());
};

const resolvePrivateKey = (): { key: `0x${string}`; source: string } => {
  const candidates = ["HL_PRIVATE_KEY", "PRIVATE_KEY", "CRE_ETH_PRIVATE_KEY"] as const;
  for (const source of candidates) {
    const value = process.env[source];
    if (!value || value.trim().length === 0) continue;
    const key = value.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error(
        `Invalid private key format in ${source}. Expected 0x-prefixed 64-byte hex string.`,
      );
    }
    return { key: key as `0x${string}`, source };
  }
  requiredEnv("HL_PRIVATE_KEY");
  throw new Error("Missing private key");
};

async function run() {
  autoLoadEnv();

  const { key: privateKey, source: privateKeySource } = resolvePrivateKey();
  const asset = (process.env.HL_ASSET ?? "BTC").toUpperCase();
  const side = (process.env.HL_SIDE ?? "buy").toLowerCase() as "buy" | "sell";
  const orderType = (process.env.HL_ORDER_TYPE ?? "market").toLowerCase() as "market" | "limit";

  if (side !== "buy" && side !== "sell") throw new Error("HL_SIDE must be buy or sell");
  if (orderType !== "market" && orderType !== "limit") throw new Error("HL_ORDER_TYPE must be market or limit");

  const size = asNumber("HL_SIZE", process.env.HL_SIZE, 0.001);
  const requestedPrice = process.env.HL_PRICE ? asNumber("HL_PRICE", process.env.HL_PRICE) : undefined;
  const slippageBps = asNumber("HL_SLIPPAGE_BPS", process.env.HL_SLIPPAGE_BPS, 50);
  const oracleDeviationBps = asNumber("HL_ORACLE_DEVIATION_BPS", process.env.HL_ORACLE_DEVIATION_BPS, 100);
  const reduceOnly = asBool(process.env.HL_REDUCE_ONLY, false);
  const isTestnet = asBool(process.env.HL_TESTNET, false);

  console.log(`Using private key from ${privateKeySource}`);

  const wallet = privateKeyToAccount(privateKey);
  const exchangeClient = new ExchangeClient({
    transport: new HttpTransport({ isTestnet }),
    wallet,
  });
  const infoClient = new InfoClient({
    transport: new HttpTransport({ isTestnet }),
  });

  const event = await execute_perp_order({
    asset,
    side,
    size,
    orderType,
    requestedPrice,
    slippageBps,
    oracleDeviationBps,
    reduceOnly,
    infoClient: {
      postInfo: async (payload: Record<string, unknown>) => {
        const type = String(payload.type ?? "");
        if (type === "metaAndAssetCtxs") return infoClient.metaAndAssetCtxs();
        if (type === "allMids") return infoClient.allMids();
        throw new Error(`Unsupported info request type: ${type}`);
      },
    },
    exchangeClient: exchangeClient as unknown as { order: (payload: Record<string, unknown>) => Promise<unknown> },
    emitEvent: (e) => {
      console.log("ExecutionEvent:");
      console.log(JSON.stringify(e, null, 2));
    },
  });

  console.log("Order submitted successfully.");
  console.log(JSON.stringify(event, null, 2));
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to execute order: ${message}`);
  process.exit(1);
});
