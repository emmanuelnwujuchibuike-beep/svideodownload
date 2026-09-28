import { detectPlatform } from "@/lib/platforms";
import type { MediaFormat, PlatformId, VideoMetadata } from "@/types";

import { extractorFetch } from "./http";
import { ExtractionError, type Extractor } from "./types";

/**
 * Fast, no-subprocess TikTok extractor — the "snaptik" approach.
 *
 * Instead of spawning yt-dlp (Python start-up + JS-challenge solving, ~5s), we
 * fetch the watch page with a desktop User-Agent and read the embedded
 * `__UNIVERSAL_DATA_FOR_REHYDRATION__` JSON state. From it we pull every
 * available bitrate (so we can offer up to the highest quality) plus a clean,
 * watermark-free playback URL. On ANY failure we throw, and the registry falls
 * back to yt-dlp so reliability is never worse than before.
 */

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const FETCH_HEADERS = {
  "User-Agent": DESKTOP_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.tiktok.com/",
};

const TIKTOK_TIMEOUT_MS = Number(process.env.TIKTOK_EXTRACTOR_TIMEOUT_MS || 8000);

interface TikTokBitrate {
  Bitrate?: number;
  QualityType?: number;
  GearName?: string;
  CodecType?: string;
  PlayAddr?: { Width?: number; Height?: number; UrlList?: string[] };
}

/**
 * TikTok's real codec per bitrate tier. Its high-quality gears are usually
 * bytevc1 (TikTok's H.265 flavor) — files that iOS saves as a generic "file"
 * and other players render as audio with no picture. Knowing the truth here
 * lets us (a) prefer an H.264 variant at the same height and (b) tell the
 * download service which streams need a transcode vs. play everywhere as-is.
 */
function codecOf(br: TikTokBitrate): "h264" | "hevc" | "av1" {
  const s = `${br.CodecType ?? ""} ${br.GearName ?? ""}`.toLowerCase();
  if (/bytevc2|av01|av1/.test(s)) return "av1";
  if (/bytevc1|h265|hevc|hvc1/.test(s)) return "hevc";
  return "h264";
}

interface TikTokItem {
  id?: string;
  desc?: string;
  createTime?: number | string;
  author?: { uniqueId?: string; nickname?: string };
  music?: { title?: string; playUrl?: string };
  stats?: { playCount?: number; diggCount?: number };
  video?: {
    duration?: number;
    cover?: string;
    originCover?: string;
    dynamicCover?: string;
    playAddr?: string;
    downloadAddr?: string;
    width?: number;
    height?: number;
    bitrateInfo?: TikTokBitrate[];
  };
  // Photo / slideshow posts.
  imagePost?: {
    images?: { imageURL?: { urlList?: string[] } }[];
  };
}

// Short-link resolution is a single redirect hop, not a full page fetch — this
// used to have NO timeout at all (the only leg in this file without one,
// confirmed 2026-08-16), so a slow/wedged vm./vt.tiktok.com left the whole
// extraction stalled before TikWM or the native path even got a turn.
const TIKTOK_RESOLVE_TIMEOUT_MS = Number(process.env.TIKTOK_RESOLVE_TIMEOUT_MS || 6000);

async function resolveUrl(url: string): Promise<string> {
  // Short links (vm./vt.tiktok.com) redirect to the canonical watch URL.
  if (/\b(vm|vt)\.tiktok\.com\b/i.test(url)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIKTOK_RESOLVE_TIMEOUT_MS);
    try {
      const res = await extractorFetch(
        url,
        {
          method: "HEAD",
          redirect: "follow",
          headers: { "User-Agent": DESKTOP_UA },
          signal: controller.signal,
        },
        "tiktok",
      );
      return res.url || url;
    } catch {
      // A stalled/failed redirect resolves to the short link itself — TikWM
      // accepts short links directly, so this degrades to "skip the shortcut,
      // let the next leg handle it" rather than stalling the whole chain.
      return url;
    } finally {
      clearTimeout(timer);
    }
  }
  return url;
}

