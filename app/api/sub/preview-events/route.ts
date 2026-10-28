import { NextResponse } from "next/server";
import { z } from "zod";

import { clientId, trackLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ kind: z.enum(["preview_seen", "subscribe_tapped"]), postIds: z.array(z.string().uuid()).min(1).max(30) }).strict();

/**
 * POST /api/sub/preview-events — the first two steps of an exclusive post's funnel (0297): its locked preview SEEN, and
 * Subscribe TAPPED on it. Signed-in visitors only (a guest has no stable identity to count once), never the creator on
 * their own posts, once per viewer, post, kind and day (the table's key). The creator is read from the post, never
 * taken from the client. Best-effort: an error answers 204 and the visitor notices nothing.
 */
export async function POST(request: Request) {
  const { success } = await trackLimiter.limit(`sub-preview:${clientId(request.headers)}`);
  if (!success) return new NextResponse(null, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new NextResponse(null, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse(null, { status: 204 });
  try {
    const db = createAdminClient();
    const { data: posts } = await db.from("sub_posts").select("id, creator_id").in("id", [...new Set(parsed.data.postIds)]).eq("status", "published");
    const rows = ((posts ?? []) as { id: string; creator_id: string }[])
      .filter((p) => p.creator_id !== user.id)
      .map((p) => ({ post_id: p.id, creator_id: p.creator_id, viewer_id: user.id, kind: parsed.data.kind }));
    if (rows.length) await db.from("sub_preview_events").upsert(rows, { onConflict: "post_id,viewer_id,kind,day", ignoreDuplicates: true });
  } catch {
    /* best effort: the funnel misses one event, nothing else */
  }
  return new NextResponse(null, { status: 204 });
}
