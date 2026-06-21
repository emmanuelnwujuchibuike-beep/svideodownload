import { cacheGet, cacheSet } from "@/lib/cache";
import { detectPlatform } from "@/lib/platforms";
import {
  isProxyForced,
  runWithForcedProxy,
  shouldUseProxy,
} from "@/server/proxy/proxy-manager";
import { extractMetadata as ytdlpExtract } from "@/server/services/ytdlp-service";
import type { VideoMetadata } from "@/types";

import { facebookExtractor } from "./facebook";
import { instagramExtractor } from "./instagram";
import { pinterestExtractor } from "./pinterest";
import { snapchatExtractor } from "./snapchat";
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
  snapchatExtractor,
];

const METADATA_TTL_SECONDS = Number(
  process.env.METADATA_CACHE_TTL_SECONDS || 1800, // 30 min
);

function metadataKey(url: string): string {
  return `meta:${url}`;
}

/** Runs the custom-first, yt-dlp-fallback extraction chain (no caching). */
async function runChain(url: string): Promise<VideoMetadata> {
  const platform = detectPlatform(url);
  for (const extractor of CUSTOM_EXTRACTORS) {
    if (!extractor.canHandle(url, platform.id)) continue;
    try {
      const meta = await extractor.extract(url);
      if (meta.formats.length > 0) return meta;
    } catch (err) {
      const via = isProxyForced() ? " (via proxy)" : "";
      console.warn(
        `[extractor:${extractor.name}]${via} falling back:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return ytdlpExtract(url);
}

/**
 * Extraction with smart proxy fallback: try DIRECT first; if it fails for a
 * proxy-eligible platform (Instagram, Facebook, X, …) and we're under budget,
 * re-run the WHOLE chain with the residential proxy forced. Direct-success
 * platforms (TikTok, YouTube, Pinterest, Vimeo) never trigger the proxy.
 */
async function extractFresh(url: string): Promise<VideoMetadata> {
  try {
    return await runChain(url);
  } catch (err) {
    const platform = detectPlatform(url).id;
    if (await shouldUseProxy(platform, 1)) {
      try {
        return await runWithForcedProxy(() => runChain(url));
      } catch {
        /* proxy retry also failed — surface the original error below */
      }
    }
    throw err;
  }
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
