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
  ── 🔴 NOTHING TOUCHES THE PICTURE BUT THE TRIM AND THE SIZE (owner, 2026-09-14) ──

  "The result and filter should be purely natural from replicate." Two
  results made after the Part 5 deploy came back with the replacement placed
  wrongly, and the owner traced it to that deploy. What that deploy had
  added to THIS plan was an HDR tone-map on the model's INPUT (zscale →
  hable → BT.709) and BT.709 colour tags on every prepared file; the
  finalizer had gained two colour-tag rewrite passes on the OUTPUT. All of
  it is gone. The prepared file is the member's own frames, cut to the kept
  range and scaled to the model's ceiling, in the pixel format the model
  takes — exactly Part 4's plan, the one the owner's good results were made
  with. The finalizer stores what the provider returned, byte for byte.

  No tone-map, no colour tags, no saturation, brightness or LUT filter,
  here or anywhere on this pipeline. pipeline.test.ts and background.test.ts
  pin that.
*/

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
    "-vf", SCALE_FILTER,
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

