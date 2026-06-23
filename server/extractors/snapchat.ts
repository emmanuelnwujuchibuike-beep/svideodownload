import { detectPlatform } from "@/lib/platforms";
import type { MediaFormat, PlatformId, VideoMetadata } from "@/types";

import { extractorFetch } from "./http";
import { metaContent, unescapeJsonUrl } from "./parse";
import { ExtractionError, type Extractor } from "./types";

/**
 * Snapchat custom extractor — handles **Spotlight** clips AND public **Story**
 * pages (snapchat.com/@user, /p/, /spotlight/, /t/ share links). Both embed the
 * raw, watermark-free CDN media in the page's `__NEXT_DATA__` blob:
 *   - Spotlight → `props.pageProps.videoMetadata.contentUrl` (clean H.264 mp4)
 *   - Story     → `props.pageProps.story.snapList[].snapUrls.mediaUrl`
 * Using these direct CDN URLs gives a no-watermark download with no transcode,
 * which yt-dlp's Spotlight extractor cannot do (it returns a watermarked render).
 */

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1";

const TIMEOUT_MS = Number(process.env.SNAPCHAT_EXTRACTOR_TIMEOUT_MS || 9000);

interface Snap {
  snapId?: string;
  snapMediaType?: number;
  snapTitle?: string;
  timestampInSec?: number | string;
  snapUrls?: { mediaUrl?: string; mediaPreviewUrl?: string };
}

interface VideoMeta {
  name?: string;
  description?: string;
  thumbnailUrl?: string;
  contentUrl?: string;
  durationMs?: number;
  viewCount?: number | string;
  creator?: unknown;
}

/** Find the snap the URL targets by matching its snapId anywhere in the link. */
function matchSnap(snaps: Snap[], url: string): Snap | null {
  let dec = url;
  try {
    dec = decodeURIComponent(url);
  } catch {
    /* keep raw */
  }
  // 1) the snap's id appears verbatim in the URL (most reliable)
  const exact = snaps.find((s) => s.snapId && (url.includes(s.snapId) || dec.includes(s.snapId)));
  if (exact) return exact;
  // 2) a long token in the URL overlaps a snapId (handles wrapped/short ids)
  for (const t of dec.match(/[A-Za-z0-9_-]{16,}/g) ?? []) {
    const m = snaps.find((s) => s.snapId && (s.snapId.includes(t) || t.includes(s.snapId)));
    if (m) return m;
  }
  return null;
}

function snapFormat(snap: Snap, i: number, count: number): MediaFormat {
  const isVideo = snap.snapMediaType !== 0; // 1 = video, 0 = image
  const headers = { "User-Agent": MOBILE_UA, Referer: "https://www.snapchat.com/" };
  return {
    formatId: `snap-${i}`,
    kind: isVideo ? "video" : "image",
    label: count > 1 ? `Story ${i + 1}` : isVideo ? "Best quality" : "Photo",
    ext: isVideo ? "mp4" : "jpg",
    resolution: null,
    fps: null,
    filesize: null,
    tbr: null,
    vcodec: isVideo ? "h264" : null,
    acodec: isVideo ? "aac" : null,
    directUrl: cleanUrl(snap.snapUrls!.mediaUrl!),
    httpHeaders: headers,
  };
}

function cleanUrl(u: string): string {
  return unescapeJsonUrl(u.replace(/&amp;/g, "&"));
}

function creatorName(c: unknown): string | null {
  if (typeof c === "string") return c;
  if (c && typeof c === "object") {
    const o = c as Record<string, unknown>;
    return (
      (typeof o.name === "string" && o.name) ||
      (typeof o.username === "string" && o.username) ||
      null
    );
  }
  return null;
}

function videoFormat(mediaUrl: string): MediaFormat {
  return {
    formatId: "best",
    kind: "video",
    label: "Best quality",
    ext: "mp4",
    resolution: null,
    fps: null,
    filesize: null,
    tbr: null,
    vcodec: "h264",
    acodec: "aac",
    directUrl: mediaUrl,
    httpHeaders: { "User-Agent": MOBILE_UA, Referer: "https://www.snapchat.com/" },
  };
}

