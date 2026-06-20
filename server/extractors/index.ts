import { cacheGet, cacheSet } from "@/lib/cache";
import { detectPlatform } from "@/lib/platforms";
import { extractMetadata as ytdlpExtract } from "@/server/services/ytdlp-service";
import type { VideoMetadata } from "@/types";

import { facebookExtractor } from "./facebook";
import { instagramExtractor } from "./instagram";
import { pinterestExtractor } from "./pinterest";
import { tiktokExtractor } from "./tiktok";
import { twitterExtractor } from "./twitter";
import type { Extractor } from "./types";
import { vimeoExtractor } from "./vimeo";

/**
 * Ordered list of fast, custom extractors. Each is tried before yt-dlp for the
 * platforms it handles; on failure we fall through to the next, and finally to
 * yt-dlp — so a custom extractor can only ever make things faster, never break.
 */
const CUSTOM_EXTRACTORS: Extractor[] = [
  tiktokExtractor,
  vimeoExtractor,
  twitterExtractor,
  instagramExtractor,
  facebookExtractor,
  pinterestExtractor,
];

const METADATA_TTL_SECONDS = Number(
  process.env.METADATA_CACHE_TTL_SECONDS || 1800, // 30 min
);

function metadataKey(url: string): string {
  return `meta:${url}`;
}

/** Runs the custom-first, yt-dlp-fallback extraction chain (no caching). */
async function extractFresh(url: string): Promise<VideoMetadata> {
  const platform = detectPlatform(url);
  for (const extractor of CUSTOM_EXTRACTORS) {
    if (!extractor.canHandle(url, platform.id)) continue;
    try {
      const meta = await extractor.extract(url);
      if (meta.formats.length > 0) return meta;
    } catch (err) {
      // Custom extractor failed (site changed, blocked, private) — fall back.
      console.warn(
        `[extractor:${extractor.name}] falling back to yt-dlp:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return ytdlpExtract(url);
}

/**
 * Cache-first metadata extraction. Repeated URLs are served from Redis/memory
 * (sub-millisecond) instead of re-hitting the source or yt-dlp.
 */
export async function getMetadata(url: string): Promise<VideoMetadata> {
  const key = metadataKey(url);
  const cached = await cacheGet<VideoMetadata>(key);
  if (cached) return cached;

  const meta = await extractFresh(url);
  await cacheSet(key, meta, METADATA_TTL_SECONDS);
  return meta;
}

/** Reads cached metadata without triggering extraction (used at download time). */
export async function getCachedMetadata(
  url: string,
): Promise<VideoMetadata | null> {
  return cacheGet<VideoMetadata>(metadataKey(url));
}
