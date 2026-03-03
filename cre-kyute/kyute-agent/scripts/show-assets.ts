import { InfoClient, HttpTransport } from "@nktkas/hyperliquid";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const asBool = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "y"].includes(value.toLowerCase());
};

async function run() {
  autoLoadEnv();

  const isTestnet = asBool(process.env.HL_TESTNET, false);
  const assetFilter = process.env.HL_ASSET?.trim().toUpperCase();

  const info = new InfoClient({
    transport: new HttpTransport({ isTestnet }),
  });

  const [meta] = await info.metaAndAssetCtxs();
  const universe = meta.universe ?? [];

  console.log(`network=${isTestnet ? "testnet" : "mainnet"} assets=${universe.length}`);
  console.log("index\tsymbol\tszDecimals");

  for (let i = 0; i < universe.length; i++) {
    const asset = universe[i];
    if (assetFilter && asset.name.toUpperCase() !== assetFilter) continue;
    console.log(`${i}\t${asset.name}\t${asset.szDecimals}`);
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to fetch assets: ${message}`);
  process.exit(1);
});
