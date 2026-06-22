import { detectPlatform } from "@/lib/platforms";
import type { MediaFormat, PlatformId, VideoMetadata } from "@/types";

import { extractorFetch } from "./http";
import { ExtractionError, type Extractor } from "./types";

/**
 * Fast, no-subprocess TikTok extractor — the "snaptik" approach.
 *
 * Instead of spawning yt-dlp (Python start-up + JS-challenge solving, ~5s), we
 * fetch the watch page with a desktop User-Agent and read the embedded
 * `__UNIVERSAL_DATA_FOR_REHYDRATION__` JSON state. From it we pull every
 * available bitrate (so we can offer up to the highest quality) plus a clean,
 * watermark-free playback URL. On ANY failure we throw, and the registry falls
 * back to yt-dlp so reliability is never worse than before.
 */

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const FETCH_HEADERS = {
  "User-Agent": DESKTOP_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.tiktok.com/",
};

const TIKTOK_TIMEOUT_MS = Number(process.env.TIKTOK_EXTRACTOR_TIMEOUT_MS || 8000);

interface TikTokBitrate {
  Bitrate?: number;
  QualityType?: number;
  GearName?: string;
  PlayAddr?: { Width?: number; Height?: number; UrlList?: string[] };
}

interface TikTokItem {
  id?: string;
  desc?: string;
  createTime?: number | string;
  author?: { uniqueId?: string; nickname?: string };
  music?: { title?: string; playUrl?: string };
  stats?: { playCount?: number; diggCount?: number };
  video?: {
    duration?: number;
    cover?: string;
    originCover?: string;
    dynamicCover?: string;
    playAddr?: string;
    downloadAddr?: string;
    width?: number;
    height?: number;
    bitrateInfo?: TikTokBitrate[];
  };
  // Photo / slideshow posts.
  imagePost?: {
    images?: { imageURL?: { urlList?: string[] } }[];
  };
}

async function resolveUrl(url: string): Promise<string> {
  // Short links (vm./vt.tiktok.com) redirect to the canonical watch URL.
  if (/\b(vm|vt)\.tiktok\.com\b/i.test(url)) {
    const res = await extractorFetch(
      url,
      {
        method: "HEAD",
        redirect: "follow",
        headers: { "User-Agent": DESKTOP_UA },
      },
      "tiktok",
    );
    return res.url || url;
  }
  return url;
}

function extractStateJson(html: string): unknown {
  const marker =
    '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">';
  const start = html.indexOf(marker);
  if (start === -1) throw new ExtractionError("TikTok state not found");
  const from = start + marker.length;
  const end = html.indexOf("</script>", from);
  if (end === -1) throw new ExtractionError("TikTok state not terminated");
  try {
    return JSON.parse(html.slice(from, end));
  } catch {
    throw new ExtractionError("TikTok state not parseable");
  }
}

function findItemStruct(state: unknown): TikTokItem {
  const scope = (state as Record<string, unknown>)?.["__DEFAULT_SCOPE__"] as
    | Record<string, unknown>
    | undefined;
  const detail = scope?.["webapp.video-detail"] as
    | { itemInfo?: { itemStruct?: TikTokItem } }
    | undefined;
  const item = detail?.itemInfo?.itemStruct;
  // Accept video posts AND photo/slideshow (imagePost) posts.
  if (!item?.video && !item?.imagePost?.images?.length) {
    throw new ExtractionError("TikTok item missing");
  }
  return item;
}

/** Image (photo / slideshow) post → one downloadable image per slide. */
function buildImageFormats(item: TikTokItem): MediaFormat[] {
  const headers: Record<string, string> = {
    "User-Agent": DESKTOP_UA,
    Referer: "https://www.tiktok.com/",
  };
  const images = item.imagePost?.images ?? [];
  const formats: MediaFormat[] = [];
  images.forEach((img, i) => {
    const url = img.imageURL?.urlList?.find((u) => u.startsWith("http"));
    if (!url) return;
    formats.push({
      formatId: `img-${i}`,
      kind: "image",
      label: `Photo ${i + 1}`,
      ext: "jpg",
      resolution: null,
      fps: null,
      filesize: null,
      tbr: null,
      vcodec: null,
      acodec: null,
      directUrl: url,
      httpHeaders: headers,
    });
  });
  // Slideshows usually carry a sound too.
  if (item.music?.playUrl) {
    formats.push({
      formatId: "audio",
      kind: "audio",
      label: "Audio (M4A)",
      ext: "m4a",
      resolution: null,
      fps: null,
      filesize: null,
      tbr: null,
      vcodec: null,
      acodec: "aac",
      directUrl: item.music.playUrl,
      httpHeaders: headers,
    });
  }
  if (formats.length === 0) {
    throw new ExtractionError("No TikTok images found");
  }
  return formats;
}

