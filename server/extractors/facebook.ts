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

function buildFormats(html: string): MediaFormat[] {
  const headers = { "User-Agent": DESKTOP_UA, Referer: "https://www.facebook.com/" };
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
  if (hd) {
    formats.push({
      formatId: "fb-hd",
      kind: "video",
      label: "HD",
      ext: "mp4",
      resolution: null,
      fps: null,
      filesize: null,
      tbr: null,
      vcodec: "h264",
      acodec: "aac",
      directUrl: unescapeJsonUrl(hd),
      httpHeaders: headers,
    });
  }
  if (sd && unescapeJsonUrl(sd) !== formats[0]?.directUrl) {
    formats.push({
      formatId: "fb-sd",
      kind: "video",
      label: "SD",
      ext: "mp4",
      resolution: null,
      fps: null,
      filesize: null,
      tbr: null,
      vcodec: "h264",
      acodec: "aac",
      directUrl: unescapeJsonUrl(sd),
      httpHeaders: headers,
    });
  }
  return formats;
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
      throw new ExtractionError("No Facebook video URL (likely login-walled)");
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
