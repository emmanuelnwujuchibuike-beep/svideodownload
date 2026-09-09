/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI CLEAN — exactly what ffmpeg is asked to do, decided without touching it
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The argument list, the codec decision and the "is this a real video" rules,
 * as pure functions.
 *
 * ── 🔴 WHY THIS IS A SEPARATE FILE ───────────────────────────────────────────
 *
 * The argument array IS the security property of the finalizer. "No user input
 * reaches ffmpeg" is a claim, and a claim that cannot be tested is a hope — so
 * the construction lives here, away from the service's child processes,
 * filesystem and database imports, where a test can assert the exact array for
 * every branch. A test that only checked the output file would not notice one
 * of these arguments quietly becoming interpolated.
 *
 * Nothing in this file spawns, reads or writes anything.
 */

export interface MediaProbe {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  /**
   * Frames per second, from ffprobe’s `r_frame_rate` ("30/1").
   *
   * 🔴 Needed because ProPainter’s `save_fps` DEFAULTS TO 24: handing it a
   * 30fps video without this silently resamples the whole thing and changes its
   * duration. Null when ffprobe did not report a usable rate.
   */
  frameRate: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  formatName: string | null;
  bytes: number | null;
}

/**
 * Codecs MP4 can carry as-is.
 *
 * The point of asking: `-c:v copy` moves the AI's picture into the new
 * container untouched — no generation loss, and seconds of CPU instead of
 * minutes. Re-encoding a video that did not need it is the most expensive
 * mistake this pipeline could make, and on a mobile connection it also makes
 * the file bigger for nothing.
 */
export const MP4_SAFE_VIDEO_CODECS: readonly string[] = ["h264", "hevc", "h265", "av1", "mpeg4"];

export function canStreamCopy(videoCodec: string | null): boolean {
  return !!videoCodec && MP4_SAFE_VIDEO_CODECS.includes(videoCodec.toLowerCase());
}

export interface RestorePlan {
  /** Input 0 — the AI's cleaned picture. */
  cleanedPath: string;
  /** Input 1 — the member's original, for its sound. */
  sourcePath: string;
  outPath: string;
  /** From ffprobe on the SOURCE. False means there is no audio to restore. */
  hasAudio: boolean;
  /** From ffprobe on the CLEANED file. False forces a re-encode. */
  canCopyVideo: boolean;
}

/**
 * The complete argument list.
 *
 * 🔴 Every element is either a constant chosen here or one of three paths the
 * server built from `tmpdir()` and a job id. There is no parameter for a codec,
 * a filter, a flag or a filename, so there is no path by which a member could
 * supply one — which is a stronger guarantee than sanitising an input would be.
 * It is handed to `spawn` as an ARRAY: no shell, no word splitting, no quoting
 * to get wrong.
 */
export function buildRestoreArgs(plan: RestorePlan): string[] {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    // A worker has no terminal. An ffmpeg that stops to ask a question is an
    // ffmpeg that hangs until a timeout kills it.
    "-nostdin",
    "-y",
    "-i",
    plan.cleanedPath,
  ];

  // The original is opened ONLY when it has sound worth taking — otherwise
  // ffmpeg would index a second large file for nothing.
  if (plan.hasAudio) args.push("-i", plan.sourcePath);

  args.push("-map", "0:v:0");
  if (plan.hasAudio) {
    // `?` keeps it optional even here: an audio stream ffprobe saw but ffmpeg
    // cannot map should still produce a silent video, not a failed job.
    args.push("-map", "1:a:0?");
  }

  if (plan.canCopyVideo) {
    args.push("-c:v", "copy");
  } else {
    // The controlled fallback. Fixed, conservative, and never derived from
    // anything that arrived in a request.
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p");
  }

  if (plan.hasAudio) {
    args.push("-c:a", "aac", "-b:a", "128k");
    // Ends with whichever stream runs out first, so a cleaned video slightly
    // shorter than its source does not finish on a frozen frame with a second
    // of sound playing over nothing.
    args.push("-shortest");
  } else {
    args.push("-an");
  }

  // Index at the front, so playback can start before the whole file arrives —
  // on the owner's target networks that is the difference between a video that
  // plays and one that spins.
  args.push("-movflags", "+faststart", plan.outPath);
  return args;
}

