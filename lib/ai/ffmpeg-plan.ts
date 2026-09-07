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
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[];
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
    hasAudio: !!audio,
    hasVideo: !!video,
    formatName: parsed.format?.format_name ?? null,
    bytes: Number(parsed.format?.size) || null,
  };
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
