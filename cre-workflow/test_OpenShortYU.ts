import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createWalletClient, http, parseEther, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { StabilityVaultABI } from "./abi/StabilityVaultABI.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function main() {
  const { RPC_URL, PRIVATE_KEY, STABILITY_VAULT_ADDRESS } = process.env;
  if (!RPC_URL || !PRIVATE_KEY || !STABILITY_VAULT_ADDRESS) {
    throw new Error("Missing RPC_URL, PRIVATE_KEY, or STABILITY_VAULT_ADDRESS in .env");
  }

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const client = createWalletClient({
    account,
    chain: arbitrum,
    transport: http(RPC_URL),
  }).extend(publicActions);

  const market = "0x8db1397beb16a368711743bc42b69904e4e82122"; // ETH-USDC market (Arbitrum One)
  const amount = parseEther("0.5");

  console.log("[SIM] Simulating openShortYU...");
  const { request } = await client.simulateContract({
    address: STABILITY_VAULT_ADDRESS as `0x${string}`,
    abi: StabilityVaultABI,
    functionName: "openShortYU",
    args: [market, amount],
  });

  console.log("[TX] Sending openShortYU...");
  const hash = await client.writeContract(request);
  console.log("[TX] Sent:", hash);

  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log("[TX] Confirmed in block", receipt.blockNumber);
}

main().catch(console.error);