/** ffprobe's JSON, turned into the handful of facts this pipeline uses. */
export function parseProbeOutput(raw: string): MediaProbe | null {
  let parsed: {
    streams?: {
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      avg_frame_rate?: string;
    }[];
    format?: { duration?: string; format_name?: string; size?: string };
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  const duration = Number(parsed.format?.duration);

  return {
    // A duration of 0 or NaN is "not measured", never a zero-length video.
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    videoCodec: video?.codec_name?.toLowerCase() ?? null,
    audioCodec: audio?.codec_name?.toLowerCase() ?? null,
    frameRate: parseFrameRate(video?.r_frame_rate) ?? parseFrameRate(video?.avg_frame_rate),
    hasAudio: !!audio,
    hasVideo: !!video,
    formatName: parsed.format?.format_name ?? null,
    bytes: Number(parsed.format?.size) || null,
  };
}

/**
 * ffprobe reports a rate as a RATIO string, "30/1" or "30000/1001".
 *
 * Parsed rather than eval-ed, and rejected unless it lands in a range a real
 * video could have — a 0/0 from a malformed file must read as "unknown" so the
 * caller falls back to a safe default, not as 0fps.
 */
function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null;
  const [numerator, denominator] = value.split("/");
  const n = Number(numerator);
  const d = denominator === undefined ? 1 : Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  const fps = n / d;
  return fps > 0 && fps <= 480 ? fps : null;
}

/**
 * How far the final duration may sit from what went in.
 *
 * `-shortest` legitimately trims to the shorter input and container durations
 * are rounded, so an exact match is the wrong test. Two seconds catches the
 * failure that matters — a mux that produced a fragment — without failing jobs
 * over arithmetic.
 */
export const DURATION_TOLERANCE_SECONDS = 2;

export interface FinalExpectations {
  /** True when the SOURCE had audio, so the result must have it too. */
  expectAudio: boolean;
  /** The shorter of the two inputs — what `-shortest` should have produced. */
  expectedDurationSeconds: number | null;
}

export type FinalVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Is this a video we are willing to call finished?
 *
 * Judged before the upload and before the job is marked completed, because
 * "completed" is a promise. The audio check is the whole point of this stage: a
 * silent result on a source that had sound is a failure, not a variation.
 */
export function checkFinalProbe(probe: MediaProbe | null, expectations: FinalExpectations): FinalVerdict {
  if (!probe) return { ok: false, reason: "the final file could not be read back" };
  if (!probe.hasVideo) return { ok: false, reason: "the final file has no video stream" };
  if (!probe.durationSeconds) return { ok: false, reason: "the final file has no readable duration" };

  if (expectations.expectAudio && !probe.hasAudio) {
    return { ok: false, reason: "the original audio did not make it onto the final video" };
  }

  if (expectations.expectedDurationSeconds) {
    const drift = Math.abs(probe.durationSeconds - expectations.expectedDurationSeconds);
    if (drift > DURATION_TOLERANCE_SECONDS) {
      return {
        ok: false,
        reason: `the final video is ${probe.durationSeconds.toFixed(1)}s against an expected ${expectations.expectedDurationSeconds.toFixed(1)}s`,
      };
    }
  }

  return { ok: true };
}

/**
 * What `-shortest` should have produced, given both inputs.
 *
 * Only the cleaned file's length matters when there is no audio, because the
 * source is never opened in that case.
 */
