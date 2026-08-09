import { detectPlatform } from "@/lib/platforms";
import type { MediaFormat, PlatformId, VideoMetadata } from "@/types";

import { extractorFetch } from "./http";
import { DESKTOP_UA, firstMatch, metaContent, unescapeJsonUrl } from "./parse";
import { ExtractionError, type Extractor } from "./types";

/**
 * Facebook custom extractor (watch / video / reel).
 *
 * Public videos embed direct SD/HD MP4 URLs in the page JSON
 * (`playable_url` / `playable_url_quality_hd`, or the newer
 * `browser_native_*_url`). We surface both qualities for a fast, no-yt-dlp
 * download. Facebook WAF-walls datacenter IPs, so without EXTRACTOR_PROXY this
 * usually falls back to yt-dlp.
 */

const TIMEOUT_MS = Number(process.env.FACEBOOK_EXTRACTOR_TIMEOUT_MS || 9000);

const HEADERS = {
  "User-Agent": DESKTOP_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

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
 * A photo post's image, at the best resolution the page will give up.
 *
 * ── Why `og:image` alone is not enough ────────────────────────────────────────
 * It is what this used to return, and it is a SHARE PREVIEW: Facebook sizes it
 * for a link card, so a 4000px photo comes back as a ~600px thumbnail. The page
 * also carries the real image in its embedded JSON, and that is what someone
 * pressing "download" on a photo is asking for.
 *
 * So the JSON keys are tried first, in descending order of how large the image
 * behind them tends to be, and `og:image` stays as the last resort — the one
 * source that is present even on the sparsest render of the page.
 *
 * ── Every candidate is offered, not just the winner ───────────────────────────
 * These keys move around between Facebook's renderers, and a URL that looks
 * right can still be expired or region-signed. Returning them as separate
 * qualities means a failed pick is a second tap rather than a dead end — and the
 * labels say which is which instead of pretending we know the pixel size.
 */
function buildImageFormats(html: string): MediaFormat[] {
  const seen = new Set<string>();
  const out: MediaFormat[] = [];

  const add = (raw: string | null | undefined, label: string) => {
    if (!raw) return;
    const url = unescapeJsonUrl(raw);
    if (!url.startsWith("http")) return;
    // Renditions of one photo differ only by size params, so collapse on path.
    const key = url.split("?")[0] ?? url;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      formatId: `fb-img-${out.length}`,
      kind: "image",
      label,
      ext: /\.png(?:$|\?)/i.test(url) ? "png" : "jpg",
      resolution: null,
      fps: null,
      filesize: null,
      tbr: null,
      vcodec: null,
      acodec: null,
      directUrl: url,
      // scontent refuses requests without a browser UA and a facebook referer.
      httpHeaders: { "User-Agent": DESKTOP_UA, Referer: "https://www.facebook.com/" },
    });
  };

  // Full-size first: these are the keys the photo viewer itself reads.
  add(firstMatch(html, /"photo_image"\s*:\s*\{[^}]*?"uri"\s*:\s*"([^"]+)"/), "Original");
  add(firstMatch(html, /"image"\s*:\s*\{[^}]*?"uri"\s*:\s*"([^"]+)"/), "Full size");
  add(firstMatch(html, /"currentMediaNode"[\s\S]{0,600}?"uri"\s*:\s*"([^"]+)"/), "Full size");
  // The share preview — smaller, but present on renders where nothing else is.
  add(metaContent(html, "og:image"), out.length === 0 ? "Photo" : "Preview");

  return out;
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
    let html: string;
    try {
      const res = await extractorFetch(
        url,
        { headers: HEADERS, redirect: "follow", signal: controller.signal },
        "facebook",
      );
      if (!res.ok) throw new ExtractionError(`Facebook responded ${res.status}`);
      html = await res.text();
    } finally {
      clearTimeout(timer);
    }

    const formats = buildFormats(html);
    if (formats.length === 0) {
      // Photo post → offer the image instead of failing.
      const images = buildImageFormats(html);
      if (images.length > 0) formats.push(...images);
      else throw new ExtractionError("No Facebook media (likely login-walled)");
    }

    return {
      id: firstMatch(html, /"video_id":"(\d+)"/, /\/videos\/(\d+)/) || crypto.randomUUID(),
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: (metaContent(html, "og:title") || "Facebook video").slice(0, 200),
      description: metaContent(html, "og:description"),
      thumbnail: metaContent(html, "og:image"),
      durationSeconds: null,
      creator: firstMatch(html, /"owner":\{"[^}]*?"name":"([^"]+)"/),
      uploadDate: null,
      viewCount: null,
      likeCount: null,
      webpageUrl: url,
      formats,
      extractor: "facebook",
    };
  },
};
