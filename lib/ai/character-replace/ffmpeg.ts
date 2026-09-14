/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PREPARE PLAN — trim, normalise, and nothing a member typed reaches ffmpeg
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 4, §5): "The backend must actually produce/use the
 * trimmed video before sending it to Replicate… The billed duration and actual
 * processing duration must match." And §39: reuse the existing media stack —
 * ffmpeg on the Docker worker, the same binary the AI Clean finalizer used.
 *
 * The plan is a fixed ARRAY. Every element is a constant from this file, one
 * of two temp paths the service built from `tmpdir()` + the job id, or a
 * number this module formatted from an integer it was handed. There is no
 * field a filename, a filter or a flag could arrive through; a test walks
 * the whole array and fails on anything it does not recognise.
 *
 * ── Why re-encode rather than stream-copy ───────────────────────────────────
 *
 * A copy cut lands on the nearest keyframe, which can be a second or more
 * from where the member dragged the handle — and then the file the provider
 * bills for is not the file the member was quoted. Decoding and re-encoding
 * cuts on the frame. It also hands the model one predictable container
 * (h264 / aac / faststart MP4) whatever the phone recorded, and caps the
 * long edge so a 4K upload does not ship 4K to a model that documents 720.
 */

/** The longest edge the provider receives. The model works at 480/720; anything larger is wasted upload. */
export const PREPARE_MAX_LONG_EDGE = 1920;

/** The scale filter: cap the long edge, keep the aspect, keep both sides even (yuv420p needs it). */
const SCALE_FILTER = `scale=w='if(gt(iw,ih),trunc(min(iw,${PREPARE_MAX_LONG_EDGE})/2)*2,-2)':h='if(gt(iw,ih),-2,trunc(min(ih,${PREPARE_MAX_LONG_EDGE})/2)*2)'`;

/*
  ── 🔴 COLOUR STAYS NATURAL (owner, 2026-09-14: "it gives it extra color more
  than the original video, it supposed to stay natural") ─────────────────────

  Two things can make a result look "more colourful" than the source, and
  neither is the member's fault:

    1. An HDR source (an iPhone's HLG / PQ, 10-bit, BT.2020). Converting that to
       8-bit yuv420p WITHOUT tone-mapping hands the model wrong primaries and a
       crushed transfer — every colour reads hotter. `HDR_TO_SDR_FILTER` maps it
       to BT.709 SDR properly (zscale → linear → hable tonemap → bt709) before
       the model sees a frame.
    2. The model's own output, which tends to leave saturation a touch higher
       than its input. The finalizer MEASURES the source and the output
       (`buildSaturationProbeArgs`) and, only when the output is more saturated,
       pulls it back to the source's level (`buildColorMatchArgs`) — never the
       other way, never past 0.6, so a naturally vivid clip stays vivid.

  Every output is tagged BT.709 / limited range so a player never has to guess.
*/
const HDR_TO_SDR_FILTER = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";
const COLOR_TAG_ARGS = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"] as const;

export const PREPARE_CONSTANT_ARGS = new Set<string>([
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-nostdin",
  "-ss",
  "-i",
  "-t",
  "-map",
  "0:v:0",
  "0:a?",
  "-vf",
  SCALE_FILTER,
  `${HDR_TO_SDR_FILTER},${SCALE_FILTER}`,
  ...COLOR_TAG_ARGS,
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-profile:v",
  "high",
  "-c:a",
  "aac",
  "-b:a",
  "128k",
  "-ac",
  "2",
  "-ar",
  "48000",
  "-movflags",
  "+faststart",
  "-f",
  "mp4",
]);

export interface PreparePlan {
  input: string;
  output: string;
  /** The kept range, integer milliseconds. `null` end = to the end of the file. */
  startMs: number;
  endMs: number | null;
  /** True when the source is HDR (HLG/PQ transfer, BT.2020 primaries or 10-bit): it is tone-mapped to SDR first. */
  hdr?: boolean;
}

/** Milliseconds → the seconds string ffmpeg reads, three decimals, no locale. */
export function secondsArg(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0) throw new Error("a time must be a non-negative integer of milliseconds");
  return (ms / 1000).toFixed(3);
}