export function expectedFinalDuration(opts: {
  hasAudio: boolean;
  sourceDuration: number | null;
  cleanedDuration: number | null;
}): number | null {
  if (!opts.hasAudio) return opts.cleanedDuration;
  if (opts.sourceDuration && opts.cleanedDuration) return Math.min(opts.sourceDuration, opts.cleanedDuration);
  return opts.cleanedDuration ?? opts.sourceDuration;
}

/* ──────────────────────── the text mask, for ProPainter ───────────────────── */

export interface MaskPlan {
  /** The member's original. */
  sourcePath: string;
  /** hjunior29's `black` output — the detector's answer, as painted rectangles. */
  blackPath: string;
  outPath: string;
  /** Source frame rate, so the mask has one frame per source frame. */
  fps: number;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  RECOVERING THE DETECTOR'S MASK WITHOUT A SECOND DETECTOR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * hjunior29 never exposes its mask. But in `black` mode it fills every detected
 * caption region with pure black, so the mask falls straight out of a
 * comparison — and this needs nothing but ffmpeg, which the worker already has.
 *
 *     A < 16    the model painted here
 *     B > 16    and the source was NOT itself black
 *
 * 🔴 The second half is not a nicety. This video is letterboxed: the bars top
 * and bottom are black in BOTH inputs, and without `B > 16` they would be
 * masked and handed to ProPainter to "reconstruct" — a quarter of the frame
 * repainted for nothing. Verified by counting white pixels per frame: 12.7–13.1%
 * with the guard, and the whole frame without it.
 *
 * ── 🔴 AN OPENING, THEN A REAL CLOSING (fixed 2026-09-09) ───────────────────
 *
 * `erosion ×2, dilation ×6` was an OPENING with a net growth of four, and the
 * comment above it claimed the dilations "close the holes". They cannot. An
 * opening removes speckle; only a CLOSING — dilate first, erode after — fills a
 * hole, and a dilation applied after an erosion of the same region just returns
 * the boundary to where it started.
 *
 * It matters because `B > 16` punches holes in exactly the wrong place. Every
 * pixel the detector marked as text but which was DARK in the original is
 * vetoed: a caption on a dark pill, a black outline, white text on a black bar.
 * Those are the pixels most in need of repainting, and they were the ones
 * marked "keep".
 *
 * Measured on the owner's own clip, against the real detector output, counting
 * how much of what the detector painted the finished mask actually covers:
 *
 *     erosion×2, dilation×6      12.1% of the detected text MISSED   box 248x96
 *     erosion×2, dilation×20, erosion×14   0.7% missed               box 244x92
 *
 * Seventeen times less text left behind, in a mask that is SMALLER rather than
 * inflated — the closing fills the interior without pushing the boundary out.
 * That residue was visible: a ProPainter run on the old mask reconstructed the
 * background correctly and left the caption's dark pill and glyph cores
 * standing, because it had been told to preserve them.
 *
 *   erosion ×2     drops the speckle compression noise leaves scattered
 *                  outside the caption box (the opening);
 *   dilation ×20   seals holes up to ~40px across — wide enough for a whole
 *                  caption pill, not just a glyph stroke;
 *   erosion ×14    puts the outer boundary back. Net growth is +4, the same as
 *                  before, so edge coverage of the glyph anti-aliasing is
 *                  unchanged; only the interior differs.
 *
 * Growing the box by a few pixels costs a temporal inpainter nothing, because it
 * has real information from other frames — exactly the trade the classical model
 * could not make.
 *
 * ⚠️ Encoded LOSSLESS (`-qp 0`). A lossy encode would blur the hard threshold
 * we just computed and hand ProPainter a grey, ambiguous mask.
 */
/** erosion ×2, dilation ×20, erosion ×14 — see the note above for the numbers. */
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 THE DETECTOR GIVES A RECTANGLE. THE MASK MUST NOT BE ONE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09, on a video whose caption came back as a full-width smear:
 * "instead of naturally reconstructing the background after removing the text,
 * the removed region becomes blurry, smeared, stretched, or visibly distorted."
 *
 * Measured on that exact video (720x1280, 286 frames, 3 lines of caption):
 *
 *     detector rectangle, as shipped     12.70% of the frame   117,006 px
 *     glyph-refined mask                  8.07% of the frame    74,411 px
 *
 * hjunior29 in `black` mode does not paint the letters — it paints a SOLID
 * 588x200 BLOCK over the whole caption. Using that block as the mask asks
 * ProPainter to invent an eighth of the picture, and a flow-based inpainter
 * given a region that large with no clean source frames produces exactly the
 * woven, stretched band the owner photographed.
 *
 * ── How the letters are recovered without a second model ────────────────────
 *
 * The rectangle is kept, but only as a REGION OF INTEREST. Inside it the
 * caption is high-contrast by construction — social captions are bright glyphs
 * with a dark outline or shadow, which is what makes them readable over any
 * footage. So the mask becomes:
 *
 *     (the detector painted here)  AND  (this pixel is very bright OR very dark)
 *
 * Everything mid-tone inside the rectangle is background, and it is now left
 * alone. Verified end to end: ProPainter with the refined mask reconstructed
 * the arms, chair, floor and crowd cleanly where the rectangle mask had smeared
 * them.
 *
 * ⚠️ It is a HEURISTIC, and it can fail — a caption in a mid-grey, or coloured
 * text with no outline, segments to almost nothing. That is why the caller
 * measures the result and falls back to the rectangle when the refined mask is
 * implausibly sparse (`MASK_REFINE_MIN_RATIO`). Removing nothing is a worse
 * failure than removing too much.
 */
const MASK_BRIGHT = 200;
const MASK_DARK = 40;

/**
 * How much of the rectangle the refined mask must still cover to be trusted.
 *
 * 🔴 A floor, not a target. Below this the segmentation has plainly failed —
 * the caption was not bright-on-dark — and the rectangle is used instead. Set
 * from the measured case: a working refinement covered 64% of the rectangle
 * (74,411 of 117,006), so 20% is far below anything healthy and far above the
 * near-zero a failure produces.
 */
export const MASK_REFINE_MIN_RATIO = 0.2;

/** Grown a little after segmentation, to swallow the glyphs' antialiased edge. */
const MASK_REFINE_GROW = 2;

const MASK_MORPHOLOGY = [
  ...Array(2).fill("erosion"),
  ...Array(20).fill("dilation"),
  ...Array(14).fill("erosion"),
].join(",");

/**
 * Put a reconstruction back to the exact size of the source.
 *
 * ── 🔴 PROPAINTER DOES NOT RETURN THE SIZE IT WAS GIVEN ─────────────────────
 *
 * Measured 2026-09-09 on a real run: a 480×854 source came back **480×864**,
 * with `resize_ratio: 1`, `width: -1` and `height: -1` — the settings that are
 * supposed to mean "leave it alone". ProPainter rounds each dimension up to a
 * multiple of 8 for its own network, and returns it at that size.
 *
 * And it is a STRETCH, not padding. The ten extra rows carry real picture
 * (mean luma 73, continuous with the rows above) rather than black bars, so the
 * whole frame is scaled by 864/854 — a 1.2% vertical elongation of somebody's
 * video, silently.
 *
 * Nothing downstream noticed, because the mux stream-copies whatever it is
 * handed and `checkFinalProbe` compares duration and codecs rather than
 * dimensions. So this scales it back before anything else touches it.
 *
 * ⚠️ Re-encode, necessarily — a scale cannot be a stream copy. `-crf 16` is
 * visually lossless at this size, and it is one generation on a file that has
 * already been through the model.
 */
export function buildResizeToSourceArgs(plan: {
  inPath: string;
  outPath: string;
  width: number;
  height: number;
  fps: number;
}): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-i",
    plan.inPath,
    "-vf",
    // `flags=lanczos` because this is undoing a small upscale: a bilinear pass
    // back down would soften the reconstruction the model just produced.
    `scale=${plan.width}:${plan.height}:flags=lanczos`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(plan.fps),
    "-an",
    plan.outPath,
  ];
}
/** The detector's rectangle: painted black, and not black in the source. */
const MASK_RECT_CHAIN =
  "[1]format=gray[a];[0]format=gray[b];" +
  `[a][b]blend=all_expr='if(lt(A,16)*gt(B,16),255,0)',${MASK_MORPHOLOGY}`;

