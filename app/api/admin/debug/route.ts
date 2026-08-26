import { spawn } from "node:child_process";

import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/admin/require-admin";
import { diagnoseEmail } from "@/lib/notify";
import { apifyThreadsDiag } from "@/server/extractors/apify-instagram";
import { cookieHeaderFor } from "@/server/extractors/cookies";
import { proxyDispatcher } from "@/server/proxy/proxy-manager";
import { resolveDownload } from "@/server/services/download-service";
import { lastTranscode, probeExtraction, YtDlpError } from "@/server/services/ytdlp-service";
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
  /*
    🔴🔴 THIS WAS THE WORST OF THE THREE. It used to be:

        if (secret && request.headers.get("x-worker-secret") !== secret) → 403

    With `WORKER_SECRET` unset or an empty string, the `&&` short-circuits and
    the guard disappears entirely — and this is not a read-only stats endpoint.
    Unauthenticated, it would:

      • `?fetch=` — issue arbitrary HTTP requests through the RESIDENTIAL PROXY
        while attaching this app's saved Instagram/Facebook sign-in COOKIES.
        That is a server-side request forgery with the app's own credentials
        attached, billed to our proxy account.
      • `?dl=` / `?url=` — run yt-dlp and ffmpeg on an attacker-supplied URL,
        i.e. arbitrary outbound fetches and unbounded CPU on demand.
      • `?apify=` — spend Apify credits.
      • `?email=` — send mail through Resend.

    "Present but empty" is a real state in this deployment's history
    (`CRON_SECRET=""` broke every cron for weeks), and `&&` cannot tell it from
    "not configured".

    Now: fail CLOSED, and require a non-empty worker secret OR a signed-in
    administrator. There is no configuration in which this endpoint is public.
  */
  const secret = process.env.WORKER_SECRET?.trim();
  const fromWorker = !!secret && request.headers.get("x-worker-secret") === secret;

  if (!fromWorker) {
    const gate = await requireAdminApi();
    if (!gate.ok) return gate.response;
  }

  const sp = new URL(request.url).searchParams;

  // Email diagnostic: live-send a test alert and return Resend's exact response.
  if (sp.get("email")) {
    return NextResponse.json(await diagnoseEmail());
  }

  // ffmpeg capability probe: does this worker's ffmpeg decode VP9/AV1? If the
  // decoder is missing, Instagram/Facebook VP9 can't be transcoded to H.264.
  if (sp.get("lasterr")) {
    return NextResponse.json({ lastTranscode: lastTranscode() });
  }

  const threadsUrl = sp.get("threads");
  if (threadsUrl) {
    return NextResponse.json(await apifyThreadsDiag(threadsUrl));
  }

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

  /*
    Instagram Story actor diagnostic — separate from `apify=` above because
    it's a DIFFERENT actor with a different (Instagram-native) output shape
    (see the doc comment on APIFY_IG_STORY_ACTOR in apify-instagram.ts).
    `?igstory=<username>` — bare username, not a full story URL, since that's
    what the actor's own input schema takes. Surfaces the raw first item's
    keys so a wrong field-name guess (video_versions in particular — inferred
    by analogy, not confirmed against a real video story) can be caught and
    fixed against real data instead of another blind guess.
  */
  const igStoryUsername = sp.get("igstory");
  if (igStoryUsername) {
    const token = process.env.APIFY_TOKEN?.trim().replace(/^["']|["']$/g, "");
    const actorId = process.env.APIFY_IG_STORY_ACTOR?.trim();
    if (!token) return NextResponse.json({ enabled: false, note: "APIFY_TOKEN not set on this service" });
    if (!actorId) return NextResponse.json({ enabled: false, note: "APIFY_IG_STORY_ACTOR not set on this service" });
    const actor = actorId.replace("/", "~");
    try {
      const r = await fetch(
        `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usernames: [igStoryUsername] }),
          signal: AbortSignal.timeout(120000),
        },
      );
      const body = await r.text();
      let json: unknown = null;
      try { json = JSON.parse(body); } catch { /* */ }
      const arr = Array.isArray(json) ? (json as Record<string, unknown>[]) : null;
      const first = arr?.[0] as Record<string, unknown> | undefined;
      return NextResponse.json({
        enabled: true,
        actor: actorId,
        status: r.status,
        items: arr?.length ?? null,
        firstItemKeys: first ? Object.keys(first).slice(0, 25) : null,
        mediaType: first?.media_type ?? null,
        hasVideoVersions: Array.isArray(first?.video_versions),
        hasImageVersions2: !!first?.image_versions2,
        snippet: arr ? null : body.slice(0, 400),
      });
    } catch (e) {
      return NextResponse.json({ enabled: true, error: e instanceof Error ? e.message : "apify story actor failed" });
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
