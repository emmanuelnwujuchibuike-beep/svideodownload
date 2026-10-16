import { MARK_INSET, MARK_SHARE, WATERMARK_CORNER_SECONDS, WATERMARK_CORNERS } from "@/lib/media/watermark-mark-geometry";

/** A video's size AS DISPLAYED — a phone clip stored landscape with a 90° rotation is portrait. */
export function displayedSize(probe: { width?: number; height?: number; rotation?: number | null }): { width: number; height: number } | null {
  const w = Number(probe.width);
  const h = Number(probe.height);
  if (!(w > 0 && h > 0)) return null;
  const quarter = Math.abs(Math.round(Number(probe.rotation ?? 0))) % 180 === 90;
  return quarter ? { width: h, height: w } : { width: w, height: h };
}

/**
 * The watermarked file's ceiling (owner, 2026-10-15: "downloading with watermark
 * shouldn't reduce quality below 720p if the media original quality is higher, if
 * is 720p it shouldn't reduce any, same for 480p"). The SHORTER side is capped at
 * this: a 1080p clip comes out 720p, a 720p or 480p clip keeps its own size and is
 * never scaled up. Encoding at most 720p is also most of the speed-up — a 1080p
 * frame is 2.25 times the pixels.
 */
export const WATERMARK_MAX_SHORT_SIDE = 720;

/** The size the watermarked video is encoded at: the source's, or scaled down so its shorter side is 720. Even, as x264 needs. */
export function outputSize(size: { width: number; height: number }): { width: number; height: number; scaled: boolean } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const short = Math.min(size.width, size.height);
  if (short <= WATERMARK_MAX_SHORT_SIDE) {
    const w = even(size.width);
    const h = even(size.height);
    return { width: w, height: h, scaled: w !== size.width || h !== size.height };
  }
  const k = WATERMARK_MAX_SHORT_SIDE / short;
  return { width: even(size.width * k), height: even(size.height * k), scaled: true };
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
 *
 * The frame is encoded at `outputSize`: never above 720p on its shorter side,
 * never scaled up, never below the source when the source is 720p or less.
 */
export function buildWatermarkArgs(input: string, mark: string, output: string, size: { width: number; height: number }): string[] {
  const out = outputSize(size);
  // the mark is placed on the frame as ENCODED, so a 1080p source scaled to 720p carries the same-looking mark
  const p = markPlacement(out);
  const k = `mod(floor(t/${WATERMARK_CORNER_SECONDS}),${WATERMARK_CORNERS.length})`;
  // index 0–1 left, 2–3 right; even bottom, odd top (the order in watermark-mark-geometry.ts)
  const x = `if(lt(${k},2),${p.x},main_w-overlay_w-${p.x})`;
  const y = `if(eq(mod(${k},2),0),main_h-overlay_h-${p.inset},${p.inset})`;
  // a source over 720p is scaled down first (lanczos keeps it sharp); 720p and below are left as they are
  const base = out.scaled ? `[0:v]scale=${out.width}:${out.height}:flags=lanczos[base];` : "";
  const filter = `${base}[1:v]scale=${p.width}:-2[wm];[${out.scaled ? "base" : "0:v"}][wm]overlay=x='${x}':y='${y}'[v]`;
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", input,
    "-i", mark,
    "-filter_complex", filter,
    "-map", "[v]", "-map", "0:a?",
    /*
      veryfast, not superfast (measured 2026-10-15 on a 20 s clip, owner: "taking too long"):
      superfast encoded a 1080p source ~10% faster but made a file 2.6 times bigger, which the
      phone then waits longer to download. The speed-up is the 720p ceiling: 1080p → 720p took
      15.1 s and 4.9 MB, against 20.1 s and 15.8 MB before. crf 21 and the audio are unchanged.
    */
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-threads", "0",
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart",
    output,
  ];
}
