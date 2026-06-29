import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { hasWorker, proxyToWorker } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 90 * 1024 * 1024; // 90 MB cap for serverless memory safety

const EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * POST /api/posts/:id/store-media — owner-only. Fetches the post's media via the
 * worker download pipeline and uploads it to the public `post-media` bucket so
 * it plays natively and Pro users can download it. Best-effort + size-capped;
 * large media is skipped (the viewer falls back to on-demand download).
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
  if (!hasWorker) return NextResponse.json({ ok: false, error: "Storage worker unavailable." }, { status: 503 });

  const selector = post.media_kind === "audio" ? "bestaudio" : "best";

  try {
    const res = await proxyToWorker(
      "/api/download",
      { url: post.source_url, formatId: selector, kind: post.media_kind, title: post.title },
      `store:${user.id}`,
    );
    if (!res.ok || !res.body) return NextResponse.json({ ok: false, error: "Couldn't fetch media." }, { status: 502 });

    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) return NextResponse.json({ ok: false, error: "Too large to store.", tooLarge: true });

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return NextResponse.json({ ok: false, error: "Too large to store.", tooLarge: true });

    const contentType = (res.headers.get("content-type") || "video/mp4").split(";")[0]!.trim();
    const ext = EXT[contentType] ?? (post.media_kind === "audio" ? "mp3" : "mp4");
    const path = `${user.id}/${id}.${ext}`;

    const { error: upErr } = await admin.storage.from("post-media").upload(path, buf, { contentType, upsert: true });
    if (upErr) return NextResponse.json({ ok: false, error: "Upload failed." }, { status: 500 });

    const { data: pub } = admin.storage.from("post-media").getPublicUrl(path);
    const mediaUrl = pub.publicUrl;
    await admin.from("posts").update({ media_url: mediaUrl }).eq("id", id);

    return NextResponse.json({ ok: true, mediaUrl });
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't store media." }, { status: 500 });
  }
}
