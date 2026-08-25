import { NextResponse } from "next/server";
import { z } from "zod";

import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/assistant/knowledge";
import { assistantLimiter, clientId } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY?.trim();
const MODEL = process.env.ASSISTANT_MODEL?.trim() || "claude-haiku-4-5";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(2000),
});

const bodySchema = z.object({
  // Keep the last few turns only — caps cost and latency.
  messages: z.array(messageSchema).min(1).max(12),
  /**
   * Optional grounding data for a scoped assistant surface (Feature 15 Part
   * 8's Smart Discovery Assistant is the first caller) — e.g. the viewer's
   * real top interests, a few real new-creator handles, real trending
   * topics. Appended to the system prompt as clearly-labeled DATA, never as
   * instructions, so the model can reference it in an answer without ever
   * inventing a stat, creator or trend that isn't in this string. Capped
   * short — this is a few real facts, not a second knowledge base.
   */
  context: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "The assistant isn't configured yet." },
      { status: 503 },
    );
  }

  const id = clientId(request.headers);
  const { success, reset } = await assistantLimiter.limit(id);
  if (!success) {
    return NextResponse.json(
      { error: "You're sending messages too quickly — give it a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid message." }, { status: 400 });
  }

  const system = parsed.data.context
    ? `${ASSISTANT_SYSTEM_PROMPT}\n\n# Live data for this reply — real, current facts about THIS viewer\nUse ONLY the facts below when answering something personal (their interests, recommendations, what's trending for them). Never invent a creator, topic, sound or count beyond what's listed here — if something isn't in this list, say you don't have that data rather than guessing.\n${parsed.data.context}`
    : ASSISTANT_SYSTEM_PROMPT;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        system,
        messages: parsed.data.messages,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "The assistant is busy right now. Please try again." },
        { status: 502 },
      );
    }

    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const reply =
      data.content
        ?.filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("")
        .trim() || "Sorry, I didn't catch that — could you rephrase?";

    return NextResponse.json({ reply });
  } catch {
    return NextResponse.json(
      { error: "The assistant is unreachable right now. Please try again." },
      { status: 502 },
    );
  }
}
