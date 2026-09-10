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
  /**
   * The source frame size, used only to scale how far the glyph mask is grown.
   *
   * 🔴 A caption's anti-aliased halo is a fraction of the text's size, and the
   * text is a fraction of the frame — so a fixed dilation count covers it at
   * one resolution and leaves a visible ghost at another. See `maskRefineGrow`.
   * Null is safe: it falls back to the value that was correct at 480p.
   */
  width?: number | null;
  height?: number | null;
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 THE GLYPH HALO — why the removed text came back as a grey ghost
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09, on a 1080x1920 clip: "the text still looks transparent and
 * showing and it glitches by the sides."
 *
 * The refinement keeps pixels that are very bright or very dark, which is the
 * glyph CORE. What it does not keep is the ring of mid-tone pixels around every
 * letter — the anti-aliasing the renderer drew to make the edge smooth, plus
 * whatever shadow or outline the caption carries. Those are, by definition,
 * neither bright nor dark.
 *
 * So ProPainter is handed a mask of letter-shaped holes with their outlines
 * still in the picture, faithfully reconstructs the holes, and the outlines
 * survive. A caption's anti-aliased edge IS a legible, letter-shaped shape —
 * which is exactly what "transparent and showing" describes.
 *
 * ── 🔴 TWO DILATIONS IS A FIXED NUMBER AGAINST A SCALING PROBLEM ────────────
 *
 * A halo is a fraction of the text's own size, and text is a fraction of the
 * frame. At 480x854 two pixels covered it. At 1080x1920 the same caption is
 * 2.25x larger and its halo is 2.25x wider, while the mask still grew by two —
 * so the taller the video, the more of the outline survives. The owner's
 * earlier 480p clips looked better for precisely this reason, which is why
 * "it was much better before" is a real observation about a real regression
 * rather than a preference.
 *
 * Scaling with the frame's short edge fixes it at every size, and it is cheap
 * in the direction that matters: a temporal inpainter given a few more pixels
 * has more context, not less. Over-growing costs a slightly larger repaired
 * region; under-growing costs a visible ghost of the text we were paid to
 * remove.
 *
 * Baselined on the size that was already correct — 2 dilations at a 480px short
 * edge — so a 1080p clip grows by 5 (2.25x rounds up from 4.5, which is the
 * safe direction for a halo) and a 720p one by 3.
 */
const MASK_REFINE_GROW_BASE = 2;
const MASK_REFINE_GROW_REFERENCE_EDGE = 480;
/** Never below the value that worked at 480p, never wide enough to smear. */
const MASK_REFINE_GROW_MAX = 8;

export function maskRefineGrow(width: number | null | undefined, height: number | null | undefined): number {
  const shortEdge = Math.min(width || 0, height || 0);
  /*
    🔴 An unknown size gets the BASELINE, not the maximum. A probe that failed
    to read dimensions is not evidence the video is large, and growing every
    unmeasurable clip to the ceiling would repaint more of somebody's picture
    than the text needed — silently, and on exactly the jobs we know least
    about.
  */
  if (!Number.isFinite(shortEdge) || shortEdge <= 0) return MASK_REFINE_GROW_BASE;
  const scaled = Math.round((shortEdge / MASK_REFINE_GROW_REFERENCE_EDGE) * MASK_REFINE_GROW_BASE);
  return Math.max(MASK_REFINE_GROW_BASE, Math.min(MASK_REFINE_GROW_MAX, scaled));
}

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
/**
 * The detector's rectangle: painted black, and not black in the source.
 *
 * ── 🔴 TWO MORPHOLOGIES, BECAUSE THE RECTANGLE HAS TWO JOBS ────────────────
 *
 * As the FALLBACK it IS the mask, so its holes are surviving text and the full
 * closing (36 chained ops) has to run.
 *
 * As a REGION OF INTEREST for the refined mask it is neither — the glyph
 * segmentation re-derives the shape inside it, so a hole in the ROI changes
 * nothing about the result. Running 36 morphology passes per frame to produce
 * a boundary that is then intersected away is pure cost, and it is charged on
 * a shared worker CPU at 720x1280 x 286 frames.
 *
 * So the ROI gets the light chain (8 ops) and the fallback keeps the heavy one.
 */
