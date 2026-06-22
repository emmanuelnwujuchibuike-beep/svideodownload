import { detectPlatform } from "@/lib/platforms";
import type { MediaFormat, PlatformId, VideoMetadata } from "@/types";

import { extractorFetch } from "./http";
import { DESKTOP_UA } from "./parse";
import { ExtractionError, type Extractor } from "./types";

/**
 * Instagram extractor via the private web media API
 * (`/api/v1/media/<pk>/info/`). With the YTDLP_COOKIES `sessionid` attached by
 * extractorFetch, this returns full media info for reels, photos AND carousels
 * — the only reliable way to get image posts, which yt-dlp refuses. On any
 * failure we throw and the registry falls back to yt-dlp.
 */

const TIMEOUT_MS = Number(process.env.INSTAGRAM_EXTRACTOR_TIMEOUT_MS || 12000);
const IG_APP_ID = "936619743392459";
// The mobile API (i.instagram.com) returns 403 when IP-blocked — which triggers
// our residential-proxy retry — whereas the www API 302-redirects to login.
const IG_APP_UA =
  "Instagram 269.0.0.18.75 Android (30/11; 420dpi; 1080x2400; samsung; " +
  "SM-G991B; o1s; exynos2100; en_US; 314665256)";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function shortcodeOf(url: string): string | null {
  const m = url.match(
    /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i,
  );
  return m ? m[1]! : null;
}

/** Instagram shortcode → numeric media pk (base64 with IG's alphabet). */
function shortcodeToPk(shortcode: string): string | null {
  let pk = 0n;
  for (const ch of shortcode) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    pk = pk * 64n + BigInt(idx);
  }
  return pk.toString();
}

interface IgImageCandidate { url?: string; width?: number; height?: number }
interface IgMedia {
  media_type?: number; // 1 image, 2 video, 8 carousel
  video_versions?: { url?: string; width?: number; height?: number }[];
  image_versions2?: { candidates?: IgImageCandidate[] };
  carousel_media?: IgMedia[];
}
interface IgItem extends IgMedia {
  code?: string;
  caption?: { text?: string } | null;
  user?: { username?: string };
}

function bestImage(m: IgMedia): IgImageCandidate | null {
  const c = m.image_versions2?.candidates ?? [];
  return c.slice().sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0] ?? null;
}

function buildFormats(item: IgItem): MediaFormat[] {
  const headers = { "User-Agent": DESKTOP_UA, Referer: "https://www.instagram.com/" };
  const children = item.carousel_media?.length ? item.carousel_media : [item];
  const formats: MediaFormat[] = [];

  children.forEach((child, i) => {
    const video = child.video_versions?.find((v) => v.url?.startsWith("http"));
    if (video?.url) {
      formats.push({
        formatId: children.length > 1 ? `vid-${i}` : "ig-hd",
        kind: "video",
        label: children.length > 1 ? `Video ${i + 1}` : "HD",
        ext: "mp4",
        resolution: video.height ? `${video.height}p` : null,
        fps: null,
        filesize: null,
        tbr: null,
        vcodec: "h264",
        acodec: "aac",
        directUrl: video.url,
        httpHeaders: headers,
      });
      return;
    }
    const img = bestImage(child);
    if (img?.url) {
      formats.push({
        formatId: `img-${i}`,
        kind: "image",
        label: children.length > 1 ? `Photo ${i + 1}` : "Photo",
        ext: /\.png/i.test(img.url) ? "png" : /\.webp/i.test(img.url) ? "webp" : "jpg",
        resolution: null,
        fps: null,
        filesize: null,
        tbr: null,
        vcodec: null,
        acodec: null,
        directUrl: img.url,
        httpHeaders: headers,
      });
    }
  });

  return formats;
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
    const pk = shortcodeToPk(shortcode);
    if (!pk) throw new ExtractionError("Bad Instagram shortcode");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let item: IgItem;
    try {
      const res = await extractorFetch(
        `https://i.instagram.com/api/v1/media/${pk}/info/`,
        {
          headers: {
            "User-Agent": IG_APP_UA,
            "X-IG-App-ID": IG_APP_ID,
            Accept: "*/*",
            "Accept-Language": "en-US,en;q=0.9",
          },
          signal: controller.signal,
        },
        "instagram",
      );
      if (!res.ok) throw new ExtractionError(`Instagram API ${res.status}`);
      const data = (await res.json()) as { items?: IgItem[] };
      const first = data.items?.[0];
      if (!first) throw new ExtractionError("Instagram API returned no item");
      item = first;
    } finally {
      clearTimeout(timer);
    }

    const formats = buildFormats(item);
    if (formats.length === 0) {
      throw new ExtractionError("No Instagram media found");
    }

    const thumb = bestImage(item.carousel_media?.[0] ?? item)?.url ?? null;
    return {
      id: shortcode,
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: item.caption?.text?.trim().slice(0, 200) || "Instagram post",
      description: item.caption?.text?.trim() || null,
      thumbnail: thumb,
      durationSeconds: null,
      creator: item.user?.username ?? null,
      uploadDate: null,
      viewCount: null,
      likeCount: null,
      webpageUrl: url,
      formats,
      extractor: "instagram",
    };
  },
};
