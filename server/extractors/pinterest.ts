import { detectPlatform } from "@/lib/platforms";
import type { MediaFormat, PlatformId, VideoMetadata } from "@/types";

import { extractorFetch } from "./http";
import { DESKTOP_UA, firstMatch, metaContent, unescapeJsonUrl } from "./parse";
import { ExtractionError, type Extractor } from "./types";

/**
 * Pinterest custom extractor (video pins).
 *
 * Video pins expose direct MP4 URLs in the page's `video_list` JSON
 * (e.g. `V_720P`, `V_HLSV3_MOBILE`). We prefer the progressive MP4 variants for
 * a fast, no-yt-dlp download, falling back to yt-dlp when none are found.
 */

const TIMEOUT_MS = Number(process.env.PINTEREST_EXTRACTOR_TIMEOUT_MS || 8000);

const HEADERS = {
  "User-Agent": DESKTOP_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function buildFormats(html: string): MediaFormat[] {
  const headers = { "User-Agent": DESKTOP_UA, Referer: "https://www.pinterest.com/" };
  const formats: MediaFormat[] = [];
  const seen = new Set<string>();

  // Progressive MP4 entries look like "V_720P":{"url":"https:\/\/...mp4", "height":720,...}
  const re = /"(V_\w+)":\{[^}]*?"url":"([^"]+\.mp4[^"]*)"[^}]*?(?:"height":(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = unescapeJsonUrl(m[2]!);
    if (seen.has(url)) continue;
    seen.add(url);
    const height = m[3] ? Number(m[3]) : null;
    formats.push({
      formatId: height ? String(height) : m[1]!.toLowerCase(),
      kind: "video",
      label: height ? `${height}p` : m[1]!.replace(/^V_/, ""),
      ext: "mp4",
      resolution: height ? `${height}p` : null,
      fps: null,
      filesize: null,
      tbr: null,
      vcodec: "h264",
      acodec: "aac",
      directUrl: url,
      httpHeaders: headers,
    });
  }

  // Fallback to og:video when no explicit video_list was present.
  if (formats.length === 0) {
    const og = metaContent(html, "og:video") || metaContent(html, "og:video:url");
    if (og && og.startsWith("http")) {
      formats.push({
        formatId: "pin-0",
        kind: "video",
        label: "HD",
        ext: "mp4",
        resolution: null,
        fps: null,
        filesize: null,
        tbr: null,
        vcodec: "h264",
        acodec: "aac",
        directUrl: og,
        httpHeaders: headers,
      });
    }
  }

  return formats.sort(
    (a, b) => (parseInt(b.resolution ?? "0") || 0) - (parseInt(a.resolution ?? "0") || 0),
  );
}

export const pinterestExtractor: Extractor = {
  name: "pinterest",
  canHandle(_url: string, platform: PlatformId) {
    return platform === "pinterest";
  },
  async extract(url: string): Promise<VideoMetadata> {
    const platform = detectPlatform(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let html: string;
    try {
      const res = await extractorFetch(url, {
        headers: HEADERS,
        redirect: "follow",
        signal: controller.signal,
      });
      if (!res.ok) throw new ExtractionError(`Pinterest responded ${res.status}`);
      html = await res.text();
    } finally {
      clearTimeout(timer);
    }

    const formats = buildFormats(html);
    if (formats.length === 0) {
      throw new ExtractionError("No Pinterest video found");
    }

    return {
      id: firstMatch(url, /\/pin\/(\d+)/) || crypto.randomUUID(),
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: (metaContent(html, "og:title") || "Pinterest video").slice(0, 200),
      description: metaContent(html, "og:description"),
      thumbnail: metaContent(html, "og:image"),
      durationSeconds: null,
      creator: null,
      uploadDate: null,
      viewCount: null,
      likeCount: null,
      webpageUrl: url,
      formats,
      extractor: "pinterest",
    };
  },
};
