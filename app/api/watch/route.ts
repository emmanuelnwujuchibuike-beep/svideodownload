import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { clientId, trackLimiter } from "@/lib/rate-limit";
import { recordWatchEvent } from "@/lib/social/watch-events";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  postId: z.string().regex(UUID),
  watchMs: z.number().min(0).max(24 * 3_600_000),
  durationMs: z.number().min(0).max(24 * 3_600_000).optional(),
  source: z.string().max(40).optional(),
});

/**
 * POST /api/watch — records how much of a post was actually watched
 * (Feature 15 Part 8). Beacon-style, same posture as /api/posts/:id/view:
 * rate-limited by the same trackLimiter (this fires from the same playback
 * lifecycle, just carrying more than a yes/no), never blocks or slows
 * playback on failure.
 */
export async function POST(request: Request) {
  const { success } = await trackLimiter.limit(clientId(request.headers));
  if (!success) return NextResponse.json({ ok: false }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  let viewerId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewerId = user?.id ?? null;
  } catch {
    /* anon */
  }

  const ipHash = createHash("sha256")
    .update(((request.headers.get("x-forwarded-for") ?? "").split(",")[0] || "anon").trim())
    .digest("hex");

  void recordWatchEvent(
    parsed.data.postId,
    viewerId,
    ipHash,
    parsed.data.watchMs,
    parsed.data.durationMs ?? 0,
    parsed.data.source,
  );

  return NextResponse.json({ ok: true });
}