const MASK_ROI_MORPHOLOGY = [
  ...Array(2).fill("erosion"),
  ...Array(6).fill("dilation"),
].join(",");

const maskRectChain = (morphology: string) =>
  "[1]format=gray[a];[0]format=gray[b];" +
  `[a][b]blend=all_expr='if(lt(A,16)*gt(B,16),255,0)',${morphology}`;

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
export function buildTextMaskArgs(
  plan: MaskPlan & {
    refine?: boolean;
    statsPath?: string;
    /**
     * ── 🔴 WHAT THE PRIMARY DETECTOR MISSED (2026-09-09) ──────────────────
     *
     * Boxes from `datalab-to/ocr`, unioned into this mask.
     *
     * Owner: "It not accurate, some parts shows and glitches." hjunior29
     * removed a caption and left "Bus" and 'S"' standing at either end of it,
     * at three confidence thresholds — a capability limit, not a tuning knob.
     * Surya returned both, with pixel-accurate boxes, from the same frame.
     *
     * They are ADDED to the derived mask rather than replacing it, which is
     * what keeps this a mask change rather than a pipeline change: hjunior29's
     * webhook still drives the job, and an empty list leaves the graph byte-
     * for-byte what it was.
     *
     * ⚠️ Appended AFTER the morphology and AFTER the glyph refinement, and
     * that order is load-bearing. The refinement exists to shrink the primary
     * detector's over-large rectangle down to its glyphs; running it over
     * these boxes too would eat them, because a box drawn in flat white has no
     * bright/dark contrast inside it to segment.
     */
    extraBoxes?: readonly { x: number; y: number; w: number; h: number }[];
  },
): string[] {
  const refine = plan.refine !== false;

  /*
    🔴 The halo grows with the frame — see `maskRefineGrow`. A fixed 2 was
    enough at 480p and left a visible ghost of every letter at 1080p, which is
    what "the text still looks transparent" was.
  */
  const grow = maskRefineGrow(plan.width, plan.height);

  const base = refine
    ? `${maskRectChain(MASK_ROI_MORPHOLOGY)}[rect];` +
      // Very bright OR very dark, anywhere in the frame. `+` is a sum, and
      // `if()` treats any non-zero as true, so this is an OR.
      `[0]format=gray,geq=lum='if(gt(p(X\\,Y)\\,${MASK_BRIGHT})+lt(p(X\\,Y)\\,${MASK_DARK})\\,255\\,0)'[glyph];` +
      // AND with the rectangle, so contrast elsewhere in the picture — a white
      // shirt, a dark doorway — can never enter the mask.
      `[rect][glyph]blend=all_expr='if(gt(A,127)*gt(B,127),255,0)',` +
      `${Array(grow).fill("dilation").join(",")},format=yuv420p`
    : `${maskRectChain(MASK_MORPHOLOGY)},format=yuv420p`;

  /*
    ── 🔴 COVERAGE IS MEASURED HERE, NOT IN A SECOND PASS ────────────────────

    Owner, 2026-09-09: "the time in my replicate dashboard of each video is
    lower than the time it actually takes, could it be it delays on our end?"

    It is. Measured on job eff96da5: 347s wall clock against 191s of ProPainter,
    so 156s — nearly half the wait — was work on our own machine. Four full
    passes over the video were the bulk of it, and one of them was this: the
    mask was written, and then `buildMaskCoverageArgs` DECODED THE WHOLE THING
    AGAIN just to average its luminance.

    `split` makes that free. The filter output is forked in two — one branch to
    the encoder, one to `signalstats` writing per-frame `YAVG` to a file — and
    ffmpeg decodes, thresholds and morphs each frame exactly once for both. The
    stats branch is muxed to `-f null`, so nothing is written twice.

    The second pass is not deleted, because it is still the only way to measure
    a mask this function did not just build (the rectangle fallback re-runs this
    with `refine: false`, and a diagnostic can still ask about a file on disk).
    It is simply no longer on the path every job takes.
  */
  /*
    The second detector's boxes, drawn in flat white on top of everything the
    graph has computed. `t=fill` because a mask is a solid region — an outlined
    box would ask the inpainter to repaint a frame around the text and leave the
    text itself, which is the shape of the bug this is fixing.

    🔴 The coordinates are integers this codebase computed from a provider
    response and clamped to the frame (`mergeBoxes`). They are interpolated into
    a filter string, so they are rounded here as well — a fractional value would
    be a syntax error in `drawbox`, discovered at the end of a job that has
    already been paid for.
  */
  const withBoxes = (plan.extraBoxes ?? []).length
    ? `${base},${(plan.extraBoxes ?? [])
        .map(
          (b) =>
            `drawbox=x=${Math.round(b.x)}:y=${Math.round(b.y)}:w=${Math.round(b.w)}:h=${Math.round(b.h)}:color=white@1:t=fill`,
        )
        .join(",")}`
    : base;

  const filter = plan.statsPath
    ? `${withBoxes},split=2[enc][stats];[stats]signalstats,metadata=print:file=${ffEscape(plan.statsPath)}[nul]`
    : withBoxes;

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
    ...(plan.statsPath ? ["-map", "[enc]"] : []),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-qp",
    "0",
    "-r",
    String(plan.fps),
    plan.outPath,
    /*
      The stats branch as a SECOND output, discarded. `metadata=print` writes
      the numbers as a side effect of frames flowing through it, so the branch
      still has to be pulled by a muxer — and `-f null -` is the muxer that
      encodes nothing at all.
    */
    ...(plan.statsPath ? ["-map", "[nul]", "-f", "null", "-"] : []),
  ];
}

