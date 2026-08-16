import { detectPlatform } from "@/lib/platforms";
import { extractMetadata as ytdlpExtract } from "@/server/services/ytdlp-service";
import type { MediaFormat, PlatformId, VideoMetadata } from "@/types";

import { extractorFetch } from "./http";
import { DESKTOP_UA, firstMatch, metaContent, unescapeJsonUrl } from "./parse";
import { ExtractionError, type Extractor } from "./types";

/**
 * Facebook custom extractor (watch / video / reel / photo posts).
 *
 * Public videos embed direct SD/HD MP4 URLs in the page JSON
 * (`playable_url` / `playable_url_quality_hd`, or the newer
 * `browser_native_*_url`). We surface both qualities for a fast, no-yt-dlp
 * download. Facebook WAF-walls datacenter IPs, so without EXTRACTOR_PROXY this
 * usually falls back to yt-dlp.
 *
 * ── Why there is more than one User-Agent (owner, 2026-08-09) ─────────────────
 * A reported photo post — https://web.facebook.com/share/p/19CFoS5Uje/ — failed
 * with EXTRACTION_FAILED. Measured cause: `web.facebook.com` answers the DESKTOP
 * Chrome UA with **HTTP 400** ("Sorry, something went wrong") on every path,
 * share link or resolved permalink alike. It is the UA, not the URL and not the
 * IP — the same request with a crawler or mobile UA returns 200.
 *
 * That single 400 is why photo posts were dead. A VIDEO survives it, because
 * `index.ts` falls back to yt-dlp; a PHOTO has no such fallback — this extractor
 * is the only thing that can produce an image format, so its throw was the end
 * of the road. The 400 is also invisible to the proxy retry in `http.ts`
 * (`isBlockedStatus` covers 401/403/429/451/503, and the error page matches none
 * of the challenge heuristics), so nothing else got a turn either.
 *
 * Measured, on that post:
 *   DESKTOP_UA  → 400, 1.5 kB error page, no media at all
 *   CRAWLER_UA  → 200, 326 kB, og:image only — but the LARGEST rendition (~600px)
 *   MOBILE_UA   → 200, 71 kB, ALL FIVE photos of the post, at 130–350px
 *
 * So neither working render is strictly better and the two are merged: the
 * crawler supplies the best copy of the cover photo, the mobile render supplies
 * the rest of the album. Desktop still goes first and still wins alone whenever
 * it works, so a video's latency is unchanged.
 */

const TIMEOUT_MS = Number(process.env.FACEBOOK_EXTRACTOR_TIMEOUT_MS || 9000);

/** The share-preview crawler. Highest-resolution `og:image`, no page JSON. */
const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
/** The mobile web render. Enumerates every photo in a multi-photo post. */
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function headersFor(ua: string) {
  return {
    "User-Agent": ua,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

function fmt(id: string, label: string, directUrl: string): MediaFormat {
  return {
    formatId: id,
    kind: "video",
    label,
    ext: "mp4",
    resolution: null,
    fps: null,
    filesize: null,
    tbr: null,
    vcodec: "h264",
    acodec: "aac",
    directUrl: unescapeJsonUrl(directUrl),
    httpHeaders: { "User-Agent": DESKTOP_UA, Referer: "https://www.facebook.com/" },
  };
}

function buildFormats(html: string): MediaFormat[] {
  // These direct URLs are kept as a reliable fallback, but Facebook often serves
  // VP9 here (audio-only on iOS), so the download path tries yt-dlp's H.264
  // selector FIRST for Facebook and only uses these if yt-dlp can't extract.
  const hd = firstMatch(
    html,
    /"playable_url_quality_hd":"([^"]+)"/,
    /"browser_native_hd_url":"([^"]+)"/,
  );
  const sd = firstMatch(
    html,
    /"playable_url":"([^"]+)"/,
    /"browser_native_sd_url":"([^"]+)"/,
  );
  const formats: MediaFormat[] = [];
  if (hd) formats.push(fmt("fb-hd", "HD", hd));
  if (sd && unescapeJsonUrl(sd) !== formats[0]?.directUrl) {
    formats.push(fmt("fb-sd", "SD", sd));
  }
  return formats;
}

/**
 * One photo candidate, before the renders are merged.
 *
 * `photoId` is the stable part of an fbcdn filename (`<id>_<id>_<id>_n.jpg`) and
 * is the SAME across every rendition and every render of the same picture — it
 * is what lets a 235px thumbnail from the mobile page and a 600px copy from the
 * crawler page be recognised as one photo rather than two.
 */
interface PhotoCandidate {
  photoId: string;
  url: string;
  /** Longest edge the URL claims, from the signed `stp`/`cstp` hints. 0 = unknown. */
  size: number;
  /** Position in the source page, so album order survives the merge. */
  order: number;
}