function extractStateJson(html: string): unknown {
  const marker =
    '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">';
  const start = html.indexOf(marker);
  if (start === -1) {
    // Name what came back instead — a login wall, a verify page and an empty
    // shell need different fixes, and "not found" hid which one it was.
    const title = (html.match(/<title>([^<]{0,80})/i)?.[1] ?? "").trim();
    throw new ExtractionError(`TikTok state not found [html:${html.length}b title:"${title}"]`);
  }
  const from = start + marker.length;
  const end = html.indexOf("</script>", from);
  if (end === -1) throw new ExtractionError("TikTok state not terminated");
  try {
    return JSON.parse(html.slice(from, end));
  } catch {
    throw new ExtractionError("TikTok state not parseable");
  }
}

function findItemStruct(state: unknown): TikTokItem {
  const scope = (state as Record<string, unknown>)?.["__DEFAULT_SCOPE__"] as
    | Record<string, unknown>
    | undefined;
  const detail = scope?.["webapp.video-detail"] as
    | { itemInfo?: { itemStruct?: TikTokItem } }
    | undefined;
  const item = detail?.itemInfo?.itemStruct;
  // Accept video posts AND photo/slideshow (imagePost) posts.
  if (!item?.video && !item?.imagePost?.images?.length) {
    throw new ExtractionError("TikTok item missing");
  }
  return item;
}

/** Image (photo / slideshow) post → one downloadable image per slide. */
function buildImageFormats(item: TikTokItem): MediaFormat[] {
  const headers: Record<string, string> = {
    "User-Agent": DESKTOP_UA,
    Referer: "https://www.tiktok.com/",
  };
  const images = item.imagePost?.images ?? [];
  const formats: MediaFormat[] = [];
  images.forEach((img, i) => {
    const url = img.imageURL?.urlList?.find((u) => u.startsWith("http"));
    if (!url) return;
    formats.push({
      formatId: `img-${i}`,
      kind: "image",
      label: `Photo ${i + 1}`,
      ext: "jpg",
      resolution: null,
      fps: null,
      filesize: null,
      tbr: null,
      vcodec: null,
      acodec: null,
      directUrl: url,
      httpHeaders: headers,
      /*
        🔴 The flag that makes multi-select work (owner, 2026-08-10: "select all
        button in multiple download still doesn't work").

        `PreviewCard` decides a post is batchable from `formats.filter(f =>
        f.isSeparateItem).length > 1`. TikTok never set it — Snapchat did — so
        an eleven-photo slideshow produced eleven formats that the panel could
        not see as separate items. It fell back to `tab === "image" ? imageFormats
        : []`, which means the batch panel and its Select all appeared only when
        the image tab happened to be active, and did nothing otherwise.

        These ARE distinct media from one post, which is exactly what the flag
        means. Set only when there is more than one, so a single-photo post is
        still an ordinary download rather than a batch of one.
      */
      isSeparateItem: images.length > 1,
    });
  });
  // Slideshows usually carry a sound too.
  if (item.music?.playUrl) {
    formats.push({
      formatId: "audio",
      kind: "audio",
      label: "Audio (M4A)",
      ext: "m4a",
      resolution: null,
      fps: null,
      filesize: null,
      tbr: null,
      vcodec: null,
      acodec: "aac",
      directUrl: item.music.playUrl,
      httpHeaders: headers,
    });
  }
  if (formats.length === 0) {
    throw new ExtractionError("No TikTok images found");
  }
  return formats;
}

