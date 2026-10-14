import { MARK_INSET, MARK_SHARE, WATERMARK_CORNER_SECONDS, WATERMARK_CORNERS } from "@/lib/media/watermark-mark-geometry";

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
 * (ffprobe, see watermark-service.ts). It starts bottom-left — where the
 * browser puts it on photos (lib/media/watermark-image.ts) — and moves to the
 * next of WATERMARK_CORNERS every WATERMARK_CORNER_SECONDS: bottom-left,
 * top-left, bottom-right, top-right, again. `overlay` re-evaluates x/y per
 * frame by default, so `t` (the frame's time) drives the move. ffmpeg's
 * autorotate runs before the filter, so the overlay lands on the upright frame.
 *
 * 🔴 Plain `scale` + `overlay`, not `scale2ref` (2026-10-14): what scale2ref's
 * `main_w`/`iw` name differs between ffmpeg versions (measured on 6.1: the mark
 * came out 100 px wide and squeezed), and the worker image ships 5.1. Exact
 * pixels mean the same result on every version. Audio is optional (`0:a?`).
 */
export function buildWatermarkArgs(input: string, mark: string, output: string, size: { width: number; height: number }): string[] {
  const p = markPlacement(size);
  const k = `mod(floor(t/${WATERMARK_CORNER_SECONDS}),${WATERMARK_CORNERS.length})`;
  // index 0–1 left, 2–3 right; even bottom, odd top (the order in watermark-mark-geometry.ts)
  const x = `if(lt(${k},2),${p.x},main_w-overlay_w-${p.x})`;
  const y = `if(eq(mod(${k},2),0),main_h-overlay_h-${p.inset},${p.inset})`;
  const filter = `[1:v]scale=${p.width}:-2[wm];[0:v][wm]overlay=x='${x}':y='${y}'[v]`;
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
