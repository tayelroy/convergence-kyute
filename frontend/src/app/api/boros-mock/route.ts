import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, isAddress, type Address } from "viem";

const DEFAULT_ANVIL_RPC_URL = "http://localhost:8545";
const DEFAULT_YU_TOKEN = "0x0000000000000000000000000000000000000001";

const MOCK_BOROS_ABI = [
  {
    type: "function",
    name: "getPosition",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint256" },
      { name: "isLong", type: "bool" },
    ],
  },
] as const;

const isDemoMode = () => {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
};

const normalizeEnvString = (value: string | undefined | null): string =>
  String(value ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");

const inactivePosition = (reason?: string) => ({
  amount: "0",
  isLong: false,
  ...(reason ? { warning: reason } : {}),
});

export async function GET(req: NextRequest) {
  if (!isDemoMode()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const params = req.nextUrl.searchParams;
  const user = normalizeEnvString(params.get("user"));
  const tokenCandidate = normalizeEnvString(params.get("token")) || normalizeEnvString(process.env.BOROS_YU_TOKEN);
  const token = isAddress(tokenCandidate) ? tokenCandidate : DEFAULT_YU_TOKEN;

  if (!user || !isAddress(user)) {
    return NextResponse.json(inactivePosition("Invalid or missing 'user' address"), { status: 200 });
  }

  const rpcUrl = normalizeEnvString(process.env.ANVIL_RPC_URL) || DEFAULT_ANVIL_RPC_URL;
  const routerAddress = normalizeEnvString(process.env.BOROS_ROUTER_ADDRESS);
  if (!routerAddress || !isAddress(routerAddress)) {
    return NextResponse.json(inactivePosition("BOROS_ROUTER_ADDRESS not configured"), { status: 200 });
  }

  try {
    const client = createPublicClient({
      transport: http(rpcUrl),
    });

    const [amount, isLong] = (await client.readContract({
      address: routerAddress as Address,
      abi: MOCK_BOROS_ABI,
      functionName: "getPosition",
      args: [user as Address, token as Address],
    })) as [bigint, boolean];

    return NextResponse.json(
      {
        amount: amount.toString(),
        isLong,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read mock Boros position";
    const warning = message.includes("getPosition")
      ? "BOROS_ROUTER_ADDRESS does not point to the demo MockBorosRouter with getPosition(user, token). Redeploy mock via scripts/start_demo.sh and update frontend BOROS_ROUTER_ADDRESS."
      : message;
    return NextResponse.json(inactivePosition(warning), { status: 200 });
  }
}