export function buildFormats(item: TikTokItem): MediaFormat[] {
  const video = item.video!;
  const headers: Record<string, string> = {
    "User-Agent": DESKTOP_UA,
    Referer: "https://www.tiktok.com/",
  };

  const formats: MediaFormat[] = [];

  // WATERMARK-FREE GUARANTEE: we only ever read `bitrateInfo.PlayAddr` and
  // `video.playAddr` — TikTok's clean playback sources. We deliberately never
  // touch `video.downloadAddr`, which is the watermarked "Save video" asset.
  const bitrates = (video.bitrateInfo || [])
    .slice()
    .sort((a, b) => (b.Bitrate ?? 0) - (a.Bitrate ?? 0));

  // ONE entry per height. TikTok exposes most heights in several codecs; an
  // H.264 variant wins over a higher-bitrate bytevc1/AV1 one because it plays
  // everywhere without a server transcode (the transcode is the fragile step
  // that used to turn "high quality" into an audio-only or unplayable file).
  const byHeight = new Map<number, { url: string; codec: string; tbr: number | null }>();
  for (const br of bitrates) {
    const url = br.PlayAddr?.UrlList?.find((u) => u.startsWith("http"));
    if (!url) continue;
    const height = br.PlayAddr?.Height || video.height || 0;
    const codec = codecOf(br);
    const cur = byHeight.get(height);
    if (!cur || (codec === "h264" && cur.codec !== "h264")) {
      byHeight.set(height, { url, codec, tbr: br.Bitrate ? Math.round(br.Bitrate / 1000) : null });
    }
  }

  /*
    ── H.264 FIRST, then by height (owner, carried over from 2026-08-09) ───────

    "TikTok native fallback still needs a transcode (23s TTFB when TikWM refuses
    a video)."

    This is the same defect that was fixed on the TikWM path in `3135d28`
    ("default to the stream that doesn't need re-encoding") — but only that path
    was fixed. Here the list was still ordered by HEIGHT alone, and the loop
    above only prefers H.264 *within* one height. So whenever TikTok offered
    1080p as bytevc1 and 720p as H.264 — its normal shape, since the top gears
    are the ones it encodes in bytevc1 — the tallest tier led the list, became
    the default pick, and every download of that video paid for a full server
    re-encode. That is the 23 seconds.

    Ordering by "plays everywhere" first and resolution second makes the default
    a stream that can be handed straight to the browser. The taller bytevc1 tier
    is still OFFERED, immediately below and truthfully labelled, so nobody loses
    the option — they just stop getting it without asking.

    Height still breaks ties inside each group, so this is "the best H.264", not
    "any H.264".
  */
  const ordered = [...byHeight.entries()].sort((a, b) => {
    const aFast = a[1].codec === "h264" ? 1 : 0;
    const bFast = b[1].codec === "h264" ? 1 : 0;
    if (aFast !== bFast) return bFast - aFast;
    return b[0] - a[0];
  });

  for (const [height, tier] of ordered) {
    const fast = tier.codec === "h264";
    formats.push({
      formatId: `tt-${formats.length}`,
      kind: "video",
      /*
        Say what the slow one costs.

        A row labelled plainly "1080p" next to one labelled "720p" reads as
        strictly better, which is how the expensive path kept getting chosen.
        It is better *pixels* and worse *everything else*, and the label is the
        only place that can be said.
      */
      label: fast
        ? height
          ? `${height}p`
          : "HD"
        : height
          ? `${height}p · converts on download`
          : "Best quality · converts on download",
      ext: "mp4",
      resolution: height ? `${height}p` : null,
      fps: null,
      filesize: null,
      tbr: tier.tbr,
      vcodec: tier.codec,
      acodec: "aac",
      directUrl: tier.url,
      httpHeaders: headers,
    });
  }

  // Fallback to the top-level playAddr if no bitrate list was present.
  if (formats.length === 0 && video.playAddr) {
    formats.push({
      formatId: "tt-0",
      kind: "video",
      label: video.height ? `${video.height}p` : "HD",
      ext: "mp4",
      resolution: video.height ? `${video.height}p` : null,
      fps: null,
      filesize: null,
      tbr: null,
      vcodec: "h264",
      acodec: "aac",
      directUrl: video.playAddr,
      httpHeaders: headers,
    });
  }

  if (formats.length === 0) {
    throw new ExtractionError("No TikTok playback URL found");
  }

  // Audio (original sound) when available — direct proxy, no transcode.
  if (item.music?.playUrl) {
    formats.push({
      formatId: "audio",
      kind: "audio",
      label: "Audio (M4A)",
      ext: "m4a",
      resolution: null,
      fps: null,
      filesize: null,
      tbr: null,
      vcodec: null,
      acodec: "aac",
      directUrl: item.music.playUrl,
      httpHeaders: headers,
    });
  }

  return formats;
}

