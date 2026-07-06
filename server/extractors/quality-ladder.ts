import type { MediaFormat } from "@/types";

/** How many video quality options we ever want to surface, native + synthesized. */
const MAX_VIDEO_TIERS = 4;

/**
 * Lower tiers we synthesize downward from when a source is thin, ordered
 * highest-first. Proportionate to a genuinely HD/vertical-HD source (e.g. a
 * 1080x1920 clip) rather than a fixed low floor — 480/360/240 reads as "too
 * low" under a 1920-tall original. Filtered to strictly-below-source at
 * selection time, so a 1080p source still correctly falls through to 720
 * and below instead of offering 1200/1080 above itself.
 */
const LADDER_TIERS = [1200, 1080, 720, 480, 360, 240] as const;

function heightOf(f: MediaFormat): number | null {
  const m = /^(\d+)p$/.exec(f.resolution ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * Some sources (most commonly TikTok, when its native page parse is blocked
 * and the app falls back to the TikWM API) expose only ONE video quality. On a
 * weak connection or an older device that's the only choice — and if that
 * single stream ever turns out to be undecodable as video, there's no working
 * fallback at all. When fewer than `MAX_VIDEO_TIERS` native options exist, this
 * synthesizes extra LOWER tiers from the same source: at download time
 * they're downscaled + re-encoded via ffmpeg (`transcodeMaxHeight`), which also
 * doubles as validation (a source with no real video track fails loudly there
 * instead of silently shipping an audio-only file). No-ops when the source
 * already has enough native tiers, or has no `directUrl` to derive from
 * (yt-dlp-backed formats manage their own quality ladder already).
 */
export function withQualityLadder(formats: MediaFormat[]): MediaFormat[] {
  const videos = formats.filter((f) => f.kind === "video");
  if (videos.length >= MAX_VIDEO_TIERS || videos.length === 0) return formats;

  // Extractors already sort best-first — the first entry with a direct URL is
  // what we derive synthesized tiers from.
  const source = videos.find((f) => !!f.directUrl);
  if (!source) return formats;

  const sourceHeight = heightOf(source);
  const existingHeights = new Set(videos.map(heightOf).filter((h): h is number => h != null));

  const synthesized: MediaFormat[] = [];
  for (const tier of LADDER_TIERS) {
    if (videos.length + synthesized.length >= MAX_VIDEO_TIERS) break;
    if (sourceHeight != null && tier >= sourceHeight) continue; // only strictly lower
    if (existingHeights.has(tier)) continue;
    synthesized.push({
      formatId: `${source.formatId}-h${tier}`,
      kind: "video",
      label: `${tier}p`,
      ext: "mp4",
      resolution: `${tier}p`,
      fps: null,
      filesize: null,
      tbr: null,
      vcodec: "h264",
      acodec: "aac",
      directUrl: source.directUrl,
      httpHeaders: source.httpHeaders,
      transcodeMaxHeight: tier,
    });
  }
  if (synthesized.length === 0) return formats;

  const nonVideo = formats.filter((f) => f.kind !== "video");
  return [...videos, ...synthesized, ...nonVideo];
}
