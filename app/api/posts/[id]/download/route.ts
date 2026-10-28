import { after, NextResponse } from "next/server";

import { getRequestUser } from "@/lib/auth/request-user";
import { directWorkerBase } from "@/lib/downloads/direct-ticket";
import { cleanHandle, mintWatermarkTicket } from "@/lib/media/watermark-ticket";
import { getUserPlan } from "@/lib/monetization/plan";
import { consumeDaily } from "@/lib/rate-limit";
import { checkDownloadMilestone } from "@/lib/social/milestones";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasWorker, WORKER_SECRET } from "@/lib/worker";

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

/** Best-effort counter bump + Part 8 milestone check. `.then()` is
 * load-bearing — see the [[sw-swx-duplicate-const-bug]] memory; a bare
 * `void` on its own never sent this UPDATE at all. Wrapped in `after()`
 * (not a bare fire-and-forget call) at both call sites below — a serverless
 * Route Handler can freeze the instant its response is sent, so anything
 * still in flight at that moment needs `after()` to be guaranteed to run. */
async function bumpDownloadsCount(admin: ReturnType<typeof createAdminClient>, postId: string, publisherId: string, before: number): Promise<void> {
  const result = await admin.from("posts").update({ downloads_count: before + 1 }).eq("id", postId);
  // Creator analytics (0297): the dated twin of the counter. Best-effort and after the response, like the bump itself.
  await admin.from("post_download_events").insert({ post_id: postId, creator_id: publisherId }).then(() => undefined, () => undefined);
  // Postgrest RESOLVES (doesn't reject) on a query-level error — a failed
  // update must not still fire the milestone check as if the count
  // genuinely advanced.
  if (!result.error) await checkDownloadMilestone(publisherId, before, before + 1);
}

/** One saveable file. A single-media post yields one; an album yields all of them. */
interface DownloadItem {
  url: string;
  kind: string;
  filename: string;
  /**
   * How the watermark gets onto this file, when it carries one:
   * "burned" — `url` is the worker's watermarked video, save it as-is;
   * "draw"   — a photo; the browser stamps /api/watermark/mark onto it.
   */
  watermark?: "burned" | "draw";
}

/**
 * 🔴 THE DOWNLOAD WATERMARK (owner, 2026-10-14: "put a watermark of the person
 * who own the video username on it with frensave brand logo. Only pro upward
 * downloads from feed or reels without watermarks. Let users know when they're
 * downloading to choose with watermark or without").
 *
 * The client sends `{ watermark: boolean }` from the chooser. Without a body
 * (the SDK, native clients) the plan's default applies: watermarked on Free,
 * clean on Pro and up — so nothing that already calls this breaks.
 *
 * A free member asking for the clean file is refused here, not just hidden in
 * the UI. The post's own creator may always choose: it is their media.
 */
const WATERMARK_UPGRADE_MESSAGE = "Upgrade to Pro to download without the watermark.";

async function wantedWatermark(request: Request): Promise<boolean | null> {
  try {
    const body = (await request.json()) as { watermark?: unknown };
    return typeof body.watermark === "boolean" ? body.watermark : null;
  } catch {
    return null;
  }
}

/** Stamps each item with how its watermark is applied; null when a video can't be watermarked here. */
function watermarkItems(items: DownloadItem[], handle: string): DownloadItem[] | null {
  const base = hasWorker ? directWorkerBase() : "";
  const out: DownloadItem[] = [];
  for (const it of items) {
    if (it.kind === "image") {
      out.push({ ...it, watermark: "draw" });
      continue;
    }
    if (it.kind !== "video") {
      out.push(it);
      continue;
    }
    if (!WORKER_SECRET) return null;
    const name = it.filename.replace(/\.[a-z0-9]+$/i, "") + ".mp4";
    const t = mintWatermarkTicket({ src: it.url, handle, name }, WORKER_SECRET);
    out.push({ ...it, url: `${base}/api/posts/watermark?t=${encodeURIComponent(t)}`, filename: name, watermark: "burned" });
  }
  return out;
}