/**
 * Fallback via the free TikWM API. TikTok serves datacenter IPs a blank page,
 * so when the native page parse fails (and for region-locked videos) this
 * returns the no-watermark video, the sound, OR each image of a photo post.
 */
interface TikWmData {
  id?: string;
  title?: string;
  cover?: string;
  duration?: number;
  play?: string;
  hdplay?: string;
  size?: number;
  hd_size?: number;
  music?: string;
  images?: string[];
  /**
   * 🔴 TIKTOK LIVE PHOTOS — parallel to `images`, and the reason a video was
   * being handed out as a JPG.
   *
   * A photo post's slides are not all stills. A slide can be a Live Photo (a
   * short MP4 with sound), and TikWM reports that in a SECOND array aligned by
   * index with `images`:
   *
   *     images:      [ "…photomode…jpeg", "…photomode…jpeg" ]
   *     live_images: [ null,              "…video_mp4…"     ]
   *
   * `null` means that slide really is a still. A URL means it is a video.
   * Measured on the owner's own link, 2026-09-09.
   */
  live_images?: (string | null)[];
  author?: { nickname?: string; unique_id?: string };
}
function abs(u: string): string {
  return u.startsWith("http") ? u : `https://www.tikwm.com${u}`;
}
/**
 * How long the fast path gets before we stop calling it the fast path.
 *
 * 🔴 It previously had NO timeout at all (owner, 2026-08-09: "TikTok fetching
 * now takes time to fetch" — measured 15.4s and 18.0s on cold links, against
 * 0.96s cached).
 *
 * TikWM is tried FIRST precisely because it is normally sub-second. With no
 * deadline, a slow or wedged TikWM meant the whole chain waited on it before
 * even starting the native parse (8s) and yt-dlp behind that — so the one route
 * chosen for being quick was setting the floor for how slow everything else
 * could be.
 *
 * ── Why 12s and not the 5s this shipped with ─────────────────────────────────
 * 5s was wrong, and measuring it live is the only reason that is known. TikWM
 * was answering in slightly over five seconds, so the cap made it lose every
 * race — and what it lost to is far worse than waiting: the native parse
 * returns bitrate tiers whose codec we cannot trust, every one of which has to
 * be re-encoded. Measured on the owner's link, capping at 5s took the download
 * from 4 seconds to 76.
 *
 * A ceiling was still the right idea; the number was simply set against how
 * long TikWM SHOULD take instead of against what happens when it is skipped.
 * The fallback here is expensive, so the deadline is generous: 12s bounds the
 * pathological case (it used to be unbounded) while still letting the route
 * that produces a directly-streamable H.264 file win whenever it can answer.
 */
const TIKWM_TIMEOUT_MS = Number(process.env.TIKWM_TIMEOUT_MS || 12000);
/**
 * How long to keep waiting for TikWM after the NATIVE route has already
 * answered (see the race in `extract`).
 *
 * Native's formats point at TikTok's own CDN and 403 without the page session
 * cookie, so a native win is an extraction that cannot be downloaded. This is
 * the extra latency we are willing to spend to avoid handing a member formats
 * that will fail — and it is only ever spent when native wins, which is the
 * case that was already broken.
 */
const NATIVE_GRACE_MS = Number(process.env.TIKTOK_NATIVE_GRACE_MS || 3500);

/**
 * TikWM data → our format list. Pure, so the slide mapping is testable.
 *
 * 🔴 Extracted 2026-09-09 because it was NOT testable and it was WRONG: every
 * slide of a photo post was stamped , so a TikTok Live Photo —
 * a real MP4 — was handed out as a JPG. The bug lived inside an async function
 * that also did the fetch, so no test could reach it without a network.
 */