/**
 * A path that is about to be interpolated into a filter argument.
 *
 * 🔴 In a filtergraph, `:` separates options and `\` escapes — so a Windows
 * path or any path with a colon would silently split one option into two. These
 * are always temp paths this codebase built from `tmpdir()` and a uuid, never
 * anything a member supplied, but the day that stops being true is not the day
 * to discover it.
 */
function ffEscape(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
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
  /*
    ── 🔴 TWO PRODUCERS, ONE PARSER ──────────────────────────────────────────

    The same number now arrives in two shapes, because it is measured in two
    places:

      · `metadata=print` (the fast path, folded into the mask build) writes
        alternating frame headers and `lavfi.signalstats.YAVG=32.4` lines;
      · `buildMaskCoverageArgs` (ffprobe, `csv=p=0`) writes one bare float per
        line.

    Keyed lines are looked for FIRST and, when any are found, the bare-float
    reader is not consulted at all — the `metadata=print` format also carries
    `frame:12 pts:12288 pts_time:0.512`, and a parser that fell through to
    "any float on the line" would average pts values into the coverage and
    report a mask several hundred times denser than it is. That is a failure
    that would pass the ratio guard and disable the fallback silently, which is
    the worst way for this particular number to be wrong.
  */
  const keyed = [...raw.matchAll(/YAVG=(-?\d+(?:\.\d+)?)/g)].map((m) => Number.parseFloat(m[1]!));
  const values = (keyed.length > 0
    ? keyed
    : raw.split(/\r?\n/).map((line) => Number.parseFloat(line.trim()))
  ).filter((n) => Number.isFinite(n) && n >= 0 && n <= 255);

  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return mean / 255;
}

/**
 * How wide the composite's seam ramp is, in pixels.
 *
 * ── 🔴 IT IS BOTH THE DILATION AND THE BLUR SIGMA ───────────────────────────
 *
 * One number drives both because they have to agree: the mask is grown by this
 * much so that the blur of this much lands entirely OUTSIDE the text. Split
 * into two constants they would drift, and the failure mode of a blur wider
 * than its dilation is the ghost coming back around every letter.
 *
 * 3px at a 480px short edge, scaling up — measured against the same baseline as
 * `maskRefineGrow`, so the feather and the glyph grow stay in proportion. The
 * ceiling matters: a very wide ramp starts mixing the reconstruction into
 * picture that never needed repairing, which is the opposite failure.
 */
