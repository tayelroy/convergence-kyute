import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createWalletClient, createPublicClient, getAddress, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { Exchange } from "@pendle/sdk-boros";

function toBigIntAmount(valueEth: string): bigint {
  const [whole, frac = ""] = valueEth.split(".");
  const fracPadded = (frac + "000000000000000000").slice(0, 18);
  return BigInt(whole + fracPadded);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function main() {
  const {
    RPC_URL,
    PRIVATE_KEY,
    BOROS_COLLATERAL_ADDRESS,
    BOROS_DEPOSIT_AMOUNT_ETH,
    BOROS_MARKET_ADDRESS,
  } = process.env;

  if (!RPC_URL || !PRIVATE_KEY || !BOROS_COLLATERAL_ADDRESS || !BOROS_DEPOSIT_AMOUNT_ETH || !BOROS_MARKET_ADDRESS) {
    throw new Error("Missing RPC_URL, PRIVATE_KEY, BOROS_COLLATERAL_ADDRESS, BOROS_DEPOSIT_AMOUNT_ETH, or BOROS_MARKET_ADDRESS in .env");
  }

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: arbitrum,
    transport: http(RPC_URL),
  }).extend(publicActions);

  // Patch the SDK's internal publicClient to use our RPC instead of the hardcoded Arbitrum mainnet RPC.
  // The SDK creates this client at import time, so registerRpc() is too late.
  const borosPublicClient = require("@pendle/sdk-boros/dist/entities/publicClient");
  borosPublicClient.publicClient = createPublicClient({
    chain: arbitrum,
    transport: http(RPC_URL),
  });

  const accountId = 0;
  const exchange = new Exchange(walletClient as any, account.address, accountId, [RPC_URL]);
  const amount = toBigIntAmount(BOROS_DEPOSIT_AMOUNT_ETH);

  // Look up marketId from market address
  console.log("[BOROS] Looking up market...");
  const marketsResp = await exchange.getMarkets({
    skip: 0,
    limit: 100,
    isWhitelisted: true,
  }) as any;
  const targetMarket = marketsResp.results.find(
    (m: any) => m.address.toLowerCase() === BOROS_MARKET_ADDRESS.toLowerCase()
  );
  if (!targetMarket) {
    throw new Error(`Market ${BOROS_MARKET_ADDRESS} not found in Boros listing.`);
  }
  console.log(`[BOROS] Found market: id=${targetMarket.marketId}`);

  // Look up tokenId from collateral address
  const assetsResp = await (exchange as any).borosCoreSdk.assets.assetsControllerGetAllAssets();
  const collateralAsset = assetsResp.data.assets.find(
    (a: any) => a.address?.toLowerCase() === BOROS_COLLATERAL_ADDRESS.toLowerCase()
  );
  if (!collateralAsset) {
    console.log("[BOROS] Available assets:", JSON.stringify(assetsResp.data.assets, null, 2));
    throw new Error(`Collateral ${BOROS_COLLATERAL_ADDRESS} not found in Boros assets.`);
  }
  const tokenId = collateralAsset.tokenId;
  console.log(`[BOROS] Found tokenId=${tokenId} for collateral ${BOROS_COLLATERAL_ADDRESS}`);

  console.log("[BOROS] Depositing via SDK...");
  try {
    const receipt = await exchange.deposit({
      userAddress: account.address,
      tokenId,
      tokenAddress: getAddress(BOROS_COLLATERAL_ADDRESS),
      amount,
      accountId,
      marketId: targetMarket.marketId,
    });
    console.log("[BOROS] Deposit receipt:", receipt);
  } catch (err: any) {
    console.error("[BOROS] SDK deposit failed.");
    // Helpful Axios diagnostics
    if (err?.isAxiosError) {
      console.error("  status:", err?.response?.status);
      console.error("  data:", err?.response?.data);
      console.error("  url:", err?.config?.baseURL + err?.config?.url);
      console.error("  params:", err?.config?.params);
    } else {
      console.error("  error:", err?.message ?? String(err));
    }
  }
}

main().catch(console.error);