export function buildTikWmFormats(d: TikWmData): MediaFormat[] {
  const headers = { "User-Agent": DESKTOP_UA, Referer: "https://www.tiktok.com/" };
  const formats: MediaFormat[] = [];

  if (Array.isArray(d.images) && d.images.length) {
    /*
      ── 🔴 A SLIDE IS NOT ALWAYS A PHOTO (owner, 2026-09-09) ───────────────

      "this tiktok link is a multiple post of one image and one video but when
      fetched it shows both as image instead of one as video."

      Exactly right, and this was the line. Every slide was stamped
      `kind: "image"` because only `d.images` was read — but TikWM reports
      Live Photos in a SECOND array aligned by index, and for the owner's post
      it held `[null, "…mime_type=video_mp4…"]`. Slide two is a real MP4 and
      was being handed out as a JPG.

      ⚠️ The obvious fix — "if there are images AND a `play`, emit both" —
      would have been WRONG, and checking is what caught it. On a photo post
      `d.play` is the MUSIC track: measured on this link,
      `d.play === d.music_info.play`, `duration: 0`, `hdplay: null`, and the
      host is `v16-ies-music`. Emitting it as a video would have offered the
      soundtrack as the missing clip.

      So the per-slide array is the only honest source, and each slide becomes
      ONE item of whichever kind it actually is — which keeps the batch count
      equal to the number of slides in the post.
    */
    const live = Array.isArray(d.live_images) ? d.live_images : [];
    const multi = d.images.length > 1;

    d.images.forEach((img, i) => {
      const motion = typeof live[i] === "string" && /^https?:\/\//i.test(live[i]!) ? live[i]! : null;

      if (motion) {
        formats.push({
          formatId: `live-${i}`,
          kind: "video",
          // Named for what it is on TikTok, so somebody recognises the slide
          // they are looking at rather than wondering where a photo went.
          label: `Photo ${i + 1} · Live`,
          ext: "mp4",
          resolution: null,
          fps: null,
          filesize: null,
          tbr: null,
          // TikTok's Live Photo renditions are H.264/AAC; naming them lets
          // the download path stream-copy instead of probing and re-encoding.
          vcodec: "h264",
          acodec: "aac",
          directUrl: abs(motion),
          httpHeaders: headers,
          isSeparateItem: multi,
        });
        return;
      }

      formats.push({
        formatId: `img-${i}`,
        kind: "image",
        label: `Photo ${i + 1}`,
        ext: /\.png/i.test(img) ? "png" : "jpg",
        resolution: null,
        fps: null,
        filesize: null,
        tbr: null,
        vcodec: null,
        acodec: null,
        directUrl: abs(img),
        httpHeaders: headers,
        /* Same flag, same reason as `buildImageFormats` — this is the path
           that actually serves photo posts in production, since TikTok gives
           datacenter IPs a blank page. Missing it here is what the owner hit. */
        isSeparateItem: multi,
      });
    });
  } else {
    /*
      Keep BOTH streams — but the H.264 one goes FIRST (owner, 2026-08-09:
      "this TikTok link takes too much time while preparing").

      TikWM's `hdplay` is very often bytevc1/H.265. That plays nowhere
      reliably outside Safari, so the server has to re-encode it to H.264 —
      and a re-encode is not a copy, it is minutes of CPU. Measured on the
      owner's link: `hdplay` took 55 SECONDS to first byte, while `play`
      (already H.264, streamed as-is) took 4.

      `play` was second in this list, so it was never the default; everyone
      got the 55-second path without choosing it. Ordering H.264 first makes
      the fast, universally-playable stream what you get unless you ask for
      the other one — and the other one now says what it costs.
    */
    if (d.play && d.play !== d.hdplay)
      formats.push({
        formatId: d.hdplay ? "tt-sd" : "tt-0",
        kind: "video",
        label: "HD · No watermark",
        ext: "mp4",
        resolution: null,
        fps: null,
        // Delivered byte-for-byte, so this number is exact.
        filesize: typeof d.size === "number" && d.size > 0 ? d.size : null,
        tbr: null,
        vcodec: "h264",
        acodec: "aac",
        directUrl: abs(d.play),
        httpHeaders: headers,
      });
    if (d.hdplay)
      formats.push({
        formatId: "tt-0",
        kind: "video",
        label: "Best quality · converts on download",
        ext: "mp4",
        resolution: null,
        fps: null,
        /*
          🔴 Deliberately NULL, not `hd_size` (owner: "make the file size in
          the quality review accurate… not showing a small file size while
          the main size is higher").

          `hd_size` describes the H.265 SOURCE. What we deliver is that source
          re-encoded to H.264, which is a different file and a much bigger
          one — measured on the owner's link, 16.4 MB advertised against 43.4
          MB delivered, 2.6× out. There is no honest number to put here
          without encoding the file first, so the review shows none rather
          than one that is wrong.
        */
        filesize: null,
        tbr: null,
        vcodec: null,
        acodec: "aac",
        directUrl: abs(d.hdplay),
        httpHeaders: headers,
      });
  }
  if (d.music)
    formats.push({
      formatId: "audio",
      kind: "audio",
      label: "Audio (MP3)",
      ext: "mp3",
      resolution: null,
      fps: null,
      filesize: null,
      tbr: null,
      vcodec: null,
      acodec: "aac",
      directUrl: abs(d.music),
      httpHeaders: headers,
    });
  return formats;
}