const COMPOSITE_FEATHER_BASE = 3;
const COMPOSITE_FEATHER_MAX = 10;

export function maskCompositeFeather(
  width: number | null | undefined,
  height: number | null | undefined,
): number {
  const shortEdge = Math.min(width || 0, height || 0);
  if (!Number.isFinite(shortEdge) || shortEdge <= 0) return COMPOSITE_FEATHER_BASE;
  const scaled = Math.round((shortEdge / MASK_REFINE_GROW_REFERENCE_EDGE) * COMPOSITE_FEATHER_BASE);
  return Math.max(COMPOSITE_FEATHER_BASE, Math.min(COMPOSITE_FEATHER_MAX, scaled));
}

/* ─────────────────────── keeping the untouched picture ───────────────────── */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 ONLY THE REPAIRED REGION COMES FROM PROPAINTER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09, on a 1080x1920 clip: "It not accurate, some parts shows
 * and glitches… the current result is poor, look into it why it glitches."
 *
 * The job's own diagnostics said it outright:
 *
 *     propainter_resized = 480x848->1080x1920
 *     mask_coverage      = 8.2
 *
 * ── PROPAINTER DOWNSCALES ON ITS OWN, WHATEVER WE ASK ───────────────────────
 *
 * We sent `resize_ratio: 1, width: -1, height: -1` — "leave it alone" — and got
 * back 480x848 from a 1080x1920 source. The model clamps its working resolution
 * internally, and `resize_ratio` scales BEFORE that clamp rather than defeating
 * it. So the reconstruction is a 480p frame, and the resize-back step then blew
 * the whole picture up 2.25x.
 *
 * ── AND WE WERE SHIPPING THAT WHOLE FRAME ───────────────────────────────────
 *
 * That is the actual defect, and it is ours rather than the model's. The mask
 * covered 8.2% of the frame. The other 91.8% had nothing wrong with it — no
 * text, nothing to repair — and we replaced every pixel of it with a 480p
 * upscale anyway, because we took ProPainter's output as the picture instead of
 * as a patch.
 *
 * `maskedmerge` fixes it in one filter: the member's ORIGINAL pixels wherever
 * the mask is black, the reconstruction only where it is white. The 91.8% keeps
 * its full 1080p detail, and the repaired 8.2% is the best the inpainter could
 * do — which is exactly the trade this feature is supposed to make.
 *
 * It also explains the fragments the owner saw. Text that survived the mask was
 * being re-rendered from a 480p upscale, so a caption's edge came back as a
 * soft, smeared remnant rather than as itself. Now anything outside the mask is
 * untouched source, so a miss looks like the original text — a clean failure
 * instead of a glitch.
 *
 * ── 🔴 ALL THREE INPUTS MUST BE THE SAME SIZE ───────────────────────────────
 *
 * `maskedmerge` requires identical dimensions and pixel format across base,
 * overlay and mask. The reconstruction has already been scaled back to the
 * source's exact size by `buildResizeToSourceArgs`, and the mask was built at
 * source size — but the mask is scaled here anyway, explicitly, because a
 * silent size mismatch in this filter is an ffmpeg error at the very end of a
 * job that has already been paid for.
 *
 * The mask is forced to full-range gray and thresholded hard: `maskedmerge`
 * blends proportionally, and a mask softened by encoding would ghost the
 * original through the repair.
 */