/**
 * A RANKING score for an fbcdn rendition — not a measurement of it.
 *
 * Facebook encodes the rendition in `stp` (`dst-webp_p130x130_q70`, `s235x350`)
 * and sometimes `cstp`/`ctp`. These are the only size information available
 * without downloading the bytes, and they are approximate: the cover photo of
 * the owner's post declares `cstp=mx720x1280` but the delivered JPEG is
 * 600×1067 (measured from its SOF header). `mx…` is a MAXIMUM the CDN promises
 * not to exceed, so it reads high; `ctp`/`stp` describe the crop actually
 * applied and track the truth much more closely.
 *
 * Hence the ordering below, and hence `toImageFormat` labels these
 * qualitatively and leaves `resolution` null. Stamping "1280px" on a 600px-wide
 * image because a query parameter said so is exactly the kind of confident wrong
 * number this codebase measures rather than guesses.
 *
 * The hints also cannot be rewritten to ask for something bigger: the `oh`
 * signature covers them, and swapping `stp=dst-webp_p130x130_q70` for
 * `stp=dst-jpg` returns 403 (measured). This ranks what is on offer; it never
 * invents a larger URL.
 */
export function declaredSize(url: string): number {
  // Crop-describing hints first; the `mx` maximum is only a tie-breaker.
  for (const re of [/[?&]ctp=([^&]+)/, /[?&]stp=([^&]+)/, /[?&]cstp=([^&]+)/]) {
    const hint = url.match(re)?.[1];
    if (!hint) continue;
    let best = 0;
    for (const [, a, b] of hint.matchAll(/[psmx](\d{2,5})x(\d{2,5})/gi)) {
      best = Math.max(best, Number(a) || 0, Number(b) || 0);
    }
    if (best > 0) return best;
  }
  return 0;
}

/**
 * An honest word for a rendition we have ranked but never measured.
 *
 * Thresholds sit either side of the renditions Facebook actually serves — ~600
 * for a crawler cover photo, 235–350 for a mobile feed image, 130 for a grid
 * thumbnail — so the three tiers correspond to real, visibly different files.
 */
function sizeTier(size: number): string | null {
  if (size === 0) return null;
  if (size >= 600) return "Large";
  if (size >= 300) return "Medium";
  return "Small";
}

/** The stable photo identity inside an fbcdn filename, or null if not a photo. */
export function photoIdOf(url: string): string | null {
  return url.match(/\/(\d{6,}_\d{6,}_\d{6,})_n\.(?:jpg|png|webp)/i)?.[1] ?? null;
}

/**
 * Every photo the page offers, in album order, best rendition per photo.
 *
 * ── Why this scrapes fbcdn URLs instead of named JSON keys ────────────────────
 * It used to read `photo_image` / `image` / `currentMediaNode` out of the page
 * JSON. Those keys are present on the logged-in desktop render and on NEITHER
 * render that actually answers us (measured: zero occurrences in both the
 * crawler and mobile HTML). Scraping the CDN URLs directly is what survives,
 * because the URLs are the one thing every render must contain to draw the page.
 *
 * `t39.30808-1` is skipped: that is the profile-picture type, and the poster's
 * avatar is not what anyone pressed download for.
 */
export function collectPhotos(html: string): PhotoCandidate[] {
  const out: PhotoCandidate[] = [];
  let order = 0;
  const seen = new Set<string>();
  for (const raw of html.match(/https:\/\/[a-z0-9.\-]*fbcdn\.net\/v\/[^"'\\ )]{20,600}/gi) ?? []) {
    const url = unescapeJsonUrl(raw.replace(/&amp;/g, "&"));
    if (/\/t39\.30808-1\//.test(url)) continue; // profile picture, not post media
    const photoId = photoIdOf(url);
    if (!photoId) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ photoId, url, size: declaredSize(url), order: order++ });
  }
  return out;
}

function toImageFormat(c: PhotoCandidate, index: number, total: number): MediaFormat {
  const tier = sizeTier(c.size);
  const name = total > 1 ? `Photo ${index + 1}` : "Photo";
  return {
    formatId: `fb-img-${index}`,
    kind: "image",
    label: tier ? `${name} · ${tier}` : name,
    ext: /\.png(?:$|\?)/i.test(c.url) ? "png" : /\.webp(?:$|\?)/i.test(c.url) ? "webp" : "jpg",
    // Null on purpose — see `declaredSize`. The query-string hints rank these
    // renditions but do not measure them, and a wrong pixel count is worse here
    // than no pixel count.
    resolution: null,
    fps: null,
    filesize: null,
    tbr: null,
    vcodec: null,
    acodec: null,
    directUrl: c.url,
    // scontent refuses requests without a browser UA and a facebook referer.
    httpHeaders: { "User-Agent": DESKTOP_UA, Referer: "https://www.facebook.com/" },
  };
}

/**
 * Merge photo candidates from several renders into one list.
 *
 * Keyed on `photoId`, keeping the largest declared rendition of each — that is
 * the whole point of running two renders: the crawler has the best copy of the
 * cover photo, the mobile page has the other four. `og:image` is folded in last
 * as a floor, for the sparse render where nothing else parsed.
 */
export function mergePhotos(renders: { html: string }[]): MediaFormat[] {
  const best = new Map<string, PhotoCandidate>();
  for (const r of renders) {
    for (const c of collectPhotos(r.html)) {
      const prev = best.get(c.photoId);
      // Bigger wins; ties keep the earlier render, which is the earlier album slot.
      if (!prev || c.size > prev.size) {
        best.set(c.photoId, prev ? { ...c, order: prev.order } : c);
      }
    }
  }

  if (best.size === 0) {
    // Last resort: the share preview. Present on the sparsest render of a page,
    // and a small photo is still a download where nothing else is.
    for (const r of renders) {
      const og = metaContent(r.html, "og:image");
      if (!og) continue;
      const url = unescapeJsonUrl(og);
      if (!url.startsWith("http")) continue;
      const id = photoIdOf(url) ?? url.split("?")[0] ?? url;
      if (!best.has(id)) best.set(id, { photoId: id, url, size: declaredSize(url), order: best.size });
    }
  }

  const ordered = [...best.values()].sort((a, b) => a.order - b.order);
  return ordered.map((c, i) => toImageFormat(c, i, ordered.length));
}

/** Fetch one render. Never throws — a dead render must not sink the others. */
async function render(url: string, ua: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await extractorFetch(url, { headers: headersFor(ua), redirect: "follow", signal }, "facebook");
    if (!res.ok) return null;
    const html = await res.text();
    return html.length > 500 ? html : null;
  } catch {
    return null;
  }
}