function buildFormats(item: TikTokItem): MediaFormat[] {
  const video = item.video!;
  const headers: Record<string, string> = {
    "User-Agent": DESKTOP_UA,
    Referer: "https://www.tiktok.com/",
  };

  const formats: MediaFormat[] = [];
  const seen = new Set<string>();

  // WATERMARK-FREE GUARANTEE: we only ever read `bitrateInfo.PlayAddr` and
  // `video.playAddr` — TikTok's clean playback sources. We deliberately never
  // touch `video.downloadAddr`, which is the watermarked "Save video" asset.
  const bitrates = (video.bitrateInfo || [])
    .slice()
    .sort((a, b) => (b.Bitrate ?? 0) - (a.Bitrate ?? 0));

  for (const br of bitrates) {
    const url = br.PlayAddr?.UrlList?.find((u) => u.startsWith("http"));
    if (!url) continue;
    const height = br.PlayAddr?.Height || video.height || null;
    const key = `${height}-${br.GearName ?? br.Bitrate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    formats.push({
      formatId: `tt-${formats.length}`,
      kind: "video",
      label: height ? `${height}p` : br.GearName || "HD",
      ext: "mp4",
      resolution: height ? `${height}p` : null,
      fps: null,
      filesize: null,
      tbr: br.Bitrate ? Math.round(br.Bitrate / 1000) : null,
      vcodec: "h264",
      acodec: "aac",
      directUrl: url,
      httpHeaders: headers,
    });
  }

  // Fallback to the top-level playAddr if no bitrate list was present.
  if (formats.length === 0 && video.playAddr) {
    formats.push({
      formatId: "tt-0",
      kind: "video",
      label: video.height ? `${video.height}p` : "HD",
      ext: "mp4",
      resolution: video.height ? `${video.height}p` : null,
      fps: null,
      filesize: null,
      tbr: null,
      vcodec: "h264",
      acodec: "aac",
      directUrl: video.playAddr,
      httpHeaders: headers,
    });
  }

  if (formats.length === 0) {
    throw new ExtractionError("No TikTok playback URL found");
  }

  // Audio (original sound) when available — direct proxy, no transcode.
  if (item.music?.playUrl) {
    formats.push({
      formatId: "audio",
      kind: "audio",
      label: "Audio (M4A)",
      ext: "m4a",
      resolution: null,
      fps: null,
      filesize: null,
      tbr: null,
      vcodec: null,
      acodec: "aac",
      directUrl: item.music.playUrl,
      httpHeaders: headers,
    });
  }

  return formats;
}

/**
 * Fallback via the free TikWM API. TikTok serves datacenter IPs a blank page,
 * so when the native page parse fails (and for region-locked videos) this
 * returns the no-watermark video, the sound, OR each image of a photo post.
 */
interface TikWmData {
  id?: string;
  title?: string;
  cover?: string;
  duration?: number;
  play?: string;
  hdplay?: string;
  music?: string;
  images?: string[];
  author?: { nickname?: string; unique_id?: string };
}
function abs(u: string): string {
  return u.startsWith("http") ? u : `https://www.tikwm.com${u}`;
}
async function tikwmExtract(
  url: string,
  platform: ReturnType<typeof detectPlatform>,
): Promise<VideoMetadata | null> {
  try {
    const res = await extractorFetch(
      `https://www.tikwm.com/api/?hd=1&url=${encodeURIComponent(url)}`,
      { headers: { "User-Agent": DESKTOP_UA, Accept: "application/json" } },
      "tiktok",
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { code?: number; data?: TikWmData };
    if (j.code !== 0 || !j.data) return null;
    const d = j.data;
    const headers = { "User-Agent": DESKTOP_UA, Referer: "https://www.tiktok.com/" };
    const formats: MediaFormat[] = [];

    if (Array.isArray(d.images) && d.images.length) {
      d.images.forEach((img, i) =>
        formats.push({
          formatId: `img-${i}`,
          kind: "image",
          label: `Photo ${i + 1}`,
          ext: /\.png/i.test(img) ? "png" : "jpg",
          resolution: null,
          fps: null,
          filesize: null,
          tbr: null,
          vcodec: null,
          acodec: null,
          directUrl: abs(img),
          httpHeaders: headers,
        }),
      );
    } else {
      const v = d.hdplay || d.play;
      if (v)
        formats.push({
          formatId: "tt-0",
          kind: "video",
          label: "HD · No watermark",
          ext: "mp4",
          resolution: null,
          fps: null,
          filesize: null,
          tbr: null,
          vcodec: "h264",
          acodec: "aac",
          directUrl: abs(v),
          httpHeaders: headers,
        });
    }
    if (d.music)
      formats.push({
        formatId: "audio",
        kind: "audio",
        label: "Audio (MP3)",
        ext: "mp3",
        resolution: null,
        fps: null,
        filesize: null,
        tbr: null,
        vcodec: null,
        acodec: "aac",
        directUrl: abs(d.music),
        httpHeaders: headers,
      });
    if (formats.length === 0) return null;

    return {
      id: d.id || crypto.randomUUID(),
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: d.title?.trim().slice(0, 200) || "TikTok",
      description: d.title?.trim() || null,
      thumbnail: d.cover ? abs(d.cover) : null,
      durationSeconds: d.duration ?? null,
      creator: d.author?.nickname || d.author?.unique_id || null,
      uploadDate: null,
      viewCount: null,
      likeCount: null,
      webpageUrl: url,
      formats,
      extractor: "tiktok",
    };
  } catch {
    return null;
  }
}

async function nativeExtract(
  url: string,
  platform: ReturnType<typeof detectPlatform>,
): Promise<VideoMetadata> {
  const resolved = await resolveUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIKTOK_TIMEOUT_MS);
  let html: string;
  try {
    const res = await extractorFetch(
      resolved,
      { headers: FETCH_HEADERS, redirect: "follow", signal: controller.signal },
      "tiktok",
    );
    if (!res.ok) throw new ExtractionError(`TikTok responded ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const item = findItemStruct(extractStateJson(html));
    const isPhoto = !item.video && !!item.imagePost?.images?.length;
    const video = item.video;
    const createTime = item.createTime ? Number(item.createTime) : null;
    const firstImage =
      item.imagePost?.images?.[0]?.imageURL?.urlList?.find((u) =>
        u.startsWith("http"),
      ) ?? null;

    return {
      id: item.id || crypto.randomUUID(),
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: item.desc?.trim() || (isPhoto ? "TikTok photos" : "TikTok video"),
      description: item.desc?.trim() || null,
      thumbnail: video?.cover || video?.originCover || firstImage,
      durationSeconds: video?.duration ?? null,
      creator: item.author?.nickname || item.author?.uniqueId || null,
      uploadDate:
        createTime && Number.isFinite(createTime)
          ? new Date(createTime * 1000).toISOString().slice(0, 10)
          : null,
      viewCount: item.stats?.playCount ?? null,
      likeCount: item.stats?.diggCount ?? null,
      webpageUrl: resolved,
      formats: isPhoto ? buildImageFormats(item) : buildFormats(item),
      extractor: "tiktok",
    };
}

export const tiktokExtractor: Extractor = {
  name: "tiktok",
  canHandle(_url: string, platform: PlatformId) {
    return platform === "tiktok";
  },
  async extract(url: string): Promise<VideoMetadata> {
    const platform = detectPlatform(url);
    try {
      return await nativeExtract(url, platform);
    } catch (err) {
      // TikTok blocks datacenter IPs (blank page) and region-locks some videos —
      // fall back to the TikWM API before giving up to yt-dlp.
      const viaApi = await tikwmExtract(url, platform);
      if (viaApi) return viaApi;
      throw err;
    }
  },
};