export function buildMaskedCompositeArgs(plan: {
  /** The member's original — the base, and what most of the frame stays. */
  sourcePath: string;
  /** ProPainter's reconstruction, already at source dimensions. */
  reconstructedPath: string;
  /** The mask this job used. White is the region to take from the overlay. */
  maskPath: string;
  outPath: string;
  width: number;
  height: number;
  fps: number;
}): string[] {
  const size = `${plan.width}x${plan.height}`;
  /*
    🔴 The seam scales with the frame, exactly as the glyph halo does. A 3px
    ramp is a soft blend at 480p and a hairline at 1080p — and a hairline
    between a 480p-upscaled patch and a 1080p original is still a visible edge.
    Baselined on the same 480px short edge `maskRefineGrow` uses, so the two
    stay in proportion to each other and to the text.
  */
  const feather = maskCompositeFeather(plan.width, plan.height);
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-i",
    plan.sourcePath,
    "-i",
    plan.reconstructedPath,
    "-i",
    plan.maskPath,
    "-filter_complex",
    /*
      ══════════════════════════════════════════════════════════════════════════
       🔴 gbrp, NOT yuv420p. THIS LINE IS THE WHOLE BUG.
      ══════════════════════════════════════════════════════════════════════════

      Owner, 2026-09-09: "the text still shows through like a transparent Gray
      and the left and right edge glitches and show the text color fully."

      `maskedmerge` works PER PLANE. In yuv420p a mask built from grayscale has
      Y = 0 or 255 — correct — but its U and V planes are flat 128, because that
      is what "no colour" means in YUV. So the filter read 128 as a 50% blend
      and mixed the CHROMA of the original and the reconstruction, everywhere,
      across the entire frame.

      Measured, with a pure red base and a pure blue overlay under a half mask:

          yuv420p   left #6b006a   right #931292    (both wrong, murky)
          gbrp      left #0000fc   right #fc0000    (correct)

      That is exactly what the owner described. The caption's own colour was
      surviving at half strength — a grey ghost of the text — and every other
      colour in the picture was quietly wrong too.

      gbrp is planar RGB, so the mask's grey value lands identically in all
      three planes and each is merged with the same 0-or-255 decision. It also
      removes chroma subsampling from the merge entirely, which is the second
      half of the report: in 4:2:0 the mask edge could only be sharp to the
      nearest 2x2 chroma block, so the text's colour bled a pixel or two beyond
      the repair — "the left and right edge… show the text color fully".

      ⚠️ Converted back to yuv420p AFTER the merge, for the encoder. Never
      before it.
    */
    `[0:v]scale=${size},format=gbrp[base];` +
      `[1:v]scale=${size},format=gbrp[fix];` +
      /*
        🔴 Thresholded, not just scaled. The mask is lossless h264 but has been
        resampled, and `maskedmerge` treats a mid-grey pixel as a partial blend —
        which at a caption's edge would leave a ghost of the original text
        showing through the repair. `geq` puts every pixel back to 0 or 255,
        and `format=gbrp` then replicates that into all three planes.
      */
      /*
        ══════════════════════════════════════════════════════════════════════
         🔴 THRESHOLD, THEN DILATE, THEN FEATHER — IN THAT ORDER
        ══════════════════════════════════════════════════════════════════════

        Owner, 2026-09-09: "The text area is still showing darker than the main
        picture making the text visible."

        The patch really IS different from its surroundings, and the job row
        says why: `propainter_resized = 480x848->1080x1920`. ProPainter clamps
        its own working resolution, so the repaired region is a 480p
        reconstruction upscaled 2.25x and dropped into a 1080p original. It is
        softer and slightly different in tone — and against a HARD mask edge
        that difference reads as a visible rectangle, which is exactly what a
        hard edge is for: making two things look like two things.

        Feathering the mask turns that edge into a ramp, so the two blend
        instead of abutting. `maskedmerge` already blends proportionally on a
        grey value; it was being denied the chance by the hard threshold.

        ── 🔴 THE DILATION IS WHAT MAKES THE FEATHER SAFE ────────────────────

        A ramp means the ORIGINAL is mixed back in at partial strength. Applied
        directly to the glyph mask, that would mix the TEXT back in around every
        letter — reintroducing the exact ghost the halo fix removed, at the
        exact place it was worst.

        So the mask is grown by roughly the feather radius FIRST. The ramp then
        lives entirely in the band of clean background just outside the text,
        where mixing the original back in is not merely harmless but correct:
        that is where the two images should agree.

        Verified on a synthetic pair (pure red base, pure blue overlay): deep
        inside each region the output is exactly that colour, and only the seam
        blends. Order matters — feather before dilate and the ghost comes back.
      */
      `[2:v]scale=${size},format=gray,geq=lum='if(gt(p(X\\,Y)\\,127)\\,255\\,0)',` +
      `${Array(feather).fill("dilation").join(",")},gblur=sigma=${feather},format=gbrp[m];` +
      `[base][fix][m]maskedmerge,format=yuv420p[out]`,
    "-map",
    "[out]",
    /*
      🔴 The AUDIO IS NOT MAPPED. This runs before `buildRestoreArgs`, which is
      the one step that owns putting the member's sound back — carrying a track
      through here would give that step two candidates and no rule for choosing.
    */
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    // Visually lossless. The output of this pass is the member's picture, and
    // it goes through one more mux — so the only quality lost in the whole
    // pipeline should be here, once.
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(plan.fps),
    plan.outPath,
  ];
}