/**
 * TikWM's free tier allows ONE request per second, and says so in words rather
 * than with a 429: `{"code":-1,"msg":"Free Api Limit: 1 request/second."}` with
 * HTTP 200. Measured live, 2026-09-28.
 *
 * 🔴 This is a rate limit, not a verdict about the video, and treating it as one
 * was half of an outage: a refused TikWM call answers null, native then wins the
 * race, and native's formats cannot be downloaded at all (see the race below).
 * One short retry converts the commonest transient refusal into an answer.
 */
const TIKWM_RATE_LIMIT_RE = /free api limit/i;
/** Just over the vendor's own window, so the retry lands after it has reset. */
const TIKWM_RATE_LIMIT_RETRY_MS = 1200;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 TIKWM IS PREFERRED — the race decides LATENCY, never the ROUTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Both routes run in parallel, so nothing gets slower. But they do not produce
 * equally usable results, and `Promise.any` treated them as if they did:
 *
 *   TikWM   `tt-sd` / `tt-0` pointing at TikWM's OWN re-encode. Downloads.
 *   native  `tt-0…tt-N` pointing at TikTok's CDN (`v16-webapp-prime…`), which
 *           answers Akamai **403 Access Denied** without the page's session
 *           cookie — and `buildFormats` does not carry it.
 *
 * So when native won, extraction "succeeded" and every video download then
 * failed: ffmpeg could not open the URL and `/api/download` answered 502, which
 * Cloudflare served as its own HTML "502: Bad gateway" page. Measured on
 * production, 2026-09-28, the same video twice:
 *
 *   canonical URL → native (`tt-1,tt-2,tt-0`) → download **502**
 *   short link    → TikWM  (`tt-sd,tt-0`)     → download **200, 6.8 MB**
 *
 * The 2026-09-13 notes predicted exactly this ("so 'let native win' would 403 at
 * download time today"). It became an outage once TikWM got slow enough — helped
 * by its one-request-per-second free limit — to start losing the race routinely.
 *
 * Native remains a genuine fallback for when TikWM cannot answer at all: its
 * title, thumbnail and duration are good, and the registry's yt-dlp fallback can
 * still fetch the media.
 *
 * ── Why the ROUTE is tagged rather than sniffed from the result ─────────────
 * `tt-0` is a format id BOTH routes emit (TikWM when there is no `hdplay`,
 * native when the first tier is the only one), so inspecting the returned
 * formats cannot tell them apart. The tag is which promise resolved.
 *
 * Exported for the test: the grace window is the whole behaviour, and a rule
 * that cannot be asserted on is a rule nobody can trust.
 */
export async function preferTikWm(
  viaApi: Promise<VideoMetadata>,
  viaNative: Promise<VideoMetadata>,
  graceMs: number,
  /** For the log line only. */
  url = "",
): Promise<VideoMetadata> {
  const tagged = await Promise.any([viaApi.then((m) => ({ route: "tikwm" as const, m })), viaNative.then((m) => ({ route: "native" as const, m }))]);
  if (tagged.route === "tikwm") return tagged.m;

  // Native answered first. Spend a little longer on the route whose formats work.
  const preferred = await Promise.race([viaApi.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), graceMs))]);
  if (preferred) return preferred;

  console.warn("[tiktok] native won and TikWM did not answer within the grace window — formats point at TikTok's CDN and may 403 on download", { url: url.slice(0, 120) });
  return tagged.m;
}

