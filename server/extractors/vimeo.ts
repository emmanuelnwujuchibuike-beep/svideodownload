import { detectPlatform } from "@/lib/platforms";
import type { MediaFormat, PlatformId, VideoMetadata } from "@/types";

import { extractorFetch } from "./http";
import { ExtractionError, type Extractor } from "./types";

/**
 * Vimeo custom extractor.
 *
 * Vimeo exposes a public player-config endpoint that returns direct progressive
 * MP4 URLs (no auth, not WAF-blocked from datacenter IPs), so we can resolve
 * every available quality and proxy the bytes directly — no yt-dlp needed.
 */

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const VIMEO_TIMEOUT_MS = Number(process.env.VIMEO_EXTRACTOR_TIMEOUT_MS || 8000);

interface VimeoProgressive {
  profile?: number | string;
  quality?: string;
  url?: string;
  width?: number;
  height?: number;
  fps?: number;
}

interface VimeoConfig {
  video?: {
    id?: number | string;
    title?: string;
    duration?: number;
    thumbs?: Record<string, string>;
    owner?: { name?: string };
  };
  request?: { files?: { progressive?: VimeoProgressive[] } };
}

/** Extracts the numeric id and optional privacy hash from a Vimeo URL. */
function parseVimeo(url: string): { id: string; hash: string | null } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  // player.vimeo.com/video/{id}
  const player = u.pathname.match(/\/video\/(\d+)/);
  if (player) return { id: player[1]!, hash: u.searchParams.get("h") };
  // vimeo.com/{id} or vimeo.com/{id}/{hash}
  const parts = u.pathname.split("/").filter(Boolean);
  const idIdx = parts.findIndex((p) => /^\d+$/.test(p));
  if (idIdx === -1) return null;
  const id = parts[idIdx]!;
  const hash = parts[idIdx + 1] && /^[a-f0-9]+$/i.test(parts[idIdx + 1]!)
    ? parts[idIdx + 1]!
    : null;
  return { id, hash };
}

function bestThumb(thumbs: Record<string, string> | undefined): string | null {
  if (!thumbs) return null;
  const keys = Object.keys(thumbs).sort(
    (a, b) => (parseInt(b) || 0) - (parseInt(a) || 0),
  );
  return keys.length ? (thumbs[keys[0]!] ?? null) : null;
}

function buildFormats(progressive: VimeoProgressive[]): MediaFormat[] {
  const headers = { "User-Agent": DESKTOP_UA, Referer: "https://vimeo.com/" };
  const byHeight = new Map<number, MediaFormat>();

  for (const p of progressive) {
    if (!p.url || !p.height) continue;
    const existing = byHeight.get(p.height);
    if (existing) continue; // first (config order) is fine
    byHeight.set(p.height, {
      formatId: String(p.height),
      // Label from the true pixel height so it always matches `formatId`
      // (Vimeo's `quality` field can disagree, e.g. "240p" for a 270px stream).
      kind: "video",
      label: `${p.height}p`,
      ext: "mp4",
      resolution: `${p.height}p`,
      fps: p.fps ?? null,
      filesize: null,
      tbr: null,
      vcodec: "h264",
      acodec: "aac",
      directUrl: p.url,
      httpHeaders: headers,
    });
  }

  return [...byHeight.values()].sort(
    (a, b) => (parseInt(b.resolution ?? "0") || 0) - (parseInt(a.resolution ?? "0") || 0),
  );
}

export const vimeoExtractor: Extractor = {
  name: "vimeo",
  canHandle(_url: string, platform: PlatformId) {
    return platform === "vimeo";
  },
  async extract(url: string): Promise<VideoMetadata> {
    const platform = detectPlatform(url);
    const parsed = parseVimeo(url);
    if (!parsed) throw new ExtractionError("Unrecognised Vimeo URL");

    const configUrl =
      `https://player.vimeo.com/video/${parsed.id}/config` +
      (parsed.hash ? `?h=${parsed.hash}` : "");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VIMEO_TIMEOUT_MS);
    let config: VimeoConfig;
    try {
      const res = await extractorFetch(
        configUrl,
        {
          headers: { "User-Agent": DESKTOP_UA, Referer: "https://vimeo.com/" },
          signal: controller.signal,
        },
        "vimeo",
      );
      if (!res.ok) throw new ExtractionError(`Vimeo responded ${res.status}`);
      config = (await res.json()) as VimeoConfig;
    } finally {
      clearTimeout(timer);
    }

    const progressive = config.request?.files?.progressive ?? [];
    const formats = buildFormats(progressive);
    if (formats.length === 0) {
      throw new ExtractionError("No progressive Vimeo formats");
    }

    return {
      id: String(config.video?.id ?? parsed.id),
      platform: platform.id,
      platformName: platform.name,
      sourceUrl: url,
      title: config.video?.title?.trim() || "Vimeo video",
      description: null,
      thumbnail: bestThumb(config.video?.thumbs),
      durationSeconds: config.video?.duration ?? null,
      creator: config.video?.owner?.name ?? null,
      uploadDate: null,
      viewCount: null,
      likeCount: null,
      webpageUrl: url,
      formats,
      extractor: "vimeo",
    };
  },
};
