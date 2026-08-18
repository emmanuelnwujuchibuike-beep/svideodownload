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
 * Explicit, defensive best-first ordering — the rest of this module (and
 * every client-side "download the highest quality" default: `PreviewCard`'s
 * `activeId`/tab defaults, and the batch flow, which just downloads whatever
 * `formats[0]`/each selected entry resolves to) had only ever RELIED on "extractors
 * already sort best-first" as an unenforced convention, never verified it.
 * A new or changed extractor that got the order wrong would silently ship
 * "highest quality" downloads that weren't, with nothing to catch it.
 *
 * Sorts by measured height when known (descending), falling back to bitrate
 * (`tbr`) when two formats tie or neither has a height — never reorders
 * `isSeparateItem` entries relative to each other, since those are distinct
 * pieces of content (story slide 1, 2, 3…) whose ORDER is meaningful, not a
 * quality ladder to rank.
 */
function bestFirst(videos: MediaFormat[]): MediaFormat[] {
  const ladder = videos.filter((f) => !f.isSeparateItem);
  const separate = videos.filter((f) => f.isSeparateItem);
  const sorted = [...ladder].sort((a, b) => {
    const ha = heightOf(a);
    const hb = heightOf(b);
    if (ha != null && hb != null && ha !== hb) return hb - ha;
    if (ha != null && hb == null) return -1;
    if (ha == null && hb != null) return 1;
    return (b.tbr ?? 0) - (a.tbr ?? 0);
  });
  // Separate items keep their own relative (chronological) order and are
  // never interleaved with the quality-ladder entries' new positions.
  return videos.map((f) => (f.isSeparateItem ? separate.shift()! : sorted.shift()!));
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
  // Sorted UNCONDITIONALLY, before any of the branches below — every one of
  // them used to return `formats` (the raw, only-conventionally-ordered
  // input) unchanged, which is exactly the case `bestFirst` exists to guard:
  // a "no synthesis needed" source is the MOST common case (most sources
  // already have 4+ native tiers) and was also the one path this function
  // never touched the ordering on at all.
  const videos = bestFirst(formats.filter((f) => f.kind === "video"));
  const nonVideo = formats.filter((f) => f.kind !== "video");
  const sorted = [...videos, ...nonVideo];
  if (videos.length >= MAX_VIDEO_TIERS || videos.length === 0) return sorted;

  // Prefer a known-H.264 source: the downscale has to DECODE it, and an
  // H.264 stream decodes on every ffmpeg build, while e.g. TikTok's HD
  // stream is bytevc1/H.265 (the tier that used to take every synthesized
  // tier down with it when decoding failed).
  const source = videos.find((f) => !!f.directUrl && f.vcodec === "h264") ?? videos.find((f) => !!f.directUrl);
  if (!source) return sorted;

  const sourceHeight = heightOf(source);
  /*
    🔴 UNKNOWN HEIGHT MEANS "DON'T SYNTHESIZE", NOT "SYNTHESIZE ANYTHING"
    (owner, 2026-08-16: "Facebook, reels, story and post don't Download in
    high quality").

    The loop below only excludes a tier when `sourceHeight != null && tier >=
    sourceHeight` — when `sourceHeight` IS null (true of every Facebook
    format; `server/extractors/facebook.ts`'s `fmt()` always sets
    `resolution: null` because the regex-extracted direct URL never carries
    real dimensions), that guard is a no-op and every tier up to
    `MAX_VIDEO_TIERS` gets synthesized regardless of what the source
    actually is. Since `transcodeMaxHeight` never scales UP
    (server/services/download-service.ts), picking a synthesized "1080p" off
    a source that's really 480p silently delivers 480p pixels under a
    1080p label — the exact "not high quality" symptom, just relabeled. A
    source we cannot measure is a source we cannot safely claim is ABOVE any
    tier, so none get synthesized for it; the real, unlabeled format(s) ship
    as-is instead of an invented ladder.
  */
  if (sourceHeight == null) return sorted;
  const existingHeights = new Set(videos.map(heightOf).filter((h): h is number => h != null));

  const synthesized: MediaFormat[] = [];
  for (const tier of LADDER_TIERS) {
    if (videos.length + synthesized.length >= MAX_VIDEO_TIERS) break;
    if (tier >= sourceHeight) continue; // only strictly lower — sourceHeight is non-null past the early return above
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
  if (synthesized.length === 0) return sorted;

  return [...videos, ...synthesized, ...nonVideo];
}