export const facebookExtractor: Extractor = {
  name: "facebook",
  canHandle(_url: string, platform: PlatformId) {
    return platform === "facebook";
  },
  async extract(url: string): Promise<VideoMetadata> {
    const platform = detectPlatform(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let htmls: string[];
    try {
      /*
        Desktop FIRST and alone when it succeeds.

        It is the only render that carries `playable_url`, so a video must not
        pay for the photo fallback: when this returns video formats we are done
        in exactly one round trip, as before.
      */
      const desktop = await render(url, DESKTOP_UA, controller.signal);
      if (desktop && buildFormats(desktop).length > 0) {
        htmls = [desktop];
      } else {
        // Photo post, or a desktop render Facebook refused (currently: always,
        // see the header note). Both alternates in PARALLEL — one round trip,
        // and their strengths are complementary rather than ordered.
        const [crawler, mobile] = await Promise.all([
          render(url, CRAWLER_UA, controller.signal),
          render(url, MOBILE_UA, controller.signal),
        ]);
        htmls = [desktop, crawler, mobile].filter((h): h is string => h !== null);
      }
    } finally {
      clearTimeout(timer);
    }

    if (htmls.length === 0) {
      throw new ExtractionError("Facebook refused every request for this post");
    }

    // Video from whichever render carried it; photos merged across all of them.
    let formats: MediaFormat[] = [];
    for (const html of htmls) {
      formats = buildFormats(html);
      if (formats.length > 0) break;
    }
    if (formats.length === 0) {
      formats = mergePhotos(htmls.map((html) => ({ html })));
      if (formats.length === 0) throw new ExtractionError("No Facebook media (likely login-walled)");
    }

    /*
      🔴 SD-ONLY ISN'T THE FINAL ANSWER (owner, 2026-08-16: "Facebook, reels,
      story and post don't Download in high quality").

      `buildFormats` only found `playable_url`/`browser_native_sd_url`, not
      the HD field (`playable_url_quality_hd`/`browser_native_hd_url`) — that
      field simply isn't always present in Facebook's page JSON, especially
      for reels/stories. `runChain` (server/extractors/index.ts) returns the
      FIRST extractor that produces any formats at all, so this SD stream
      would otherwise ship as the final answer without yt-dlp ever getting a
      turn — even though yt-dlp has been independently observed getting
      genuine 2160p/1440p/1080p/720p for Facebook where this direct-URL path
      cannot. Try it here, before returning, and only keep the SD fallback if
      yt-dlp comes back empty or throws — a working low-quality download must
      never regress to no download at all.
    */
    if (formats[0]?.kind === "video" && !formats.some((f) => f.formatId === "fb-hd")) {
      try {
        const yt = await ytdlpExtract(url);
        if (yt.formats.length > 0) return yt;
      } catch {
        /* yt-dlp failed too — the SD direct URL below is still a real download */
      }
    }

    // Metadata from the richest render that has each field — the crawler page is
    // usually the one with a real og:title, the mobile page the one with JSON.
    const pick = (fn: (html: string) => string | null): string | null => {
      for (const html of htmls) {
        const v = fn(html);
        if (v) return v;
      }
      return null;
    };

    return {
      id: pick((h) => firstMatch(h, /"video_id":"(\d+)"/, /\/videos\/(\d+)/)) || crypto.randomUUID(),
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: (pick((h) => metaContent(h, "og:title")) || "Facebook post").slice(0, 200),
      description: pick((h) => metaContent(h, "og:description")),
      thumbnail: pick((h) => metaContent(h, "og:image")),
      durationSeconds: null,
      creator: pick((h) => firstMatch(h, /"owner":\{"[^}]*?"name":"([^"]+)"/, /property="og:image:alt" content="([^"]+)"/)),
      uploadDate: null,
      viewCount: null,
      likeCount: null,
      webpageUrl: url,
      formats,
      extractor: "facebook",
    };
  },
};
