import { getUserPlan } from "@/lib/monetization/plan";
import { alreadyCounted, clientId, consumeDaily } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getBuiltInWallpaper, sourceFor, type WallpaperSize } from "@/lib/wallpapers";
import { wallpaperDailyLimit, wallpaperLimitMessage } from "@/lib/wallpapers-limits";
import { recordWallpaperDownload, wallpaperImageUrl } from "@/lib/wallpapers-server";

export const runtime = "nodejs";

/**
 * GET /api/wallpaper?id=<id>[&size=thumb|full][&dl=1]
 *
 * Streams a wallpaper's bytes from our side, so display needs no CSP exception
 * and the in-app download needs no CORS. Immutable-cached, so the CDN serves it
 * after the first fetch. `dl=1` adds a download filename and counts the download.
 *
 * Handles both kinds of wallpaper: the built-in placeholders (proxied from their
 * upstream) and the real, admin- or member-published ones (proxied from the
 * public bucket, so a download still arrives with a filename rather than opening
 * in a tab).
 */
const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * The daily wallpaper allowance, enforced (owner, 2026-08-09: "free users can
 * only download 5 wallpapers a day, so reward ad won't be spamming and break
 * AdSense reward ad policy").
 *
 * ── Why it is enforced HERE ───────────────────────────────────────────────────
 * This route is the single door every wallpaper download goes through — the
 * built-in placeholders and the uploaded library both resolve to
 * `/api/wallpaper?id=…&dl=1`. One door means one gate; a check in the viewer and
 * another in the grid would be two rules to keep in step and neither would stop
 * anyone who opened the URL directly.
 *
 * And it has to be server-side. The limit protects a rewarded ad that pays real
 * money and lives under a policy about how often it may be shown: a client-side
 * count is a suggestion, and this one is worth more than a suggestion.
 *
 * ── The `t` receipt ───────────────────────────────────────────────────────────
 * Same idea as the video download quota: a retry of the SAME download rides on
 * the unit its first attempt already paid for. Without it, one flaky transfer
 * costs a free member most of their day — which is precisely the failure that
 * took the video downloads out this morning.
 *
 * Returns null to proceed, or a 429 whose body is a sentence a person can read.
 */
async function enforceWallpaperAllowance(request: Request, downloadId: string | null): Promise<Response | null> {
  let userId: string | null = null;
  // Skip the Supabase round-trip when there is plainly no session — this
  // endpoint is anonymous-heavy and that lookup is the slowest thing in it.
  if ((request.headers.get("cookie") ?? "").includes("-auth-token")) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    } catch {
      /* treat as anonymous */
    }
  }

  const limit = wallpaperDailyLimit(await getUserPlan(userId));
  if (limit === 0) return null; // Pro / Business — no cap, no ad.

  const key = userId ? `wp:u:${userId}` : `wp:ip:${clientId(request.headers)}`;
  if (downloadId && (await alreadyCounted(`${key}:${downloadId}`))) return null;

  const r = await consumeDaily(key, limit, downloadId ? `${key}:${downloadId}` : undefined);
  if (r.allowed) return null;

  return new Response(JSON.stringify({ error: wallpaperLimitMessage(limit), code: "RATE_LIMITED", limit }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": "3600", "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id") || "";
  if (!id) return new Response("Not found", { status: 404 });

  const isDownload = params.get("dl") === "1";

  /*
    Only a DOWNLOAD is metered. Viewing costs nothing: the grid and the reels
    viewer fetch the same route for their pixels, and charging someone for
    scrolling past a wallpaper would burn a free member's whole day in one flick.
  */
  if (isDownload) {
    const downloadId = (params.get("t") ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || null;
    const denied = await enforceWallpaperAllowance(request, downloadId);
    if (denied) return denied;
  }

  // Built-ins keep their thumb/full split; a real wallpaper has one stored
  // image and its own thumbnail, so `size` doesn't apply to it.
  const builtIn = getBuiltInWallpaper(id);
  let upstreamUrl: string;
  let name: string;
  if (builtIn) {
    const size: WallpaperSize = params.get("size") === "full" ? "full" : "thumb";
    upstreamUrl = sourceFor(id, size);
    name = builtIn.name;
  } else {
    const found = await wallpaperImageUrl(id);
    if (!found) return new Response("Not found", { status: 404 });
    upstreamUrl = found.url;
    name = found.name;
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { redirect: "follow" });
  } catch {
    return new Response("Upstream error", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) return new Response("Upstream error", { status: 502 });

  const contentType = upstream.headers.get("content-type") || "image/jpeg";
  const headers = new Headers({ "Content-Type": contentType, "Cache-Control": IMMUTABLE });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  if (isDownload) {
    const safe = name.replace(/[^\w.\- ]+/g, "_");
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    headers.set("Content-Disposition", `attachment; filename="frenz-wallpaper-${safe}.${ext}"`);
    // Fire-and-forget: a counter write must never delay or fail the bytes.
    void recordWallpaperDownload(id);
  }
  return new Response(upstream.body, { status: 200, headers });
}
