import { detectPlatform } from "@/lib/platforms";
import type { MediaFormat, PlatformId, VideoMetadata } from "@/types";

import { extractorFetch } from "./http";
import { DESKTOP_UA, firstMatch, metaContent, unescapeJsonUrl } from "./parse";
import { ExtractionError, type Extractor } from "./types";

/**
 * Instagram custom extractor (reels / posts / IGTV).
 *
 * Public posts embed the direct MP4 in the page's inline JSON (`video_url`) or
 * an `og:video` meta tag. We read those for a fast, no-yt-dlp download. NOTE:
 * Instagram heavily auth-/WAF-walls datacenter IPs, so without EXTRACTOR_PROXY
 * this will usually hit a login wall and transparently fall back to yt-dlp.
 */

const TIMEOUT_MS = Number(process.env.INSTAGRAM_EXTRACTOR_TIMEOUT_MS || 8000);

const HEADERS = {
  "User-Agent": DESKTOP_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function shortcodeOf(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1]! : null;
}

function findVideoUrl(html: string): string | null {
  const raw = firstMatch(
    html,
    /"video_url":"([^"]+)"/,
    /"video_versions":\[\{"[^}]*?"url":"([^"]+)"/,
    /property=["']og:video["'][^>]+content=["']([^"']+)["']/i,
    /property=["']og:video:secure_url["'][^>]+content=["']([^"']+)["']/i,
  );
  return raw ? unescapeJsonUrl(raw) : null;
}

/** Collects image URLs for photo / carousel posts (highest resolution first). */
function findImageUrls(html: string): string[] {
  const urls: string[] = [];
  const push = (u?: string | null) => {
    if (!u) return;
    const clean = unescapeJsonUrl(u);
    if (clean.startsWith("http") && !urls.includes(clean)) urls.push(clean);
  };

  // Highest-res candidate from each image_versions2 block (covers carousels).
  for (const m of html.matchAll(
    /"image_versions2":\{"candidates":\[\{"[^}]*?"url":"([^"]+)"/g,
  )) {
    push(m[1]);
  }
  // display_url appears once per carousel child and on single image posts.
  for (const m of html.matchAll(/"display_url":"([^"]+)"/g)) push(m[1]);
  if (urls.length === 0) push(metaContent(html, "og:image"));
  return urls;
}

export const instagramExtractor: Extractor = {
  name: "instagram",
  canHandle(_url: string, platform: PlatformId) {
    return platform === "instagram";
  },
  async extract(url: string): Promise<VideoMetadata> {
    const platform = detectPlatform(url);
    const shortcode = shortcodeOf(url);
    if (!shortcode) throw new ExtractionError("Unrecognised Instagram URL");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let html: string;
    try {
      const res = await extractorFetch(
        `https://www.instagram.com/p/${shortcode}/`,
        { headers: HEADERS, redirect: "follow", signal: controller.signal },
        "instagram",
      );
      if (!res.ok) throw new ExtractionError(`Instagram responded ${res.status}`);
      html = await res.text();
    } finally {
      clearTimeout(timer);
    }

    const headers = { "User-Agent": DESKTOP_UA, Referer: "https://www.instagram.com/" };
    const videoUrl = findVideoUrl(html);
    const formats: MediaFormat[] = [];

    if (videoUrl && videoUrl.startsWith("http")) {
      formats.push({
        formatId: "ig-hd",
        kind: "video",
        label: "HD",
        ext: "mp4",
        resolution: null,
        fps: null,
        filesize: null,
        tbr: null,
        vcodec: "h264",
        acodec: "aac",
        directUrl: videoUrl,
        httpHeaders: headers,
      });
    } else {
      // Photo / carousel post → offer each image.
      findImageUrls(html).forEach((img, i) => {
        formats.push({
          formatId: `img-${i}`,
          kind: "image",
          label: `Photo ${i + 1}`,
          ext: /\.png/i.test(img) ? "png" : /\.webp/i.test(img) ? "webp" : "jpg",
          resolution: null,
          fps: null,
          filesize: null,
          tbr: null,
          vcodec: null,
          acodec: null,
          directUrl: img,
          httpHeaders: headers,
        });
      });
    }

    if (formats.length === 0) {
      throw new ExtractionError("No Instagram media (likely login-walled or private)");
    }

    const title = metaContent(html, "og:title") || "Instagram post";

    return {
      id: shortcode,
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: title.slice(0, 200),
      description: metaContent(html, "og:description"),
      thumbnail: metaContent(html, "og:image"),
      durationSeconds: null,
      creator:
        firstMatch(html, /"owner":\{"[^}]*?"username":"([^"]+)"/) ||
        firstMatch(html, /"username":"([^"]+)"/),
      uploadDate: null,
      viewCount: null,
      likeCount: null,
      webpageUrl: url,
      formats,
      extractor: "instagram",
    };
  },
};
