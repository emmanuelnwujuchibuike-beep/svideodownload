import { detectPlatform } from "@/lib/platforms";
import type { MediaFormat, PlatformId, VideoMetadata } from "@/types";

import { extractorFetch } from "./http";
import { DESKTOP_UA, firstMatch, metaContent, unescapeJsonUrl } from "./parse";
import { ExtractionError, type Extractor } from "./types";

/**
 * Thrown when the regex-based scrape found the pin's IMAGE but no video.
 *
 * 🔴 THE BUG THIS FIXES (owner, 2026-08-25: "the pinterest link still fetch
 * as image, jpg"): Pinterest now serves a client-rendered shell to a plain
 * fetch — `og:video`/`video_list` are gone from the raw HTML for most pins,
 * but `og:image` often still IS present. Before this, `extract()` treated
 * "found an image" as a successful extraction (`formats.length > 0`), so
 * `runChain` (server/extractors/index.ts) returned it immediately and NEVER
 * tried yt-dlp — which, tested directly against a real pin.it link, DOES
 * still find the actual video. An image-only result was silently masking a
 * real video that was one fallback step away. Carries the image-only
 * metadata so it isn't wasted — `runChain` uses it ONLY if yt-dlp also
 * fails to find a video, never as a substitute for trying.
 */
export class PinterestImageOnlyError extends ExtractionError {
  constructor(public readonly imageOnlyMeta: VideoMetadata) {
    super("Pinterest: found only the pin's image, no video — trying yt-dlp before falling back to it");
  }
}

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

  /*
    The pin's own image — always offered when found, not just when there's no
    video (owner, 2026-08-25: "pinterest... video to image"). A video pin's
    cover IS the pin's own artwork, not an auto-picked preview frame, so
    "just give me the image" is a real, separate choice from "give me the
    video" here — unlike most platforms, where a thumbnail is throwaway.
  */
  const img =
    metaContent(html, "og:image") ||
    firstMatch(html, /"orig":\{"url":"([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/);
  if (img && img.startsWith("http")) {
    formats.push({
      formatId: "pin-img",
      kind: "image",
      label: "Photo",
      ext: /\.png/i.test(img) ? "png" : /\.webp/i.test(img) ? "webp" : "jpg",
      resolution: null,
      fps: null,
      filesize: null,
      tbr: null,
      vcodec: null,
      acodec: null,
      directUrl: unescapeJsonUrl(img),
      httpHeaders: headers,
    });
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
      const res = await extractorFetch(
        url,
        { headers: HEADERS, redirect: "follow", signal: controller.signal },
        "pinterest",
      );
      if (!res.ok) throw new ExtractionError(`Pinterest responded ${res.status}`);
      html = await res.text();
    } finally {
      clearTimeout(timer);
    }

    const formats = buildFormats(html);
    if (formats.length === 0) {
      throw new ExtractionError("No Pinterest video or image found");
    }

    const meta: VideoMetadata = {
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

    // No video found — this might be a genuine image-only pin, or it might
    // be the regex simply failing to find a video Pinterest DID serve (the
    // documented current state). Either way, don't hand back "just the
    // image" as if it were the full answer — let the caller try yt-dlp
    // first, which reliably still finds Pinterest video when it exists.
    if (!formats.some((f) => f.kind === "video")) {
      throw new PinterestImageOnlyError(meta);
    }

    return meta;
  },
};
