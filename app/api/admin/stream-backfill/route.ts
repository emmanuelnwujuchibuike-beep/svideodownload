import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { copyToStream, hasStream } from "@/lib/media/stream";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/stream-backfill — admin-only. Ingests a batch of already-published
 * videos that don't yet have a Cloudflare Stream uid, so old reels gain adaptive
 * playback without a re-upload. `copyToStream` only QUEUES the pull (returns the uid
 * immediately; Stream transcodes in the background), so a batch is cheap. Call
 * repeatedly until `{ remaining: 0 }`. Best-effort + env-gated.
 */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ ok: false, error: "Admins only." }, { status: 403 });
  if (!hasStream) return NextResponse.json({ ok: false, skipped: "stream-disabled" });

  const limit = Math.min(50, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 25));
  const db = createAdminClient();

  const { data: rows } = await db
    .from("posts")
    .select("id, publisher_id, media_url, source_url, platform")
    .eq("status", "published")
    .eq("media_kind", "video")
    .is("stream_uid", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  const posts = (rows ?? []) as {
    id: string;
    publisher_id: string;
    media_url: string | null;
    source_url: string | null;
    platform: string;
  }[];

  let ingested = 0;
  let skipped = 0;
  for (const p of posts) {
    const url = p.media_url || (p.platform === "frenz" ? p.source_url : null);
    if (!url) {
      skipped += 1;
      continue;
    }
    const uid = await copyToStream(url, p.publisher_id);
    if (uid) {
      await db.from("posts").update({ stream_uid: uid }).eq("id", p.id);
      ingested += 1;
    } else {
      skipped += 1;
    }
  }

  const { count: remaining } = await db
    .from("posts")
    .select("id", { head: true, count: "exact" })
    .eq("status", "published")
    .eq("media_kind", "video")
    .is("stream_uid", null);

  return NextResponse.json({ ok: true, ingested, skipped, remaining: remaining ?? 0 });
}
