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
  if (!item?.video) throw new ExtractionError("TikTok item missing");
  return item;
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

export const tiktokExtractor: Extractor = {
  name: "tiktok",
  canHandle(_url: string, platform: PlatformId) {
    return platform === "tiktok";
  },
  async extract(url: string): Promise<VideoMetadata> {
    const platform = detectPlatform(url);
    const resolved = await resolveUrl(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIKTOK_TIMEOUT_MS);
    let html: string;
    try {
      const res = await extractorFetch(
        resolved,
        {
          headers: FETCH_HEADERS,
          redirect: "follow",
          signal: controller.signal,
        },
        "tiktok",
      );
      if (!res.ok) throw new ExtractionError(`TikTok responded ${res.status}`);
      html = await res.text();
    } finally {
      clearTimeout(timer);
    }

    const item = findItemStruct(extractStateJson(html));
    const video = item.video!;
    const createTime = item.createTime ? Number(item.createTime) : null;

    return {
      id: item.id || crypto.randomUUID(),
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: item.desc?.trim() || "TikTok video",
      description: item.desc?.trim() || null,
      thumbnail: video.cover || video.originCover || null,
      durationSeconds: video.duration ?? null,
      creator: item.author?.nickname || item.author?.uniqueId || null,
      uploadDate:
        createTime && Number.isFinite(createTime)
          ? new Date(createTime * 1000).toISOString().slice(0, 10)
          : null,
      viewCount: item.stats?.playCount ?? null,
      likeCount: item.stats?.diggCount ?? null,
      webpageUrl: resolved,
      formats: buildFormats(item),
      extractor: "tiktok",
    };
  },
};
