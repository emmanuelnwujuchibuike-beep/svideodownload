import { NextResponse } from "next/server";
import { z } from "zod";

import { assistantLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/comments/assist — AI writing assist for the comment composer
 * (Part 5 tranche 3), reusing the exact direct-Anthropic-fetch pattern
 * already proven twice in this codebase (`/api/assistant`,
 * `lib/moderation/risk-score.ts`) rather than a new integration. User-
 * triggered only (a button in the composer) — this never runs automatically
 * on every keystroke or every comment, so it can only ever improve a draft
 * the author explicitly asked for help with, never silently rewrite one.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY?.trim();
const MODEL = process.env.ASSISTANT_MODEL?.trim() || "claude-haiku-4-5";

const schema = z.object({
  // "summarize" gets a much higher ceiling — its input is an assembled
  // thread (many comments), not one comment's draft text.
  text: z.string().trim().min(1).max(8000),
  mode: z.enum(["polish", "translate", "summarize"]),
  /** Required for mode "translate" — e.g. "Spanish", "Japanese". */
  targetLanguage: z.string().trim().max(40).optional(),
});

function systemPromptFor(mode: "polish" | "translate" | "summarize", targetLanguage?: string): string {
  if (mode === "translate") {
    return `You translate short social-media comments into ${targetLanguage || "English"}. Return ONLY the translated text — no preamble, no quotes, no explanation. Keep any @mentions, #hashtags, and emoji unchanged. Keep the tone and length roughly the same as the original.`;
  }
  if (mode === "summarize") {
    return "You summarize a long comment thread from a social app. You'll receive a list of comments, each prefixed with the author's display name. Write a short, neutral summary (3-5 sentences max) of what the discussion is actually about and the main points raised — do not invent opinions or facts not present in the comments, do not editorialize, and never claim something is \"trending\" or state a count you weren't given. Return ONLY the summary — no preamble, no heading.";
  }
  return "You lightly polish a short social-media comment's grammar and clarity WITHOUT changing its meaning, language, tone, or intent. Return ONLY the improved text — no preamble, no quotes, no explanation. Keep any @mentions, #hashtags, and emoji unchanged. Keep it roughly the same length. If the comment is already fine, return it unchanged.";
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Writing assist isn't configured yet." }, { status: 503 });
  }

  const { success, reset } = await assistantLimiter.limit(`comment-assist:${user.id}`);
  if (!success) {
    return NextResponse.json(
      { error: "Give it a moment before trying again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)) } },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid text." }, { status: 400 });
  if (parsed.data.mode === "translate" && !parsed.data.targetLanguage) {
    return NextResponse.json({ error: "Pick a language to translate to." }, { status: 400 });
  }

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
        max_tokens: 400,
        system: systemPromptFor(parsed.data.mode, parsed.data.targetLanguage),
        messages: [{ role: "user", content: parsed.data.text }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return NextResponse.json({ error: "Couldn't reach the assistant. Try again." }, { status: 502 });

    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    if (!text) return NextResponse.json({ error: "Couldn't get a suggestion. Try again." }, { status: 502 });

    return NextResponse.json({ text: text.slice(0, 1000) });
  } catch {
    return NextResponse.json({ error: "The assistant is unreachable right now." }, { status: 502 });
  }
}
