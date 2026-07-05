import { NextResponse } from "next/server";
import { z } from "zod";

import { metadataLimiter } from "@/lib/rate-limit";
import { CATEGORIES } from "@/lib/social/categories";
import { publishPost } from "@/lib/social/posts";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  sourceUrl: z.string().url().max(2048),
  platform: z.string().trim().min(1).max(40),
  sourceAuthor: z.string().trim().max(80).nullable().optional(),
  mediaKind: z.enum(["video", "image", "audio"]),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).nullable().optional(),
  category: z.enum(CATEGORIES).nullable().optional(),
  thumbnailUrl: z.string().url().max(2048).nullable().optional().or(z.literal("").transform(() => null)),
  durationSec: z.number().int().min(0).max(86_400).nullable().optional(),
  visibility: z.enum(["public", "followers", "private"]).optional(),
  mediaWidth: z.number().int().positive().max(30_000).nullable().optional(),
  mediaHeight: z.number().int().positive().max(30_000).nullable().optional(),
});

/** POST /api/posts — publish a download to the user's profile. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  // Throttle publishing (anti-spam).
  const burst = await metadataLimiter.limit(`publish:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too fast — slow down." }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid post." },
      { status: 400 },
    );
  }

  const result = await publishPost(user.id, {
    sourceUrl: parsed.data.sourceUrl,
    platform: parsed.data.platform,
    sourceAuthor: parsed.data.sourceAuthor ?? null,
    mediaKind: parsed.data.mediaKind,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    category: parsed.data.category ?? null,
    thumbnailUrl: parsed.data.thumbnailUrl ?? null,
    durationSec: parsed.data.durationSec ?? null,
    visibility: parsed.data.visibility,
    mediaWidth: parsed.data.mediaWidth ?? null,
    mediaHeight: parsed.data.mediaHeight ?? null,
  });

  if (!result.ok) {
    const status = result.code === "forbidden" || result.code === "disabled" ? 403 : result.code === "duplicate" ? 409 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, id: result.id });
}
