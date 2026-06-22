import type { MediaFormat, PlatformId, VideoMetadata } from "@/types";

import { detectPlatform } from "@/lib/platforms";

/**
 * Apify fallback for Instagram & Threads — the only reliable way to get image
 * posts, carousels and (when sessions die) reels server-side. Runs the
 * configured actor synchronously and maps its dataset items into our formats.
 *
 * Configure on the worker:
 *   APIFY_TOKEN          = <your token>
 *   APIFY_IG_ACTOR       = apify/instagram-scraper   (default)
 *   APIFY_THREADS_ACTOR  = <optional threads actor>  (else falls back to IG actor)
 *
 * Dormant (returns null) when APIFY_TOKEN isn't set.
 */

// Strip accidental surrounding quotes/whitespace (a common env-var paste issue).
const APIFY_TOKEN = process.env.APIFY_TOKEN?.trim().replace(/^["']|["']$/g, "");
const APIFY_IG_ACTOR = process.env.APIFY_IG_ACTOR || "apify/instagram-scraper";
const APIFY_THREADS_ACTOR = process.env.APIFY_THREADS_ACTOR || APIFY_IG_ACTOR;
const TIMEOUT_MS = Number(process.env.APIFY_TIMEOUT_MS || 90_000);

export function apifyEnabled(): boolean {
  return !!APIFY_TOKEN;
}

interface ApifyMedia {
  type?: string;
  videoUrl?: string;
  displayUrl?: string;
  images?: string[];
  childPosts?: ApifyMedia[];
}
interface ApifyItem extends ApifyMedia {
  caption?: string;
  ownerUsername?: string;
  shortCode?: string;
  videoDuration?: number;
  error?: string;
}

function buildFormats(item: ApifyItem): { formats: MediaFormat[]; thumb: string | null } {
  const headers = { "User-Agent": "Mozilla/5.0", Referer: "https://www.instagram.com/" };
  const children = item.childPosts?.length ? item.childPosts : [item];
  const formats: MediaFormat[] = [];
  let thumb: string | null = item.displayUrl ?? null;

  children.forEach((c, i) => {
    if (c.videoUrl?.startsWith("http")) {
      formats.push({
        formatId: children.length > 1 ? `vid-${i}` : "best",
        kind: "video",
        label: children.length > 1 ? `Video ${i + 1}` : "HD",
        ext: "mp4",
        resolution: null,
        fps: null,
        filesize: null,
        tbr: null,
        vcodec: "h264",
        acodec: "aac",
        directUrl: c.videoUrl,
        httpHeaders: headers,
      });
      if (!thumb) thumb = c.displayUrl ?? null;
    } else {
      const img = c.displayUrl || c.images?.[0];
      if (img?.startsWith("http")) {
        formats.push({
          formatId: `img-${i}`,
          kind: "image",
          label: children.length > 1 ? `Photo ${i + 1}` : "Photo",
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
      }
    }
  });

  return { formats, thumb };
}

export async function apifyExtract(url: string): Promise<VideoMetadata | null> {
  if (!APIFY_TOKEN) return null;
  const platform = detectPlatform(url);
  const actor = platform.id === "threads" ? APIFY_THREADS_ACTOR : APIFY_IG_ACTOR;
  const path = actor.replace("/", "~");

  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${path}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directUrls: [url],
          resultsType: "posts",
          resultsLimit: 1,
          addParentData: false,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const items = (await res.json()) as ApifyItem[];
    const item = Array.isArray(items)
      ? items.find((it) => !it.error && (it.videoUrl || it.displayUrl || it.childPosts))
      : null;
    if (!item) return null;

    const { formats, thumb } = buildFormats(item);
    if (formats.length === 0) return null;

    return {
      id: item.shortCode || crypto.randomUUID(),
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: item.caption?.trim().slice(0, 200) || `${platform.name} post`,
      description: item.caption?.trim() || null,
      thumbnail: thumb,
      durationSeconds: item.videoDuration ?? null,
      creator: item.ownerUsername ?? null,
      uploadDate: null,
      viewCount: null,
      likeCount: null,
      webpageUrl: url,
      formats,
      extractor: "ytdlp", // reuse existing union; surfaced like any other
    };
  } catch {
    return null;
  }
}

export function isApifyPlatform(platform: PlatformId): boolean {
  return platform === "instagram" || platform === "threads";
}
