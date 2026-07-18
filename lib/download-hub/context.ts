import type { MediaFormat, MediaKind, VideoMetadata } from "@/types";

import type { DownloadContext } from "./types";

/**
 * Builds the Discovery Gateway's ranking input from a completed download.
 *
 * Shared because there are TWO download surfaces — the marketing `Downloader`
 * and the Hub's `DownloadBox` — and they must produce identical context. When
 * this logic lived inline in one of them, the other silently had no Gateway at
 * all, which is exactly the drift a shared builder prevents.
 */

/**
 * Vertical pixel count of a chosen rendition.
 *
 * There is no `height` field on MediaFormat, so this reads the three places the
 * information actually appears, cheapest first. Returns 0 for "unknown", which
 * the ranker treats as a neutral signal rather than as low quality.
 */
export function heightOf(fmt: MediaFormat | undefined): number {
  if (!fmt) return 0;
  const fromId = Number(fmt.formatId);
  if (Number.isFinite(fromId) && fromId > 0) return fromId;
  const fromResolution = fmt.resolution?.match(/x(\d+)/)?.[1];
  if (fromResolution) return Number(fromResolution);
  const fromLabel = fmt.label?.match(/(\d+)p/)?.[1];
  return fromLabel ? Number(fromLabel) : 0;
}

/**
 * Picks the rendition Auto Download should take for a preferred quality.
 *
 * Pure and separated from the component so it can be tested against real format
 * shapes — the fallback behaviour is the part that matters, and it is easy to
 * get wrong. Rules:
 *   - "audio" takes an audio track, or falls back to video if none exists
 *     (better to save something than to silently do nothing).
 *   - a height preference takes the best rendition AT OR BELOW it, so "720" on a
 *     source that only offers 1080 and 480 picks 480 rather than overshooting a
 *     metered connection.
 *   - if nothing matches, take the source's best.
 */
export function pickFormat(
  formats: MediaFormat[],
  preferred: "best" | "1080" | "720" | "480" | "audio",
): MediaFormat | undefined {
  if (formats.length === 0) return undefined;

  const videos = formats.filter((f) => f.kind === "video");
  const audios = formats.filter((f) => f.kind === "audio");

  if (preferred === "audio") return audios[0] ?? videos[0] ?? formats[0];
  if (preferred === "best") return videos[0] ?? formats[0];

  const ceiling = Number(preferred);
  const atOrBelow = videos
    .map((f) => ({ f, h: heightOf(f) }))
    .filter(({ h }) => h > 0 && h <= ceiling)
    .sort((a, b) => b.h - a.h)[0]?.f;

  return atOrBelow ?? videos[0] ?? formats[0];
}

export function buildDownloadContext({
  metadata,
  formatId,
  kind,
  signedIn,
  plan = "free",
  downloadCount,
}: {
  metadata: VideoMetadata;
  formatId: string;
  kind: MediaKind;
  signedIn: boolean;
  plan?: DownloadContext["plan"];
  downloadCount: number;
}): DownloadContext {
  const fmt = metadata.formats.find((f) => f.formatId === formatId);
  return {
    platformId: metadata.platform,
    kind,
    durationSec: metadata.durationSeconds ?? 0,
    height: heightOf(fmt),
    // `acodec: "none"` is yt-dlp's marker for a video-only rendition. Absent
    // codec data means unknown, and assuming audio is present is the safer
    // default — it keeps caption suggestions available rather than silently
    // dropping them.
    hasAudio: kind !== "image" && fmt?.acodec !== "none",
    signedIn,
    plan,
    downloadCount,
  };
}
