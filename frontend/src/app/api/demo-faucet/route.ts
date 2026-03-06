import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  formatUnits,
  http,
  isAddress,
  parseEther,
  parseUnits,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const runtime = "nodejs";

const DEFAULT_RPC_URL = "http://127.0.0.1:8545";
const DEFAULT_ETH_AMOUNT = "1";
const DEFAULT_COLLATERAL_AMOUNT = "250";

const VAULT_ASSET_ABI = [
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const ERC20_MINT_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
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

const normalizeEnvString = (value: string | undefined | null): string =>
  String(value ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");

const readEnvFile = (filePath: string): Record<string, string> => {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    output[key] = value;
  }
  return output;
};

const readFallbackEnv = () => {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "../contracts/.env"),
    path.resolve(process.cwd(), "../.env"),
  ];

  return candidates.reduce<Record<string, string>>((acc, file) => {
    return { ...acc, ...readEnvFile(file) };
  }, {});
};

const getEnv = (key: string) => {
  const fallbackEnv = readFallbackEnv();
  return normalizeEnvString(process.env[key] ?? fallbackEnv[key]);
};

const LOCAL_ANVIL_CHAIN = defineChain({
  id: 31337,
  name: "Kyute Local Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [DEFAULT_RPC_URL],
    },
  },
  testnet: true,
});

const isDemoMode = () => {
  return getEnv("NEXT_PUBLIC_DEMO_MODE") === "true";
};

export async function POST(request: Request) {
  if (!isDemoMode()) {
    return NextResponse.json({ ok: false, error: "Demo faucet is disabled outside demo mode." }, { status: 404 });
  }

  try {
    const body = (await request.json()) as {
      walletAddress?: string;
      ethAmount?: string;
      collateralAmount?: string;
    };

    const walletAddress = normalizeEnvString(body.walletAddress);
    if (!isAddress(walletAddress)) {
      return NextResponse.json({ ok: false, error: "Invalid walletAddress." }, { status: 400 });
    }

    const rpcUrl = getEnv("ANVIL_RPC_URL") || getEnv("DEMO_RPC_URL") || DEFAULT_RPC_URL;
    const privateKey = getEnv("ANVIL_PRIVATE_KEY") || getEnv("PRIVATE_KEY");
    const vaultAddress = getEnv("NEXT_PUBLIC_KYUTE_VAULT_ADDRESS") || getEnv("KYUTE_VAULT_ADDRESS");
    const chainId = Number(getEnv("NEXT_PUBLIC_KYUTE_CHAIN_ID") || "31337");

    if (!privateKey) {
      return NextResponse.json({ ok: false, error: "Missing ANVIL_PRIVATE_KEY or PRIVATE_KEY for demo faucet." }, { status: 500 });
    }
    if (!isAddress(vaultAddress)) {
      return NextResponse.json({ ok: false, error: "Missing valid vault address for demo faucet." }, { status: 500 });
    }
    if (chainId !== 31337) {
      return NextResponse.json({ ok: false, error: "Demo faucet only supports Local Anvil (chain 31337)." }, { status: 400 });
    }

    const publicClient = createPublicClient({
      chain: LOCAL_ANVIL_CHAIN,
      transport: http(rpcUrl),
    });

    const account = privateKeyToAccount(privateKey.startsWith("0x") ? (privateKey as `0x${string}`) : (`0x${privateKey}` as `0x${string}`));
    const walletClient = createWalletClient({
      account,
      chain: LOCAL_ANVIL_CHAIN,
      transport: http(rpcUrl),
    });

    const collateralAddress = (await publicClient.readContract({
      address: vaultAddress as Address,
      abi: VAULT_ASSET_ABI,
      functionName: "asset",
      args: [],
    })) as Address;

    const [decimals, symbol] = (await Promise.all([
      publicClient.readContract({
        address: collateralAddress,
        abi: ERC20_MINT_ABI,
        functionName: "decimals",
        args: [],
      }),
      publicClient.readContract({
        address: collateralAddress,
        abi: ERC20_MINT_ABI,
        functionName: "symbol",
        args: [],
      }),
    ])) as [number, string];

    const ethAmount = normalizeEnvString(body.ethAmount) || getEnv("DEMO_FAUCET_ETH_AMOUNT") || DEFAULT_ETH_AMOUNT;
    const collateralAmount =
      normalizeEnvString(body.collateralAmount) || getEnv("DEMO_FAUCET_COLLATERAL_AMOUNT") || DEFAULT_COLLATERAL_AMOUNT;

    const ethWei = parseEther(ethAmount);
    const collateralWei = parseUnits(collateralAmount, decimals);

    const ethHash = await walletClient.sendTransaction({
      to: walletAddress as Address,
      value: ethWei,
      chain: LOCAL_ANVIL_CHAIN,
    });
    await publicClient.waitForTransactionReceipt({ hash: ethHash });

    const mintHash = await walletClient.writeContract({
      address: collateralAddress,
      abi: ERC20_MINT_ABI,
      functionName: "mint",
      args: [walletAddress as Address, collateralWei],
      chain: LOCAL_ANVIL_CHAIN,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });

    return NextResponse.json({
      ok: true,
      walletAddress,
      ethAmount: trimTrailingZeros(formatEther(ethWei)),
      collateralAmount: trimTrailingZeros(formatUnits(collateralWei, decimals)),
      collateralSymbol: symbol,
      txHashes: [ethHash, mintHash],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Demo faucet funding failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

const trimTrailingZeros = (value: string) => (value.includes(".") ? value.replace(/\.?0+$/, "") : value);