/**
 * The mask ProPainter is given.
 *
 * `refine: false` produces the plain rectangle — what shipped before, and what
 * the caller falls back to when segmentation fails. `refine: true` (the
 * default) keeps only the high-contrast glyph pixels inside that rectangle.
 *
 * ⚠️ Encoded LOSSLESS (`-qp 0`). A lossy encode blurs the hard threshold this
 * graph just computed and hands ProPainter a grey, ambiguous mask.
 */
export function buildTextMaskArgs(plan: MaskPlan & { refine?: boolean }): string[] {
  const refine = plan.refine !== false;

  const filter = refine
    ? `${MASK_RECT_CHAIN}[rect];` +
      // Very bright OR very dark, anywhere in the frame. `+` is a sum, and
      // `if()` treats any non-zero as true, so this is an OR.
      `[0]format=gray,geq=lum='if(gt(p(X\\,Y)\\,${MASK_BRIGHT})+lt(p(X\\,Y)\\,${MASK_DARK})\\,255\\,0)'[glyph];` +
      // AND with the rectangle, so contrast elsewhere in the picture — a white
      // shirt, a dark doorway — can never enter the mask.
      `[rect][glyph]blend=all_expr='if(gt(A,127)*gt(B,127),255,0)',` +
      `${Array(MASK_REFINE_GROW).fill("dilation").join(",")},format=yuv420p`
    : `${MASK_RECT_CHAIN},format=yuv420p`;

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-i",
    plan.sourcePath,
    "-i",
    plan.blackPath,
    "-filter_complex",
    filter,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-qp",
    "0",
    "-r",
    String(plan.fps),
    plan.outPath,
  ];
}

