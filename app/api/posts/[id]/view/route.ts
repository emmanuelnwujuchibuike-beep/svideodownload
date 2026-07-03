import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { clientId, trackLimiter } from "@/lib/rate-limit";
import { recordPostView } from "@/lib/social/posts";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/posts/:id/view — records a view when a clip is actually watched in
 * the feed or reels (not just on the post page). Deduped per (viewer|ip, post,
 * day) at the DB level, so repeat plays never inflate the count. Beacon-style.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false }, { status: 400 });

  const { success } = await trackLimiter.limit(clientId(request.headers));
  if (!success) return NextResponse.json({ ok: false }, { status: 429 });

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
  void recordPostView(id, viewerId, ipHash);

  return NextResponse.json({ ok: true });
}
