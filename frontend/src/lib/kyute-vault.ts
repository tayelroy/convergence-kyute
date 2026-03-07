import type { Address } from "viem";
import { isAddress } from "viem";

export const VAULT_ABI = [
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "convertToAssets",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "userPositions",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "asset", type: "address" },
      { name: "isLong", type: "bool" },
      { name: "notional", type: "uint256" },
      { name: "leverage", type: "uint256" },
      { name: "hasBorosHedge", type: "bool" },
      { name: "yuToken", type: "address" },
      { name: "lastUpdateTimestamp", type: "uint256" },
      { name: "targetHedgeNotional", type: "uint256" },
      { name: "currentHedgeNotional", type: "uint256" },
      { name: "currentHedgeIsLong", type: "bool" },
      { name: "targetHedgeIsLong", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "userMarketPositions",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "yuToken", type: "address" },
    ],
    outputs: [
      { name: "asset", type: "address" },
      { name: "isLong", type: "bool" },
      { name: "notional", type: "uint256" },
      { name: "leverage", type: "uint256" },
      { name: "hasBorosHedge", type: "bool" },
      { name: "yuToken", type: "address" },
      { name: "lastUpdateTimestamp", type: "uint256" },
      { name: "targetHedgeNotional", type: "uint256" },
      { name: "currentHedgeNotional", type: "uint256" },
      { name: "currentHedgeIsLong", type: "bool" },
      { name: "targetHedgeIsLong", type: "bool" },
    ],
  },
] as const;

export const DEFAULT_MARKET_YU_TOKENS = {
  ETH: "0x0000000000000000000000000000000000000001" as Address,
  BTC: "0x0000000000000000000000000000000000000002" as Address,
} as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

export const getKyuteVaultAddress = (): Address | undefined => {
  const raw = String(process.env.NEXT_PUBLIC_KYUTE_VAULT_ADDRESS ?? "").trim();
  if (!isAddress(raw)) return undefined;
  return raw as Address;
};

export const formatAddress = (value?: string | null, chars = 4) => {
  if (!value) return "--";
  if (value.length < chars * 2 + 2) return value;
  return `${value.slice(0, chars + 2)}...${value.slice(-chars)}`;
};
