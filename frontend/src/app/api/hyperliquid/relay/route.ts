import { NextResponse } from "next/server";

type RelayRequest = {
  kind?: "info" | "exchange";
  testnet?: boolean;
  payload?: Record<string, unknown>;
};

const getBaseUrl = (testnet: boolean): string => {
  return testnet ? "https://api.hyperliquid-testnet.xyz" : "https://api.hyperliquid.xyz";
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RelayRequest;
    const kind = body.kind;
    const testnet = body.testnet === true;
    const payload = body.payload;

    if (!kind || (kind !== "info" && kind !== "exchange")) {
      return NextResponse.json({ ok: false, error: "kind must be 'info' or 'exchange'" }, { status: 400 });
    }
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ ok: false, error: "payload must be an object" }, { status: 400 });
    }

    if (kind === "exchange") {
      const action = payload.action as { type?: string } | undefined;
      if (!action?.type) {
        return NextResponse.json({ ok: false, error: "exchange payload must include action.type" }, { status: 400 });
      }
      const allowedTypes = new Set(["order", "updateLeverage"]);
      if (!allowedTypes.has(action.type)) {
        return NextResponse.json(
          { ok: false, error: `Unsupported exchange action.type: ${action.type}` },
          { status: 400 },
        );
      }
    }

    if (kind === "info") {
      const type = (payload as { type?: string }).type;
      const allowedTypes = new Set([
        "allMids",
        "metaAndAssetCtxs",
        "clearinghouseState",
        "l2Book",
        "predictedFundings",
        "historicalOrders",
        "userFillsByTime",
      ]);
      if (!type || !allowedTypes.has(type)) {
        return NextResponse.json({ ok: false, error: `Unsupported info type: ${String(type)}` }, { status: 400 });
      }
    }

    const baseUrl = getBaseUrl(testnet);
    const target = `${baseUrl}/${kind}`;

    const upstream = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    let parsed: unknown = null;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }

    return NextResponse.json(
      {
        ok: upstream.ok,
        status: upstream.status,
        data: parsed,
      },
      { status: upstream.ok ? 200 : 502 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown relay error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
