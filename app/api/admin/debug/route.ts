import { spawn } from "node:child_process";

import { NextResponse } from "next/server";

import { cookieHeaderFor } from "@/server/extractors/cookies";
import { proxyDispatcher } from "@/server/proxy/proxy-manager";
import { resolveDownload } from "@/server/services/download-service";
import { probeExtraction, YtDlpError } from "@/server/services/ytdlp-service";
import type { MediaKind } from "@/types";

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

  // ffmpeg capability probe: does this worker's ffmpeg decode VP9/AV1? If the
  // decoder is missing, Instagram/Facebook VP9 can't be transcoded to H.264.
  if (sp.get("ffmpeg")) {
    const run = (args: string[]) =>
      new Promise<{ rc: number | null; out: string }>((resolve) => {
        let out = "";
        try {
          const c = spawn(process.env.FFMPEG_PATH || "ffmpeg", args, { windowsHide: true });
          c.stdout?.on("data", (d: Buffer) => (out += d.toString()));
          c.stderr?.on("data", (d: Buffer) => (out += d.toString()));
          c.on("error", (e) => resolve({ rc: -1, out: String(e) }));
          c.on("close", (rc) => resolve({ rc, out }));
        } catch (e) {
          resolve({ rc: -1, out: String(e) });
        }
      });
    const ver = await run(["-hide_banner", "-version"]);
    const dec = await run(["-hide_banner", "-loglevel", "error", "-decoders"]);
    const want = ["vp9", "vp8", "av1", "h264"];
    const found = dec.out
      .split("\n")
      .filter((l) => want.some((w) => new RegExp(`\\b${w}\\b`, "i").test(l)))
      .map((l) => l.trim());
    return NextResponse.json({
      version: ver.out.split("\n")[0] ?? null,
      decodersRc: dec.rc,
      vp9Decode: /(\bvp9\b)/i.test(dec.out),
      av1Decode: /(\bav1\b)/i.test(dec.out),
      decoders: found.slice(0, 12),
    });
  }

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
    const token = process.env.APIFY_TOKEN?.trim().replace(/^["']|["']$/g, "");
    const actor = (process.env.APIFY_IG_ACTOR || "apify/instagram-scraper").trim().replace("/", "~");
    if (!token) return NextResponse.json({ enabled: false, note: "APIFY_TOKEN not set on this service" });
    // Surface token shape (NOT the token) to spot wrong/empty/typo'd values.
    const shape = { len: token.length, prefix: token.slice(0, 9), looksApify: token.startsWith("apify_api_") };
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
        tokenShape: shape,
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

  const dl = sp.get("dl");
  if (dl) {
    const fmt = sp.get("fmt") || "best";
    const kind = (sp.get("kind") || "video") as MediaKind;
    try {
      const r = await resolveDownload(dl, fmt, kind, "test");
      // Drain the stream so the producer (yt-dlp/ffmpeg) actually runs.
      let bytes = 0;
      const reader = r.stream.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value?.length ?? 0;
        if (bytes > 256_000) break; // enough to confirm real media
      }
      reader.cancel().catch(() => {});
      return NextResponse.json({ ok: true, ext: r.ext, contentType: r.contentType, bytes });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        code: e instanceof YtDlpError ? e.code : "ERR",
        message: (e instanceof Error ? e.message : String(e))?.slice(-400),
        stderr: (e instanceof YtDlpError ? e.stderr : undefined)?.slice(-400),
      });
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
