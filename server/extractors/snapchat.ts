import { detectPlatform } from "@/lib/platforms";
import type { MediaFormat, PlatformId, VideoMetadata } from "@/types";

import { extractorFetch } from "./http";
import { metaContent, unescapeJsonUrl } from "./parse";
import { ExtractionError, type Extractor } from "./types";

/**
 * Snapchat custom extractor — handles public **Story** pages (snapchat.com/@user,
 * /p/, /add/) which yt-dlp doesn't cover. The page embeds each story snap in a
 * `__NEXT_DATA__` blob (`props.pageProps.story.snapList`), where every snap has a
 * `snapMediaType` (1 = video, 0 = image) and a direct `snapUrls.mediaUrl` CDN
 * link. We surface the targeted snap (or the latest video snap) as a download.
 * Spotlight links fall through to yt-dlp's dedicated extractor.
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

/** Pick the snap the URL targets, else the most recent video snap. */
function pickSnap(snapList: Snap[], url: string): Snap | null {
  const idMatch = url.match(/\/(?:@[^/]+|p|spotlight|t)\/[^/]*?([A-Za-z0-9_-]{16,})/);
  if (idMatch) {
    const exact = snapList.find((s) => s.snapId === idMatch[1]);
    if (exact?.snapUrls?.mediaUrl) return exact;
  }
  return (
    snapList.find((s) => s.snapMediaType === 1 && s.snapUrls?.mediaUrl) ?? null
  );
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
  canHandle(url: string, platform: PlatformId) {
    // Only handle profile / Story pages here. Spotlight and /t/ share links go
    // to yt-dlp's dedicated Spotlight extractor (more reliable for those).
    return platform === "snapchat" && /snapchat\.com\/@/.test(url);
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
    let snapTitle: string | undefined;

    if (blob) {
      try {
        const data = JSON.parse(blob[1]!) as {
          props?: { pageProps?: Record<string, unknown> };
        };
        const pp = (data.props?.pageProps ?? {}) as {
          story?: { snapList?: Snap[] };
          curatedHighlights?: { snapList?: Snap[] }[];
        };
        const snapList =
          pp.story?.snapList ?? pp.curatedHighlights?.[0]?.snapList ?? [];
        if (Array.isArray(snapList) && snapList.length) {
          const snap = pickSnap(snapList, url);
          if (snap?.snapUrls?.mediaUrl) {
            mediaUrl = snap.snapUrls.mediaUrl;
            snapTitle = snap.snapTitle;
          }
        }
      } catch {
        /* fall through to regex */
      }
    }

    // Generic fallback: any Snapchat CDN MP4 in the page.
    if (!mediaUrl) {
      const m = html.match(
        /https:\/\/[a-z0-9.-]*sc-cdn\.net\/[^"'\\ ]+?\.(?:mp4|mov)[^"'\\ ]*/i,
      );
      if (m) mediaUrl = m[0];
    }

    if (!mediaUrl) {
      // No story video — let yt-dlp try (e.g. Spotlight) or report cleanly.
      throw new ExtractionError(
        "No Snapchat video found (story may be expired or image-only)",
      );
    }

    mediaUrl = unescapeJsonUrl(mediaUrl);

    return {
      id: crypto.randomUUID(),
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: (snapTitle || metaContent(html, "og:title") || "Snapchat video").slice(
        0,
        200,
      ),
      description: metaContent(html, "og:description"),
      thumbnail: metaContent(html, "og:image"),
      durationSeconds: null,
      creator: null,
      uploadDate: null,
      viewCount: null,
      likeCount: null,
      webpageUrl: url,
      formats: [videoFormat(mediaUrl)],
      extractor: "snapchat",
    };
  },
};
