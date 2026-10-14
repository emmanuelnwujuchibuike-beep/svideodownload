import { MARK_INSET, MARK_SHARE } from "@/lib/media/watermark-mark-geometry";

/** A video's size AS DISPLAYED — a phone clip stored landscape with a 90° rotation is portrait. */
export function displayedSize(probe: { width?: number; height?: number; rotation?: number | null }): { width: number; height: number } | null {
  const w = Number(probe.width);
  const h = Number(probe.height);
  if (!(w > 0 && h > 0)) return null;
  const quarter = Math.abs(Math.round(Number(probe.rotation ?? 0))) % 180 === 90;
  return quarter ? { width: h, height: w } : { width: w, height: h };
}

/** Where the mark goes on a frame of this displayed size — the browser's photo stamp uses the same numbers. */
export function markPlacement(size: { width: number; height: number }): { width: number; x: number; inset: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return {
    width: even(Math.min(size.width, size.height) * MARK_SHARE),
    x: Math.round(size.width * MARK_INSET),
    inset: Math.round(size.height * MARK_INSET),
  };
}

/**
 * The ffmpeg arguments that burn the mark into a video. Pure, so the filter is
 * testable without ffmpeg.
 *
 * The mark is scaled to an exact pixel width computed from the DISPLAYED size
 * (ffprobe, see watermark-service.ts) and overlaid bottom-left — the same
 * geometry the browser uses on photos (lib/media/watermark-image.ts). ffmpeg's
 * autorotate runs before the filter, so the overlay lands on the upright frame.
 *
 * 🔴 Plain `scale` + `overlay`, not `scale2ref` (2026-10-14): what scale2ref's
 * `main_w`/`iw` name differs between ffmpeg versions (measured on 6.1: the mark
 * came out 100 px wide and squeezed), and the worker image ships 5.1. Exact
 * pixels mean the same result on every version. Audio is optional (`0:a?`).
 */
export function buildWatermarkArgs(input: string, mark: string, output: string, size: { width: number; height: number }): string[] {
  const p = markPlacement(size);
  const filter = `[1:v]scale=${p.width}:-2[wm];[0:v][wm]overlay=x=${p.x}:y=main_h-overlay_h-${p.inset}[v]`;
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", input,
    "-i", mark,
    "-filter_complex", filter,
    "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart",
    output,
  ];
}