/* ────────────────────────────── the poster ───────────────────────────────── */

/**
 * How wide a history poster is drawn. 480px on the long edge covers a tile at
 * 2 columns on a 3x phone (roughly 300 device pixels) with room to spare, and
 * an upright 9:16 clip lands at 480x854 — around 25 KB of JPEG.
 */
export const POSTER_MAX_EDGE = 480;

/** Where in the clip the poster is cut from. */
export const POSTER_FRACTION = 0.25;

/**
 * One still frame from the finished video, as a JPEG on disk.
 *
 * ── 🔴 `-ss` BEFORE `-i`, AND THE FALLBACK THAT NEEDS IT ────────────────────
 *
 * Placed before the input, ffmpeg seeks by keyframe and starts decoding there —
 * milliseconds on any length of clip. Placed after, it decodes every frame from
 * zero and throws them away, which on a three-minute video is most of a second
 * of pointless work on the worker.
 *
 * The cost of the fast form is that it lands on the nearest keyframe rather
 * than the exact timestamp, which for a poster is not a cost at all.
 *
 * 🔴 A seek past the end of a clip produces NO frame and exit code 0 — an empty
 * file and a successful run. That is why the caller must check the bytes and
 * fall back to `seconds: 0`, and why this takes the timestamp as an argument
 * instead of computing it: the retry is the same function with a different
 * number, not a second code path.
 *
 * ── Why not the first frame ─────────────────────────────────────────────────
 *
 * Video opens on black, a fade or a logo card far more often than it opens on
 * anything recognisable, and a wall of black tiles is exactly the failure this
 * poster exists to fix. A quarter of the way in is past every intro this
 * product sees. It is also the SAME fraction the before/after comparison
 * samples, so the tile and the comparison show the same moment — which makes
 * the two read as one video rather than two.
 */
export function buildPosterArgs(opts: {
  videoPath: string;
  outPath: string;
  seconds: number;
}): string[] {
  return [
    "-v",
    "error",
    "-y",
    // A negative or non-finite offset would make ffmpeg refuse the whole
    // command; clamped here so the caller can pass a duration it is unsure of.
    "-ss",
    String(Math.max(0, Number.isFinite(opts.seconds) ? opts.seconds : 0)),
    "-i",
    opts.videoPath,
    "-frames:v",
    "1",
    /*
      Fit inside a POSTER_MAX_EDGE box in whichever direction is long, and never
      scale UP — `min(iw,480)` keeps a small source at its own size rather than
      inflating it into a blurrier, larger file. `-1` on the other axis holds
      the aspect ratio, and rounding it to an even number keeps the JPEG encoder
      from complaining about odd chroma dimensions.
    */
    "-vf",
    `scale='if(gt(iw,ih),min(iw,${POSTER_MAX_EDGE}),-2)':'if(gt(iw,ih),-2,min(ih,${POSTER_MAX_EDGE}))'`,
    // 4 is visually indistinguishable at this size and roughly half the bytes
    // of the default 2.
    "-q:v",
    "4",
    "-f",
    "image2",
    opts.outPath,
  ];
}
