import { getWallpaper, sourceFor, type WallpaperSize } from "@/lib/wallpapers";

export const runtime = "nodejs";

/**
 * GET /api/wallpaper?id=<id>&size=thumb|full[&dl=1]
 * Streams a wallpaper's bytes from our side, so display needs no CSP exception and
 * the in-app download needs no CORS. Immutable-cached, so the CDN serves it after
 * the first fetch. `dl=1` adds a download filename.
 */
const IMMUTABLE = "public, max-age=31536000, immutable";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id") || "";
  const size: WallpaperSize = params.get("size") === "full" ? "full" : "thumb";
  const wp = getWallpaper(id);
  if (!wp) return new Response("Not found", { status: 404 });

  let upstream: Response;
  try {
    upstream = await fetch(sourceFor(id, size), { redirect: "follow" });
  } catch {
    return new Response("Upstream error", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) return new Response("Upstream error", { status: 502 });

  const contentType = upstream.headers.get("content-type") || "image/jpeg";
  const headers = new Headers({ "Content-Type": contentType, "Cache-Control": IMMUTABLE });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  if (params.get("dl") === "1") {
    const safe = wp.name.replace(/[^\w.\- ]+/g, "_");
    headers.set("Content-Disposition", `attachment; filename="frenz-wallpaper-${safe}.jpg"`);
  }
  return new Response(upstream.body, { status: 200, headers });
}
