import { NextResponse } from "next/server";

import { cookieHeaderFor } from "@/server/extractors/cookies";
import { proxyDispatcher } from "@/server/proxy/proxy-manager";
import { probeExtraction } from "@/server/services/ytdlp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IG_APP_UA =
  "Instagram 269.0.0.18.75 Android (30/11; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 314665256)";

/**
 * Secret-gated diagnostics. `?url=` → yt-dlp probe. `?fetch=` → raw HTTP fetch
 * via the residential proxy with sign-in cookies (to test private APIs). All
 * gated by WORKER_SECRET. Returns redacted summaries (no tokens/media URLs).
 */
export async function GET(request: Request) {
  const secret = process.env.WORKER_SECRET;
  if (secret && request.headers.get("x-worker-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const sp = new URL(request.url).searchParams;

  const fetchUrl = sp.get("fetch");
  if (fetchUrl) {
    const useProxy = sp.get("proxy") !== "0";
    const cookie = cookieHeaderFor(fetchUrl);
    try {
      const res = await fetch(fetchUrl, {
        headers: {
          "User-Agent": IG_APP_UA,
          "X-IG-App-ID": "936619743392459",
          Accept: "*/*",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        redirect: "manual",
        // @ts-expect-error undici dispatcher
        dispatcher: useProxy ? proxyDispatcher() : undefined,
      });
      const body = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(body);
      } catch {
        /* not json */
      }
      const j = json as { items?: { media_type?: number; carousel_media?: unknown[] }[] } | null;
      return NextResponse.json({
        status: res.status,
        hasCookie: !!cookie,
        len: body.length,
        isJson: !!json,
        items: j?.items?.length ?? null,
        mediaType: j?.items?.[0]?.media_type ?? null,
        carousel: Array.isArray(j?.items?.[0]?.carousel_media)
          ? j!.items![0]!.carousel_media!.length
          : null,
        snippet: json ? null : body.slice(0, 160),
      });
    } catch (err) {
      return NextResponse.json({
        error: err instanceof Error ? err.message : "fetch failed",
      });
    }
  }

  const apifyUrl = sp.get("apify");
  if (apifyUrl) {
    const token = process.env.APIFY_TOKEN;
    const actor = (process.env.APIFY_IG_ACTOR || "apify/instagram-scraper").replace("/", "~");
    if (!token) return NextResponse.json({ enabled: false, note: "APIFY_TOKEN not set on this service" });
    try {
      const r = await fetch(
        `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ directUrls: [apifyUrl], resultsType: "posts", resultsLimit: 1, addParentData: false }),
          signal: AbortSignal.timeout(120000),
        },
      );
      const body = await r.text();
      let json: unknown = null;
      try { json = JSON.parse(body); } catch { /* */ }
      const arr = Array.isArray(json) ? (json as Record<string, unknown>[]) : null;
      return NextResponse.json({
        enabled: true,
        actor,
        status: r.status,
        items: arr?.length ?? null,
        firstKeys: arr?.[0] ? Object.keys(arr[0]).slice(0, 20) : null,
        hasVideoUrl: arr?.[0]?.videoUrl ? true : false,
        hasDisplayUrl: arr?.[0]?.displayUrl ? true : false,
        childPosts: Array.isArray(arr?.[0]?.childPosts) ? (arr![0]!.childPosts as unknown[]).length : null,
        snippet: arr ? null : body.slice(0, 300),
      });
    } catch (e) {
      return NextResponse.json({ enabled: true, error: e instanceof Error ? e.message : "apify failed" });
    }
  }

  const url = sp.get("url");
  if (!url) return NextResponse.json({ error: "Missing ?url= or ?fetch=" }, { status: 400 });
  try {
    return NextResponse.json(await probeExtraction(url));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "probe failed" },
      { status: 500 },
    );
  }
}
