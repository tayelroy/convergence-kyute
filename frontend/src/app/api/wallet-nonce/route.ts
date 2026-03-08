import { NextResponse } from "next/server";
import { createPublicClient, http, isAddress, type Address } from "viem";

const normalizeLocalRpcUrl = (value: string) => value.replace("http://localhost:", "http://127.0.0.1:");

const getRpcUrl = () =>
  normalizeLocalRpcUrl(
    String(process.env.NEXT_PUBLIC_KYUTE_RPC_URL ?? "").trim() ||
      String(process.env.ANVIL_RPC_URL ?? "").trim() ||
      "http://127.0.0.1:8545",
  );

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const walletAddress = String(url.searchParams.get("walletAddress") ?? "").trim();
    if (!isAddress(walletAddress)) {
      return NextResponse.json({ ok: false, error: "Invalid walletAddress." }, { status: 400 });
    }

    const publicClient = createPublicClient({
      transport: http(getRpcUrl()),
    });

    const nonce = await publicClient.getTransactionCount({
      address: walletAddress as Address,
      blockTag: "latest",
    });

    return NextResponse.json({ ok: true, nonce }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read wallet nonce.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
