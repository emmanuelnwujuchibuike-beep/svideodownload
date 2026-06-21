import { detectPlatform } from "@/lib/platforms";
import type { MediaFormat, PlatformId, VideoMetadata } from "@/types";

import { extractorFetch } from "./http";
import { DESKTOP_UA, firstMatch, metaContent, unescapeJsonUrl } from "./parse";
import { ExtractionError, type Extractor } from "./types";

/**
 * Threads custom extractor. Threads runs on Meta's infrastructure (like
 * Instagram), so a public post embeds the direct MP4 in the page's inline JSON
 * (`video_url` / `video_versions`) or an `og:video` meta tag. We read those for
 * a fast download and fall back to yt-dlp otherwise.
 */

const TIMEOUT_MS = Number(process.env.THREADS_EXTRACTOR_TIMEOUT_MS || 9000);

const HEADERS = {
  "User-Agent": DESKTOP_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

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

export const threadsExtractor: Extractor = {
  name: "threads",
  canHandle(_url: string, platform: PlatformId) {
    return platform === "threads";
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
        "threads",
      );
      if (!res.ok) throw new ExtractionError(`Threads responded ${res.status}`);
      html = await res.text();
    } finally {
      clearTimeout(timer);
    }

    const videoUrl = findVideoUrl(html);
    if (!videoUrl || !videoUrl.startsWith("http")) {
      throw new ExtractionError("No Threads video URL (private or image post)");
    }

    const formats: MediaFormat[] = [
      {
        formatId: "best",
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
        httpHeaders: { "User-Agent": DESKTOP_UA, Referer: "https://www.threads.com/" },
      },
    ];

    return {
      id: crypto.randomUUID(),
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: (metaContent(html, "og:title") || "Threads video").slice(0, 200),
      description: metaContent(html, "og:description"),
      thumbnail: metaContent(html, "og:image"),
      durationSeconds: null,
      creator: firstMatch(html, /"username":"([^"]+)"/),
      uploadDate: null,
      viewCount: null,
      likeCount: null,
      webpageUrl: url,
      formats,
      extractor: "threads",
    };
  },
};
