import { NextResponse } from "next/server";
import { isAddress } from "viem";
import {
  normalizeAiStrategyPlan,
  type AiStrategyPlan,
} from "@/lib/ai-strategy";
import {
  normalizeStrategyPreferences,
  type StrategyPreferences,
} from "@/lib/strategy-preferences";

export const runtime = "nodejs";

const MODEL = process.env.OPENAI_STRATEGY_MODEL ?? "gpt-5-mini";
const API_URL = "https://api.openai.com/v1/responses";

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "Short strategy name." },
    summary: { type: "string", description: "2-3 sentence strategy summary." },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
      description: "Planner confidence in the proposed route.",
    },
    marketPatch: {
      type: "object",
      additionalProperties: false,
      properties: {
        ETHUSDC: {
          type: "object",
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            mode: { type: "string", enum: ["default_hedge", "dynamic_regime_hedge"] },
            entryThresholdBp: { type: "number" },
            exitThresholdBp: { type: "number" },
          },
        },
        BTCUSDC: {
          type: "object",
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            mode: { type: "string", enum: ["default_hedge", "dynamic_regime_hedge"] },
            entryThresholdBp: { type: "number" },
            exitThresholdBp: { type: "number" },
          },
        },
      },
      required: ["ETHUSDC", "BTCUSDC"],
    },
    rationale: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: [
    "title",
    "summary",
    "confidence",
    "marketPatch",
    "rationale",
    "warnings",
  ],
} as const;

const buildPrompt = (input: {
  walletAddress: string | null;
  vaultAddress: string | null;
  preferences: StrategyPreferences;
}): string => {
  const marketLines = Object.entries(input.preferences.markets).map(
    ([market, config]) =>
      `${market}: enabled=${config.enabled}, mode=${config.mode}, entryThresholdBp=${config.entryThresholdBp}, exitThresholdBp=${config.exitThresholdBp}`,
  );

  return [
    "You are filling an existing kYUte strategy form.",
    "Do not invent new backend logic or new fields.",
    "You may only patch these existing form controls per market:",
    "- enabled",
    "- mode (default_hedge or dynamic_regime_hedge)",
    "- entryThresholdBp",
    "- exitThresholdBp",
    "Only change a market if the user's prompt implies a real change.",
    "If the user did not mention a market, leave its patch object empty.",
    "Keep Boros exposure fully collateralized by the user's vault deposit.",
    "Prefer market-neutral positioning and conservative changes unless the user explicitly asks otherwise.",
    "",
    `Connected wallet: ${input.walletAddress ?? "not connected"}`,
    `Vault address: ${input.vaultAddress ?? "unconfigured"}`,
    `Reasoning budget: ${input.preferences.codexTokens} tokens`,
    "Current market settings:",
    ...marketLines,
    "",
    "Return only a JSON object matching the schema.",
    "",
    "User prompt:",
    input.preferences.aiPrompt.trim(),
  ].join("\n");
};

const extractGeneratedJson = (payload: unknown): AiStrategyPlan => {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const output = Array.isArray(root.output) ? root.output : [];
  const message =
    output.find(
      (entry): entry is Record<string, unknown> =>
        !!entry &&
        typeof entry === "object" &&
        entry.type === "message" &&
        Array.isArray((entry as { content?: unknown }).content),
    ) ?? null;
  const content = Array.isArray(message?.content) ? message.content : [];
  const textEntry =
    content.find(
      (entry): entry is Record<string, unknown> =>
        !!entry &&
        typeof entry === "object" &&
        entry.type === "output_text" &&
        typeof (entry as { text?: unknown }).text === "string",
    ) ?? null;

  if (!textEntry || typeof textEntry.text !== "string") {
    throw new Error("OpenAI returned no structured text payload.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textEntry.text);
  } catch {
    throw new Error("OpenAI returned invalid JSON.");
  }

  return normalizeAiStrategyPlan(parsed);
};

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Missing OPENAI_API_KEY for strategy generation." },
        { status: 500 },
      );
    }

    const body = (await request.json()) as {
      walletAddress?: string | null;
      vaultAddress?: string | null;
      preferences?: Partial<StrategyPreferences>;
    };

    const walletAddress = body.walletAddress?.trim() || null;
    const vaultAddress = body.vaultAddress?.trim() || null;
    if (walletAddress && !isAddress(walletAddress)) {
      return NextResponse.json({ ok: false, error: "Invalid wallet address." }, { status: 400 });
    }
    if (vaultAddress && !isAddress(vaultAddress)) {
      return NextResponse.json({ ok: false, error: "Invalid vault address." }, { status: 400 });
    }

    const preferences = normalizeStrategyPreferences(body.preferences);
    const prompt = buildPrompt({
      walletAddress,
      vaultAddress,
      preferences,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          input: prompt,
          text: {
            format: {
              type: "json_schema",
              name: "kyute_strategy_plan",
              strict: true,
              schema: RESPONSE_SCHEMA,
            },
          },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenAI strategy generation failed: ${response.status} ${detail}`);
    }

    const payload = (await response.json()) as unknown;
    const plan = extractGeneratedJson(payload);

    return NextResponse.json({ ok: true, plan, model: MODEL }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === "AbortError"
          ? "OpenAI strategy generation timed out after 45 seconds."
          : error.message
        : "Unknown strategy generation error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
