import { NextResponse } from "next/server";

import { getRequestUser } from "@/lib/auth/request-user";
import { getUserPlan } from "@/lib/monetization/plan";
import { consumeDaily } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Free members can download 5 posts/day directly from the feed/reels; paid plans
// are unlimited. (Kept separate from the downloader product's own daily cap.)
const FREE_DAILY_DOWNLOADS = 5;

function extFromUrl(url: string, kind: string): string {
  const m = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(url);
  if (m) return m[1]!.toLowerCase();
  return kind === "image" ? "jpg" : kind === "audio" ? "mp3" : "mp4";
}

function safeName(title: string | null, id: string, ext: string): string {
  const base = (title || "frenz").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || `frenz-${id.slice(0, 8)}`;
  return `${base}.${ext}`;
}

/**
 * POST /api/posts/:id/download — authorize a direct download of a post's media.
 * Enforces the free daily cap, records the download, and returns the media URL +
 * filename for the client to save. Premium/business are unlimited.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  // Accepts a bearer token (native) or the cookie session (web).
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to download." }, { status: 401 });

  const admin = createAdminClient();
  const { data: post } = await admin
    .from("posts")
    .select("id, media_url, media_kind, title, visibility, status, publisher_id, downloads_count")
    .eq("id", id)
    .maybeSingle();
  if (!post || !post.media_url) return NextResponse.json({ error: "Not available." }, { status: 404 });

  const isOwner = post.publisher_id === user.id;
  const visible = post.status === "published" && (post.visibility === "public" || isOwner);
  if (!visible) return NextResponse.json({ error: "Not available." }, { status: 403 });

  // Free plan: enforce the daily cap. Owners downloading their own post and paid
  // plans skip the cap.
  if (!isOwner) {
    const plan = await getUserPlan(user.id);
    if (plan === "free") {
      const cap = await consumeDaily(`postdl:${user.id}`, FREE_DAILY_DOWNLOADS);
      if (!cap.allowed) {
        return NextResponse.json(
          {
            error: `You've used your ${FREE_DAILY_DOWNLOADS} free downloads for today. Go Pro for unlimited.`,
            remaining: 0,
            limit: FREE_DAILY_DOWNLOADS,
            upgrade: true,
          },
          { status: 402 },
        );
      }
      // Best-effort download counter bump. Supabase's query builder is a lazy
      // thenable — the request only actually fires once something calls
      // `.then()`/awaits it, so a bare `void` on its own (with no `.then()`
      // anywhere in the chain) never sent this UPDATE at all. Verified this
      // empirically, not just from reading the source.
      admin.from("posts").update({ downloads_count: (post.downloads_count ?? 0) + 1 }).eq("id", id).then(undefined, () => {});
      const ext = extFromUrl(post.media_url, post.media_kind);
      return NextResponse.json({ url: post.media_url, filename: safeName(post.title, id, ext), remaining: cap.remaining });
    }
  }

  admin.from("posts").update({ downloads_count: (post.downloads_count ?? 0) + 1 }).eq("id", id).then(undefined, () => {});
  const ext = extFromUrl(post.media_url, post.media_kind);
  return NextResponse.json({ url: post.media_url, filename: safeName(post.title, id, ext), remaining: null });
}
