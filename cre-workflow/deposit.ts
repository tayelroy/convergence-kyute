import { createWalletClient, http, parseEther, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { StabilityVaultABI } from "./abi/StabilityVaultABI.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function main() {
  const { ANVIL_PRIVATE_KEY, ANVIL_RPC_URL, STABILITY_VAULT_ADDRESS } = process.env;
  if (!ANVIL_PRIVATE_KEY || !ANVIL_RPC_URL || !STABILITY_VAULT_ADDRESS) {
    throw new Error("Missing ANVIL_PRIVATE_KEY, ANVIL_RPC_URL, or STABILITY_VAULT_ADDRESS in .env");
  }

  const account = privateKeyToAccount(ANVIL_PRIVATE_KEY as `0x${string}`);
  const client = createWalletClient({
    account,
    chain: arbitrum, // OK for an Anvil fork of Arbitrum One
    transport: http(ANVIL_RPC_URL),
  }).extend(publicActions);

  const txHash = await client.writeContract({
    address: STABILITY_VAULT_ADDRESS as `0x${string}`,
    abi: StabilityVaultABI,
    functionName: "deposit",
    value: parseEther("0.5"),
  });

  console.log("Deposit tx:", txHash);
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  console.log("Deposit confirmed in block:", receipt.blockNumber);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});