export const StabilityVaultABI = [
  {
    name: "balances",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    name: "openShortYU",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "market", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;