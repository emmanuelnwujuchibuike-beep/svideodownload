import { cacheGet, getCached } from "@/lib/cache";
import { detectPlatform } from "@/lib/platforms";
import {
  isProxyForced,
  runWithForcedProxy,
  shouldUseProxy,
} from "@/server/proxy/proxy-manager";
import { extractMetadata as ytdlpExtract } from "@/server/services/ytdlp-service";
import type { VideoMetadata } from "@/types";

import { apifyEnabled, apifyExtract, isApifyPlatform } from "./apify-instagram";
import { facebookExtractor } from "./facebook";
import { PinterestImageOnlyError, pinterestExtractor } from "./pinterest";
import { withQualityLadder } from "./quality-ladder";
import { snapchatExtractor } from "./snapchat";
import { telegramExtractor } from "./telegram";
import { threadsExtractor } from "./threads";
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
  // instagramExtractor removed: IG rejects exported sessionids server-side, so
  // the custom path only added latency. IG videos/reels go straight to yt-dlp.
  facebookExtractor,
  pinterestExtractor,
  snapchatExtractor,
  threadsExtractor,
  telegramExtractor,
];

const METADATA_TTL_SECONDS = Number(
  process.env.METADATA_CACHE_TTL_SECONDS || 1800, // 30 min
);

/**
 * Bump when the SHAPE of an extractor's output changes — a format's id, order,
 * label, or what its `filesize` means.
 *
 * 🔴 Why this exists: the TikTok ordering fix (H.264 first, so the default
 * stream no longer needs a 55-second re-encode) deployed correctly and changed
 * nothing, because every URL anyone had already looked at was being served from
 * a 30-minute cache holding the OLD format list. The code was right and the
 * product was still wrong, which is the worst kind of "fixed".
 *
 * A cached entry is a snapshot of the extractor that produced it. Versioning
 * the key retires those snapshots the moment the extractor changes, instead of
 * waiting out a TTL and wondering why a deploy did nothing.
 *
 * v2 — 2026-08-09: TikTok format order + `filesize` semantics.
 * v3 — 2026-08-25: Pinterest image-only results no longer mask a real video
 * (PinterestImageOnlyError, pinterest.ts) — a URL that was cached as
 * image-only under v2, BEFORE this fix existed, would otherwise keep
 * serving that stale wrong answer for the rest of its 30-minute TTL
 * regardless of the code fix — exactly the trap this constant exists to
 * avoid (see the TikTok note above). Bumping retires every v2 snapshot.
 */
const EXTRACTOR_SHAPE_VERSION = "v3";

function metadataKey(url: string): string {
  return `meta:${EXTRACTOR_SHAPE_VERSION}:${url}`;
}

/**
 * Runs the custom-first, yt-dlp-fallback extraction chain (no caching).
 *
 * `imageOnlyFallback` (Pinterest, see PinterestImageOnlyError) is a real
 * result the custom extractor found, but NOT a video — it's held back
 * rather than returned immediately, so yt-dlp still gets a real chance to
 * find the actual video first. It's only used if yt-dlp comes up empty too,
 * which is when it's genuinely the best available answer instead of a
 * mask over a video the fast path just failed to see.
 */
async function runChain(url: string): Promise<VideoMetadata> {
  const platform = detectPlatform(url);
  let imageOnlyFallback: VideoMetadata | null = null;
  for (const extractor of CUSTOM_EXTRACTORS) {
    if (!extractor.canHandle(url, platform.id)) continue;
    try {
      const meta = await extractor.extract(url);
      if (meta.formats.length > 0) return meta;
    } catch (err) {
      if (err instanceof PinterestImageOnlyError) {
        imageOnlyFallback = err.imageOnlyMeta;
      }
      const via = isProxyForced() ? " (via proxy)" : "";
      console.warn(
        `[extractor:${extractor.name}]${via} falling back:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  try {
    return await ytdlpExtract(url);
  } catch (err) {
    if (imageOnlyFallback) return imageOnlyFallback;
    throw err;
  }
}

/**
 * Extraction with smart proxy fallback: try DIRECT first; if it fails for a
 * proxy-eligible platform (Instagram, Facebook, X, …) and we're under budget,
 * re-run the WHOLE chain with the residential proxy forced. Direct-success
 * platforms (TikTok, YouTube, Pinterest, Vimeo) never trigger the proxy.
 */
async function extractFresh(url: string): Promise<VideoMetadata> {
  const platform = detectPlatform(url).id;

  // Threads fast path: the post page is now a client-rendered shell with no
  // media, and yt-dlp can't read Threads without auth — only the Apify scraper
  // works. Go straight to it and skip the ~10s of dead page-fetch + yt-dlp
  // attempts. Falls through to the normal chain only if Apify is off or returns
  // nothing.
  if (platform === "threads" && apifyEnabled()) {
    const viaApify = await apifyExtract(url);
    if (viaApify) return viaApify;
  }

  try {
    return await runChain(url);
  } catch (err) {
    // Instagram/Threads: go straight to the Apify scraper (image posts,
    // carousels, dead sessions) — more reliable than the proxy retry for these.
    // Dormant unless APIFY_TOKEN is configured.
    if (apifyEnabled() && isApifyPlatform(platform)) {
      const viaApify = await apifyExtract(url);
      if (viaApify) return viaApify;
    }
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
 *
 * ── Single-flight (2026-08-16) ─────────────────────────────────────────────
 * A cold TikTok URL's chain can legitimately run 20s+ (short-link resolve →
 * TikWM → native scrape, see tiktok.ts). Before this, N concurrent requests
 * for that SAME brand-new URL — a link shared to a few people at once, or a
 * flaky client retrying while the first attempt was still in flight — each
 * ran the full chain independently. `getCached` (lib/cache.ts) is the
 * existing dedup primitive for exactly this: on a miss, exactly one loader
 * runs and everyone else awaits the same promise.
 */
export async function getMetadata(url: string): Promise<VideoMetadata> {
  return getCached(metadataKey(url), METADATA_TTL_SECONDS, async () => {
    const meta = await extractFresh(url);
    // When the source exposes too few (often just one) video quality options,
    // offer extra lower tiers so there's always a real, working choice — see
    // quality-ladder.ts.
    return { ...meta, formats: withQualityLadder(meta.formats) };
  });
}

/** Reads cached metadata without triggering extraction (used at download time). */
export async function getCachedMetadata(
  url: string,
): Promise<VideoMetadata | null> {
  return cacheGet<VideoMetadata>(metadataKey(url));
}
