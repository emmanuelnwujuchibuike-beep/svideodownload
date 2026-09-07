import { NextResponse } from "next/server";
import { z } from "zod";

import { frenzAiDailyCredits, frenzAiQuotaKey } from "@/lib/ai/quota";
import { frenzAiTool, toolAvailability } from "@/lib/ai/tools";
import { getUserPlan } from "@/lib/monetization/plan";
import { assistantLimiter, clientId, consumeDailyUnits } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY?.trim();
const MODEL = process.env.ASSISTANT_MODEL?.trim() || "claude-haiku-4-5";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — media tools, run against something the member already saved
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-07: an AI studio called Frenz AI, scoped to media tools, for
 * signed-in members only.
 *
 * ── The file never leaves the device ──────────────────────────────────────────
 *
 * 🔴 Saved media lives in the visitor's own IndexedDB. This route does NOT
 * receive it, does not store it, and there is no upload. For a vision tool the
 * CLIENT draws a handful of stills off the local <video> into a canvas and
 * sends those; the video itself stays where it is. That is what makes this
 * feature possible without turning a downloader into a media host, and it is a
 * property worth keeping — everything below is written to preserve it.
 *
 * Frames are held in memory for the length of one request and passed straight
 * to the model. Nothing is written to a bucket, a table or a log.
 *
 * ── Four gates, in the order that costs least ─────────────────────────────────
 *
 * Identity, then the registry, then the burst limiter, then the daily credits.
 * Deliberately: rejecting an anonymous caller must not cost a Redis round trip,
 * and refusing an impossible tool must not cost a quota charge.
 */

const MAX_FRAMES = 4;
/** ~1.5 MB of base64 per frame is already a generous 1024px JPEG. */
const MAX_FRAME_CHARS = 1_500_000;

const bodySchema = z.object({
  tool: z.string().min(1).max(40),
  mediaKind: z.enum(["video", "image", "audio"]),
  /** Title/description we already hold — never the file. */
  text: z.string().max(2000).optional(),
  /**
   * Stills the client drew off the local media, as `data:image/jpeg;base64,…`.
   * Capped in count and size: this is a glance at a clip, not an upload of it.
   */
  frames: z.array(z.string().max(MAX_FRAME_CHARS)).max(MAX_FRAMES).optional(),
});

/** Split a data URL into the shape Anthropic's image block wants. */
function toImageBlock(dataUrl: string): { type: "base64"; media_type: string; data: string } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  return { type: "base64", media_type: m[1]!, data: m[2]! };
}

const PROMPTS: Record<string, string> = {
  summarise:
    "These stills are taken in order from one short video. Say what happens in it, in 2-4 plain sentences. " +
    "Describe only what is visible. If the stills are too few or too unclear to tell, say so instead of guessing.",
  describe:
    "Describe this image plainly and concretely, in 1-2 sentences, as alt text for someone who cannot see it. " +
    "No preamble, no interpretation of mood, no invented detail.",
  caption:
    "Write one caption the person who saved this could post with it. Natural, specific to what is actually shown, " +
    "under 200 characters, no hashtags unless they are genuinely obvious, and never invent a place, person or event.",
  translate:
    "Translate the text below. Reply with the translation alone — no notes, no transliteration, no explanation. " +
    "If no target language is given, use English.",
};

export async function POST(request: Request) {
  /* 1. IDENTITY. Frenz AI is signed-in only, so this is the cheapest refusal. */
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    /* treated as anonymous below */
  }
  if (!userId) {
    return NextResponse.json({ error: "Sign in to use Frenz AI.", code: "SIGN_IN" }, { status: 401 });
  }

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Frenz AI isn't configured yet." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { tool: toolId, mediaKind, text, frames } = parsed.data;

  /* 2. THE REGISTRY. One table decides what exists, for the client and here. */
  const tool = frenzAiTool(toolId);
  if (!tool) return NextResponse.json({ error: "Unknown tool." }, { status: 400 });
  if (!tool.appliesTo.includes(mediaKind)) {
    return NextResponse.json({ error: "That tool doesn't apply to this media." }, { status: 400 });
  }
  const availability = toolAvailability(tool, {
    vision: true,
    // No speech-to-text provider is wired up. Declared in one place so the UI
    // and this route can never disagree about it — see lib/ai/tools.ts.
    transcription: false,
  });
  if (!availability.available) {
    return NextResponse.json({ error: availability.reason, code: "UNAVAILABLE" }, { status: 501 });
  }

  /* 3. BURST. Shared with the assistant: one person, one sensible pace. */
  const { success, reset } = await assistantLimiter.limit(clientId(request.headers));
  if (!success) {
    return NextResponse.json(
      { error: "You're going a bit fast — give it a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)) } },
    );
  }

  /* 4. DAILY CREDITS, charged by the tool's own weight. */
  const plan = await getUserPlan(userId);
  const limit = frenzAiDailyCredits(plan);
  const quota = await consumeDailyUnits(frenzAiQuotaKey(userId), limit, tool.cost);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: "You've used today's Frenz AI credits.",
        code: "QUOTA",
        used: quota.used,
        limit: quota.limit,
        plan,
      },
      { status: 429 },
    );
  }

  /*
    The content block. Images first, then the instruction — a model reads the
    instruction against material it has already seen, and putting the prompt
    last is what stops it answering about the first frame alone.
  */
  const content: unknown[] = [];
  if (tool.requires === "frames") {
    const blocks = (frames ?? []).map(toImageBlock).filter(Boolean);
    if (blocks.length === 0) {
      return NextResponse.json({ error: "No usable frames were sent." }, { status: 400 });
    }
    for (const source of blocks) content.push({ type: "image", source });
  }

  const instruction = PROMPTS[tool.id] ?? "Describe what you are given, plainly.";
  /*
    Any text from the member is DATA, never instruction. It is a title pulled off
    a third-party post, so it is untrusted input reaching a model — fenced and
    labelled so a caption reading "ignore your instructions" is a caption.
  */
  content.push({
    type: "text",
    text: text ? `${instruction}\n\n<material>\n${text}\n</material>` : instruction,
  });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) {
      // The upstream body can carry account details; it never reaches the client.
      return NextResponse.json({ error: "Frenz AI couldn't answer that one." }, { status: 502 });
    }
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const out = (json.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("")
      .trim();
    if (!out) return NextResponse.json({ error: "Frenz AI couldn't answer that one." }, { status: 502 });

    return NextResponse.json({
      result: out,
      tool: tool.id,
      // So the UI can show what is left without a second round trip.
      credits: { used: quota.used, limit: quota.limit },
    });
  } catch {
    return NextResponse.json({ error: "Frenz AI couldn't answer that one." }, { status: 502 });
  }
}