async function tikwmExtract(
  url: string,
  platform: ReturnType<typeof detectPlatform>,
): Promise<VideoMetadata | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIKWM_TIMEOUT_MS);
  try {
    const call = async () => {
      const res = await extractorFetch(
        `https://www.tikwm.com/api/?hd=1&url=${encodeURIComponent(url)}`,
        {
          headers: { "User-Agent": DESKTOP_UA, Accept: "application/json" },
          signal: controller.signal,
        },
        "tiktok",
      );
      if (!res.ok) return null;
      return (await res.json()) as { code?: number; msg?: string; data?: TikWmData };
    };

    let j = await call();
    if (j && j.code !== 0 && TIKWM_RATE_LIMIT_RE.test(j.msg ?? "")) {
      // Wait out the vendor's one-per-second window once. The outer abort still
      // bounds the whole attempt, so this cannot extend past TIKWM_TIMEOUT_MS.
      await new Promise((r) => setTimeout(r, TIKWM_RATE_LIMIT_RETRY_MS));
      if (!controller.signal.aborted) j = await call();
    }

    if (!j || j.code !== 0 || !j.data) return null;
    const d = j.data;
    const formats = buildTikWmFormats(d);
    if (formats.length === 0) return null;

    return {
      id: d.id || crypto.randomUUID(),
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: d.title?.trim().slice(0, 200) || "TikTok",
      description: d.title?.trim() || null,
      thumbnail: d.cover ? abs(d.cover) : null,
      durationSeconds: d.duration ?? null,
      creator: d.author?.nickname || d.author?.unique_id || null,
      uploadDate: null,
      viewCount: null,
      likeCount: null,
      webpageUrl: url,
      formats,
      extractor: "tiktok",
    };
  } catch {
    // Includes the abort above: a TikWM that missed its deadline is simply
    // "no answer", and the caller falls through to the native parse.
    return null;
  } finally {
    // Every return path passes through here — a leaked timer would hold the
    // serverless invocation open long after the response has been sent.
    clearTimeout(timer);
  }
}

