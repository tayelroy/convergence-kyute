import { defineChain } from "thirdweb/chains";

export const hyperliquidEvmTestnet = defineChain({
  id: 998,
  name: "Hyperliquid EVM Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpc: "https://rpc.hyperliquid-testnet.xyz/evm",
  testnet: true,
});

export const HYPERLIQUID_TESTNET_CHAIN_ID = 998;

