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
    2. The model's output carries NO colour tags. A player then guesses, and
       for a 480p-class file the usual guess is BT.601 — reds and greens shift
       and the clip reads as "more colour" beside a tagged source. The
       finalizer writes the BT.709 tags INTO the stream without re-encoding
       (`buildColorTagArgs`: `-c copy` + a metadata bitstream filter), so the
       master's pixels are the model's pixels and the player stops guessing.

  Nothing measures or lowers saturation (Video Ready brief, 2026-09-14: "do
  not simply reduce saturation blindly… the final master should remain
  visually accurate"). Every output is tagged BT.709 / limited range.
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

/* ─────────────────── the master's colour tags, without a re-encode ────────── */

/**
 * The H.264 / HEVC VUI colour description, written by a bitstream filter:
 * primaries 1 (BT.709), transfer 1 (BT.709), matrix 1 (BT.709), limited range.
 * A stream copy — not one pixel is decoded or encoded — and `+faststart` so
 * the moov atom leads for the player.
 *
 * TWO passes, both copies (measured 2026-09-14 on ffmpeg 8): the pass that
 * rewrites the SPS cannot also write the container's `colr` atom, because
 * the muxer takes colour from what the DEMUXER read, which was "unspecified".
 * A second plain copy of the now-tagged stream reads the VUI and writes
 * `colr nclx 1/1/1`. Players that trust the container (MediaCodec on
 * Android) and players that trust the bitstream (Safari, ffmpeg-based) then
 * agree. Bytes of video and audio are untouched in both.
 */
const COLOR_TAG_BSF: Record<"h264" | "hevc", string> = {
  h264: "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0",
  hevc: "hevc_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0",
};

export type ColorTagCodec = keyof typeof COLOR_TAG_BSF;

export function colorTagCodecFor(codecName: string | null | undefined): ColorTagCodec | null {
  const c = (codecName ?? "").toLowerCase();
  if (c === "h264") return "h264";
  if (c === "hevc" || c === "h265") return "hevc";
  return null;
}

export function buildColorTagArgs(plan: { input: string; output: string; codec: ColorTagCodec }): string[] {
  return [
    "-y", "-hide_banner", "-loglevel", "error", "-nostdin",
    "-i", plan.input,
    "-map", "0:v:0", "-map", "0:a?",
    "-c", "copy",
    "-bsf:v", COLOR_TAG_BSF[plan.codec],
    "-movflags", "+faststart", "-f", "mp4",
    plan.output,
  ];
}

/** Pass 2: a plain copy of the tagged stream, so the container gets its `colr` atom. */
export function buildContainerTagArgs(plan: { input: string; output: string }): string[] {
  return [
    "-y", "-hide_banner", "-loglevel", "error", "-nostdin",
    "-i", plan.input,
    "-map", "0:v:0", "-map", "0:a?",
    "-c", "copy",
    "-movflags", "+faststart", "-f", "mp4",
    plan.output,
  ];
}

export function isKnownColorTagArg(arg: string, plan: { input: string; output: string }): boolean {
  if (PREPARE_CONSTANT_ARGS.has(arg) || arg === "-c" || arg === "copy" || arg === "-bsf:v") return true;
  if (arg === COLOR_TAG_BSF.h264 || arg === COLOR_TAG_BSF.hevc) return true;
  return arg === plan.input || arg === plan.output;
}