export function buildPrepareArgs(plan: PreparePlan): string[] {
  if (plan.endMs !== null && plan.endMs <= plan.startMs) throw new Error("the kept range is empty");
  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error", "-nostdin"];
  // Input-side seek: with a full decode this is frame-accurate, and it skips
  // the demux of everything before the cut instead of decoding it to discard.
  if (plan.startMs > 0) args.push("-ss", secondsArg(plan.startMs));
  args.push("-i", plan.input);
  if (plan.endMs !== null) args.push("-t", secondsArg(plan.endMs - plan.startMs));
  args.push(
    "-map", "0:v:0",
    "-map", "0:a?",
    "-vf", plan.hdr ? `${HDR_TO_SDR_FILTER},${SCALE_FILTER}` : SCALE_FILTER,
    ...COLOR_TAG_ARGS,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-profile:v", "high",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ac", "2",
    "-ar", "48000",
    "-movflags", "+faststart",
    "-f", "mp4",
    plan.output,
  );
  return args;
}

/**
 * The whole point of the array: a test (and the service, before it spawns)
 * can prove every element is one of the knowns.
 */
export function isKnownPrepareArg(arg: string, plan: PreparePlan): boolean {
  if (PREPARE_CONSTANT_ARGS.has(arg)) return true;
  if (arg === plan.input || arg === plan.output) return true;
  return /^\d+\.\d{3}$/.test(arg);
}

/* ───────────────────────── the colour probe and the match ─────────────────── */

export const SATURATION_SAMPLE_EVERY = 5;

/**
 * Mean saturation of a file, sampled every fifth frame, printed one line per
 * frame as `lavfi.signalstats.SATAVG=<n>` on stdout. Parse with `parseSatAvg`.
 */
export function buildSaturationProbeArgs(input: string): string[] {
  return [
    "-v", "error", "-nostdin",
    "-i", input,
    "-vf", `select='not(mod(n,${SATURATION_SAMPLE_EVERY}))',signalstats,metadata=print:key=lavfi.signalstats.SATAVG:file=-`,
    "-an", "-f", "null", "-",
  ];
}

export function parseSatAvg(stdout: string): number | null {
  const values: number[] = [];
  for (const m of stdout.matchAll(/SATAVG=([0-9.]+)/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) values.push(n);
  }
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * How much to pull the output's saturation back toward the source's, or null
 * when nothing should change. Only ever a reduction (≤ 1), never below 0.6,
 * and only when the output is at least 4 % more saturated than the source —
 * a frame's noise must not trigger a re-encode.
 */
export function saturationMatch(sourceSat: number | null, outputSat: number | null): number | null {
  if (sourceSat === null || outputSat === null || sourceSat <= 0 || outputSat <= 0) return null;
  const ratio = sourceSat / outputSat;
  if (ratio >= 0.96) return null;
  return Math.max(0.6, Math.round(ratio * 1000) / 1000);
}

/** Re-encode the output with the saturation pulled back, tagged BT.709. Audio copied untouched. */
export function buildColorMatchArgs(plan: { input: string; output: string; saturation: number }): string[] {
  if (!(plan.saturation > 0 && plan.saturation <= 1)) throw new Error("saturation must be in (0, 1]");
  return [
    "-y", "-hide_banner", "-loglevel", "error", "-nostdin",
    "-i", plan.input,
    "-map", "0:v:0", "-map", "0:a?",
    "-vf", `eq=saturation=${plan.saturation.toFixed(3)}`,
    ...COLOR_TAG_ARGS,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart", "-f", "mp4",
    plan.output,
  ];
}

export function isKnownColorMatchArg(arg: string, plan: { input: string; output: string }): boolean {
  if (PREPARE_CONSTANT_ARGS.has(arg) || arg === "copy" || arg === "18") return true;
  if (arg === plan.input || arg === plan.output) return true;
  return /^eq=saturation=0\.\d{3}$|^eq=saturation=1\.000$/.test(arg);
}
