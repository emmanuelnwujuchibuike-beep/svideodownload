import { NextResponse } from "next/server";

import { storePostMedia } from "@/server/services/store-media-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { hasWorker, WORKER_SECRET, WORKER_URL } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/posts/:id/store-media — owner-only. Persists the post's media to the
 * public `post-media` bucket so it plays natively and Pro users can download it.
 * The heavy download+upload runs on the WORKER (no size/time ceiling); the
 * frontend just authorizes and delegates. Falls back to running locally when
 * this IS the worker (single-deployment / dev).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: "Bad id." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const admin = createAdminClient();
  const { data: post } = await admin
    .from("posts")
    .select("publisher_id, source_url, media_kind, title, media_url")
    .eq("id", id)
    .maybeSingle();
  if (!post) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  if (post.publisher_id !== user.id) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  if (post.media_url) return NextResponse.json({ ok: true, mediaUrl: post.media_url });

  const job = {
    postId: id,
    uid: user.id,
    url: post.source_url as string,
    formatId: post.media_kind === "audio" ? "bestaudio" : "best",
    kind: post.media_kind as "video" | "audio" | "image",
    title: (post.title as string) ?? "video",
  };

  // Delegate to the worker (preferred): unlimited size, no serverless memory cap.
  if (hasWorker) {
    try {
      const res = await fetch(`${WORKER_URL}/api/internal/store-media`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-worker-secret": WORKER_SECRET },
        body: JSON.stringify(job),
      });
      const data = await res.json().catch(() => ({ ok: false, error: "Worker error." }));
      return NextResponse.json(data, { status: res.ok ? 200 : 502 });
    } catch {
      return NextResponse.json({ ok: false, error: "Storage worker unavailable." }, { status: 503 });
    }
  }

  // No separate worker configured → run the pipeline here (dev / single box).
  const result = await storePostMedia(job);
  return NextResponse.json(result, { status: result.ok ? 200 : result.tooLarge ? 200 : 500 });
}
