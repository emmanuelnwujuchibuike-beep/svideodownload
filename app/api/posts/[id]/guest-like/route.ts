import { createHash } from "node:crypto";

import { after, NextResponse } from "next/server";

import { clientId, trackLimiter } from "@/lib/rate-limit";
import { recordGuestLike } from "@/lib/social/posts";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/posts/:id/guest-like — an anonymous "like" from a signed-out visitor,
 * used by the landing-page reels mockup. Deduped per (viewer|ip, post, day) at the
 * DB level (0084), so re-tapping never inflates anything, and it records a real —
 * if anonymous — signal plus a single "Someone liked your reel" notification to the
 * poster. Beacon-style: fire-and-forget, mirrors the view endpoint exactly.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false }, { status: 400 });

  const { success } = await trackLimiter.limit(clientId(request.headers));
  if (!success) return NextResponse.json({ ok: false }, { status: 429 });

  // A guest may also be a signed-in user browsing the marketing page; attribute to
  // them when we can, fall back to a hashed IP otherwise (same as /view).
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

  // after(): the like + notification write must finish even though we respond
  // immediately (a bare void isn't guaranteed to run to completion on Vercel).
  after(() => recordGuestLike(id, viewerId, ipHash));

  return NextResponse.json({ ok: true });
}
