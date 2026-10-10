/**
 * The ad-video transcode the WORKER runs when Cloudflare Stream cannot take a
 * video (owner, 2026-10-10: Stream storage full — "a 1080px video must be
 * compressed to 480 for smaller size and faster performance").
 *
 *   · the SHORT edge is brought down to 480 px (a 1920 × 1080 video becomes
 *     854 × 480, a 1080 × 1920 one 480 × 854); a smaller video keeps its size —
 *     never upscaled
 *   · the ratio is kept exactly (the other edge follows, rounded to even), so
 *     nothing is cropped or stretched — the card takes the video's own shape
 *   · H.264 + AAC in MP4 with the index up front (+faststart): every browser
 *     plays it and it starts before the whole file has arrived
 *   · rotation metadata is applied by ffmpeg before scaling, so a phone's
 *     portrait video stays portrait
 *
 * The argument list is built from constants and two paths this module is given;
 * nothing from the advertiser (names, text, codecs) ever reaches ffmpeg.
 */

export const AD_FALLBACK_SHORT_EDGE = 480;

/** Even-sized, ratio-kept, never upscaled: the short edge becomes min(480, itself). */
export const AD_SCALE_FILTER =
  `scale=w='if(gt(iw,ih),-2,min(${AD_FALLBACK_SHORT_EDGE},iw))':h='if(gt(iw,ih),min(${AD_FALLBACK_SHORT_EDGE},ih),-2)'`;

/** The size a w × h video comes out at (the same rule as AD_SCALE_FILTER, for tests and the UI). */
export function adFallbackSize(w: number, h: number): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (w > h) {
    const outH = Math.min(AD_FALLBACK_SHORT_EDGE, h);
    return { width: even((w * outH) / h), height: outH };
  }
  const outW = Math.min(AD_FALLBACK_SHORT_EDGE, w);
  return { width: outW, height: even((h * outW) / w) };
}

export function buildAdTranscodeArgs(input: string, output: string): string[] {
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", AD_SCALE_FILTER,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k", "-ac", "2",
    "-map_metadata", "-1",
    "-movflags", "+faststart",
    output,
  ];
}