export const snapchatExtractor: Extractor = {
  name: "snapchat",
  canHandle(_url: string, platform: PlatformId) {
    return platform === "snapchat";
  },
  async extract(url: string): Promise<VideoMetadata> {
    const platform = detectPlatform(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let html: string;
    try {
      const res = await extractorFetch(
        url,
        {
          headers: { "User-Agent": MOBILE_UA, "Accept-Language": "en-US,en;q=0.9" },
          redirect: "follow",
          signal: controller.signal,
        },
        "snapchat",
      );
      if (!res.ok) throw new ExtractionError(`Snapchat responded ${res.status}`);
      html = await res.text();
    } finally {
      clearTimeout(timer);
    }

    const blob = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
    );

    let mediaUrl: string | undefined;
    let title: string | undefined;
    let vm: VideoMeta | undefined;
    let formats: MediaFormat[] | undefined;

    if (blob) {
      try {
        const data = JSON.parse(blob[1]!) as {
          props?: { pageProps?: Record<string, unknown> };
        };
        const pp = (data.props?.pageProps ?? {}) as {
          videoMetadata?: VideoMeta;
          story?: { snapList?: Snap[] };
          curatedHighlights?: { snapList?: Snap[] }[];
        };

        // Spotlight (single video page) — the clean, no-watermark H.264 URL.
        if (pp.videoMetadata?.contentUrl) {
          vm = pp.videoMetadata;
          mediaUrl = pp.videoMetadata.contentUrl;
          title = pp.videoMetadata.name;
        }

        // Story page — return the EXACT snap the link points to. If we can't
        // identify it from the URL, return every snap so the user picks the
        // right one (instead of guessing and serving a random snap).
        if (!mediaUrl) {
          const snapList =
            pp.story?.snapList ?? pp.curatedHighlights?.[0]?.snapList ?? [];
          const snaps = (Array.isArray(snapList) ? snapList : []).filter(
            (s) => s.snapUrls?.mediaUrl,
          );
          if (snaps.length) {
            const matched = matchSnap(snaps, url);
            const chosen = matched ? [matched] : snaps;
            formats = chosen.map((s, i) => snapFormat(s, i, chosen.length));
            title = matched?.snapTitle ?? snaps[0]?.snapTitle;
          }
        }
      } catch {
        /* fall through to regex */
      }
    }

    // Generic fallback: any Snapchat CDN media URL in the page (covers layout
    // changes). Spotlight uses extension-less /d/ or /y/ paths; stories use .mp4.
    if (!mediaUrl && !formats?.length) {
      const m =
        html.match(/"contentUrl":"(https:\\?\/\\?\/[a-z0-9.-]*sc-cdn\.net\\?\/[^"]+?)"/i) ??
        html.match(/https:\/\/[a-z0-9.-]*sc-cdn\.net\/[^"'\\ ]+?\.(?:mp4|mov)[^"'\\ ]*/i);
      if (m) mediaUrl = m[1] ?? m[0];
    }

    if (!mediaUrl && !formats?.length) {
      throw new ExtractionError(
        "No Snapchat video found (story may be expired or image-only)",
      );
    }

    const finalFormats =
      formats && formats.length ? formats : [videoFormat(cleanUrl(mediaUrl!))];

    return {
      id: crypto.randomUUID(),
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: (title || metaContent(html, "og:title") || "Snapchat story").slice(0, 200),
      description: vm?.description ?? metaContent(html, "og:description"),
      thumbnail: vm?.thumbnailUrl ? cleanUrl(vm.thumbnailUrl) : metaContent(html, "og:image"),
      durationSeconds: vm?.durationMs ? Math.round(vm.durationMs / 1000) : null,
      creator: creatorName(vm?.creator),
      uploadDate: null,
      viewCount: vm?.viewCount != null ? Number(vm.viewCount) || null : null,
      likeCount: null,
      webpageUrl: url,
      formats: finalFormats,
      extractor: "snapchat",
    };
  },
};
