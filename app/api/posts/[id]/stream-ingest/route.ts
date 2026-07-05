import { NextResponse } from "next/server";

import { getRequestUser } from "@/lib/auth/request-user";
import { copyToStream, hasStream } from "@/lib/media/stream";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/posts/:id/stream-ingest — owner-only, best-effort. Pulls a published
 * video into Cloudflare Stream (adaptive HLS: auto quality ladder, AV1/H.265/H.264,
 * global edge) and stores the returned uid on the post, so the reel plays via ABR
 * instead of downloading the whole MP4. Fully additive:
 *   - No Stream credentials → 200 { ok:false, skipped:"stream-disabled" }, no-op.
 *   - Already ingested → returns the existing uid.
 *   - Non-frenz (external) sources with no stored MP4 are skipped (nothing to pull).
 * The original R2/MP4 stays as the archival + fallback source.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: "Bad id." }, { status: 400 });

  const me = await getRequestUser(request);
  if (!me) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const db = createAdminClient();
  const { data: post } = await db
    .from("posts")
    .select("publisher_id, media_kind, media_url, source_url, platform, stream_uid")
    .eq("id", id)
    .maybeSingle();
  if (!post) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  if (post.publisher_id !== me.id) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  if (post.media_kind !== "video") return NextResponse.json({ ok: false, skipped: "not-video" });
  if (post.stream_uid) return NextResponse.json({ ok: true, uid: post.stream_uid as string });
  if (!hasStream) return NextResponse.json({ ok: false, skipped: "stream-disabled" });

  // A public URL Cloudflare can fetch: the stored MP4, or (for our own studio
  // uploads) the R2 source URL. External platform URLs aren't reliably pullable.
  const url = (post.media_url as string | null) || (post.platform === "frenz" ? (post.source_url as string | null) : null);
  if (!url) return NextResponse.json({ ok: false, skipped: "no-pullable-url" });

  const uid = await copyToStream(url, post.publisher_id as string);
  if (!uid) return NextResponse.json({ ok: false, error: "Stream ingest failed." }, { status: 502 });

  try {
    await db.from("posts").update({ stream_uid: uid }).eq("id", id);
  } catch {
    /* column exists (migration 0016) — but stay resilient */
  }
  return NextResponse.json({ ok: true, uid });
}