/**
 * Every file this post is made of, in order.
 *
 * 🔴 THE ALBUM BUG (owner, 2026-08-31: "Downloading multi post in feed just
 * dispears and show in the Download page Successful but when I try to review it
 * shows blank").
 *
 * This route only ever looked at `posts.media_url`. On a carousel that column
 * is the COVER — for a video album it is often a poster image, and for some
 * albums it is only the first item. So downloading a 5-item post produced one
 * file, sometimes a still frame, and the viewer got "Successful" over something
 * blank. The other four items were never fetched at all.
 *
 * The real items live in `post_media` (migration 0032), ordered by `idx`, and
 * are only present when there is more than one — which is exactly how the feed
 * itself decides whether a post is an album (see lib/social/home-feed.ts).
 *
 * Falls back to the cover when the table is empty or unreadable: a post from
 * before that migration, or a genuinely single-media post, must keep working.
 */
async function collectItems(
  admin: ReturnType<typeof createAdminClient>,
  post: { id: string; media_url: string; media_kind: string; title: string | null },
): Promise<DownloadItem[]> {
  const cover: DownloadItem = {
    url: post.media_url,
    kind: post.media_kind,
    filename: safeName(post.title, post.id, extFromUrl(post.media_url, post.media_kind)),
  };

  try {
    const { data, error } = await admin
      .from("post_media")
      .select("idx, media_kind, media_url")
      .eq("post_id", post.id)
      .order("idx", { ascending: true });

    /*
      PostgREST RESOLVES on a query-level error rather than throwing, so the
      error has to be inspected explicitly — treating a failed read as "no
      album" is how this silently returns one file for a five-item post.
    */
    if (error || !data || data.length < 2) return [cover];

    return data.map((row, i) => {
      const url = row.media_url as string;
      const kind = (row.media_kind as string) || post.media_kind;
      const ext = extFromUrl(url, kind);
      // Numbered, so an album lands in the gallery in the order it was posted
      // instead of as five files with the same name overwriting each other.
      const base = safeName(post.title, post.id, ext).replace(new RegExp(`\\.${ext}$`), "");
      return { url, kind, filename: `${base}-${i + 1}.${ext}` };
    });
  } catch {
    return [cover];
  }
}

/**
 * POST /api/posts/:id/download — authorize a direct download of a post's media.
 * Enforces the free daily cap, records the download, and returns the media URL +
 * filename for the client to save. Premium/business are unlimited.
 *
 * Returns `items` (every file, for albums) alongside the original `url` /
 * `filename`, which stay pointed at the cover so existing callers — the SDK's
 * `authorizeDownload`, native clients — keep working unchanged.
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

  const plan = await getUserPlan(user.id);
  const mayGoClean = isOwner || plan !== "free";
  const asked = await wantedWatermark(request);
  const watermark = asked ?? !mayGoClean;
  // refused BEFORE the daily cap is spent
  if (!watermark && !mayGoClean) {
    return NextResponse.json({ error: WATERMARK_UPGRADE_MESSAGE, upgrade: true, code: "WATERMARK_REQUIRED" }, { status: 402 });
  }
  let handle = "";
  if (watermark) {
    const { data: profile } = await admin.from("profiles").select("handle").eq("id", post.publisher_id).maybeSingle();
    handle = cleanHandle((profile as { handle?: string | null } | null)?.handle);
    if (!handle) handle = "frenzsave";
  }
  const finish = (items: DownloadItem[], remaining: number | null) => {
    const out = watermark ? watermarkItems(items, handle) : items;
    if (!out) return NextResponse.json({ error: "Watermarked video downloads are unavailable right now. Please try again later." }, { status: 503 });
    return NextResponse.json({ url: out[0]!.url, filename: out[0]!.filename, items: out, remaining, watermark: watermark ? { handle } : null });
  };

  // Free plan: enforce the daily cap. Owners downloading their own post and paid
  // plans skip the cap.
  if (!isOwner) {
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
      after(() => bumpDownloadsCount(admin, id, post.publisher_id as string, post.downloads_count ?? 0));
      const items = await collectItems(admin, { id, media_url: post.media_url, media_kind: post.media_kind, title: post.title });
      return finish(items, cap.remaining);
    }
  }

  after(() => bumpDownloadsCount(admin, id, post.publisher_id as string, post.downloads_count ?? 0));
  const items = await collectItems(admin, { id, media_url: post.media_url, media_kind: post.media_kind, title: post.title });
  return finish(items, null);
}
