import { defineChain } from "thirdweb/chains";

export const hyperliquidEvmTestnet = defineChain({
  id: 998,
  name: "Hyperliquid EVM Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpc: "https://rpc.hyperliquid-testnet.xyz/evm",
  testnet: true,
});

export const HYPERLIQUID_TESTNET_CHAIN_ID = 998;

const KYUTE_VAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_KYUTE_CHAIN_ID ?? "31337");
const KYUTE_VAULT_RPC_URL =
  String(process.env.NEXT_PUBLIC_KYUTE_RPC_URL ?? "").trim() || "http://127.0.0.1:8545";

export const kyuteVaultChain =
  KYUTE_VAULT_CHAIN_ID === HYPERLIQUID_TESTNET_CHAIN_ID
    ? hyperliquidEvmTestnet
    : defineChain({
        id: KYUTE_VAULT_CHAIN_ID,
        name: KYUTE_VAULT_CHAIN_ID === 31337 ? "Kyute Local Anvil" : `Kyute Chain ${KYUTE_VAULT_CHAIN_ID}`,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpc: KYUTE_VAULT_RPC_URL,
        testnet: true,
      });

export const kyuteVaultChainLabel =
  KYUTE_VAULT_CHAIN_ID === 31337
    ? "Local Anvil"
    : KYUTE_VAULT_CHAIN_ID === HYPERLIQUID_TESTNET_CHAIN_ID
      ? "Hyperliquid EVM Testnet"
      : `Chain ${KYUTE_VAULT_CHAIN_ID}`;
