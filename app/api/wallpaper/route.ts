import { getBuiltInWallpaper, sourceFor, type WallpaperSize } from "@/lib/wallpapers";
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

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id") || "";
  if (!id) return new Response("Not found", { status: 404 });

  const isDownload = params.get("dl") === "1";

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