async function nativeExtract(
  url: string,
  platform: ReturnType<typeof detectPlatform>,
): Promise<VideoMetadata> {
  const resolved = await resolveUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIKTOK_TIMEOUT_MS);
  let html: string;
  try {
    const res = await extractorFetch(
      resolved,
      { headers: FETCH_HEADERS, redirect: "follow", signal: controller.signal },
      "tiktok",
    );
    if (!res.ok) throw new ExtractionError(`TikTok responded ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const item = findItemStruct(extractStateJson(html));
    const isPhoto = !item.video && !!item.imagePost?.images?.length;
    const video = item.video;
    const createTime = item.createTime ? Number(item.createTime) : null;
    const firstImage =
      item.imagePost?.images?.[0]?.imageURL?.urlList?.find((u) =>
        u.startsWith("http"),
      ) ?? null;

    return {
      id: item.id || crypto.randomUUID(),
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: item.desc?.trim() || (isPhoto ? "TikTok photos" : "TikTok video"),
      description: item.desc?.trim() || null,
      thumbnail: video?.cover || video?.originCover || firstImage,
      durationSeconds: video?.duration ?? null,
      creator: item.author?.nickname || item.author?.uniqueId || null,
      uploadDate:
        createTime && Number.isFinite(createTime)
          ? new Date(createTime * 1000).toISOString().slice(0, 10)
          : null,
      viewCount: item.stats?.playCount ?? null,
      likeCount: item.stats?.diggCount ?? null,
      webpageUrl: resolved,
      formats: isPhoto ? buildImageFormats(item) : buildFormats(item),
      extractor: "tiktok",
    };
}

export const tiktokExtractor: Extractor = {
  name: "tiktok",
  canHandle(_url: string, platform: PlatformId) {
    return platform === "tiktok";
  },
  async extract(url: string): Promise<VideoMetadata> {
    const platform = detectPlatform(url);

    /*
      RACE TikWM and native, don't chain them (owner, 2026-08-16: "tiktok
      still delays a lot to fetch" — a repeat complaint after the earlier
      round of timeout fixes).

      Measured LIVE against tikwm.com's own API, independent of anything in
      this codebase: 9, 11, 14, then 16 seconds across four back-to-back
      calls — getting slower, not settling. That is the free third-party
      service this extractor was calling FIRST and awaiting in full (up to
      TIKWM_TIMEOUT_MS) before native ever got a turn. Serially, a slow TikWM
      call added its ENTIRE duration on top of whatever native takes; the
      worst case was their SUM.

      Racing them removes that stacking — the worst case becomes whichever
      route is slower, not both added together. `nativeExtract` still often
      fails outright from a datacenter IP (the reason TikWM was made primary
      in the first place — see the removed comment this replaced), and
      `extractorFetch` already retries it through the residential proxy on a
      detected block, so this costs one extra outbound request in the common
      case and nothing in reliability: both routes still run, and whichever
      answers first wins.

      Resolving the short link up front so BOTH routes get the canonical watch
      URL (TikWM occasionally 404s a `vt.tiktok.com` link it would resolve fine).
    */
    let canonical = url;
    try {
      canonical = await resolveUrl(url);
    } catch {
      /* keep the original; TikWM handles most short links itself */
    }

    const viaApi = tikwmExtract(canonical, platform).then(
      (r) => r ?? Promise.reject(new ExtractionError("TikWM returned no usable media")),
    );
    const viaNative = nativeExtract(canonical, platform);

    try {
      /*
        ── 🔴 TIKWM IS PREFERRED, AND THE RACE NO LONGER DECIDES (2026-09-28) ──

        `Promise.any` handed the member whichever route answered FIRST. That is
        the right shape for LATENCY and the wrong shape for this pair, because
        the two routes do not produce equally usable results:

          TikWM   `tt-sd` / `tt-0` pointing at TikWM's own re-encode. Downloads.
          native  `tt-0…tt-N` pointing at TikTok's CDN (`v16-webapp-prime…`),
                  which answers Akamai **403 Access Denied** without the page's
                  session cookie — and `buildFormats` does not carry it.

        So when native won, extraction "succeeded" and every video download then
        failed: ffmpeg could not open the URL, `/api/download` answered 502, and
        Cloudflare served its own HTML 502 page over it. Measured on production
        the same day, on one video, twice:

          canonical URL → native (`tt-1,tt-2,tt-0`) → download **502**
          short link    → TikWM  (`tt-sd,tt-0`)     → download **200, 6.8 MB**

        This exact outcome was predicted in the 2026-09-13 notes ("so 'let native
        win' would 403 at download time today"); it became an outage once TikWM
        got slow enough — helped by its one-request-per-second limit — to start
        losing the race routinely.

        The rule, and the evidence for it, are in `preferTikWm` above.
      */
      return await preferTikWm(viaApi, viaNative, NATIVE_GRACE_MS, canonical);
    } catch (err) {
      /*
        Both routes failed — the registry falls back to yt-dlp from here, same
        as before. Say WHY each one failed (2026-09-13): `Promise.any` hands
        back an AggregateError whose `errors` hold the two rejections, and
        this message used to drop both. The native route was failing silently
        for days behind a TikWM that answered; the first time anybody could
        see the reason was when TikWM stopped answering too.
      */
      const reasons =
        err instanceof AggregateError
          ? err.errors.map((e) => (e instanceof Error ? e.message : String(e))).join(" | ")
          : err instanceof Error
            ? err.message
            : String(err);
      throw new ExtractionError(`TikTok extraction failed on all direct routes [tikwm/native: ${reasons}]`);
    }
  },
};