/**
 * Measure how much of the frame a finished mask actually covers.
 *
 * 🔴 This is what makes the refinement safe to ship. The segmentation is a
 * heuristic about how social captions are drawn, and a caption it cannot see
 * would otherwise produce an almost-empty mask and a video with the text still
 * in it — a silent, total failure of the feature.
 *
 * The mask is binary, so mean luminance IS the coverage fraction: YAVG/255.
 * One cheap pass over a lossless grayscale video, on a machine that has just
 * written it.
 */
export function buildMaskCoverageArgs(maskPath: string): string[] {
  return [
    "-v",
    "error",
    "-f",
    "lavfi",
    // 🔴 The path is interpolated into a lavfi graph, where `:` and `\` are
    // syntax. It is always a temp path this codebase built from `tmpdir()` and
    // a uuid, never anything a member supplied — but it is escaped anyway,
    // because the day that stops being true is not the day to discover it.
    `movie=${maskPath.replace(/\\/g, "/").replace(/:/g, "\\:")},signalstats`,
    "-show_entries",
    "frame_tags=lavfi.signalstats.YAVG",
    "-of",
    "csv=p=0",
  ];
}

/**
 * Mean coverage, 0-1, from `buildMaskCoverageArgs` output. Pure, so the parsing
 * is testable without ffprobe.
 *
 * Returns null when nothing usable came back — the caller must treat that as
 * "unknown", never as "empty", or an ffprobe hiccup would discard a good mask.
 */
export function parseMaskCoverage(raw: string): number | null {
  const values = raw
    .split(/\r?\n/)
    .map((line) => Number.parseFloat(line.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 255);
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return mean / 255;
}
