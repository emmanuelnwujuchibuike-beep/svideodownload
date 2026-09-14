/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REPLACEMENT AUDIO — the ffmpeg plan that makes it what the pipeline needs
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 6 §3: "Normalize the audio to a format suitable for the
 * downstream pipeline when necessary. Do not unnecessarily re-encode
 * already-compatible audio." §4: no stretching, no looping — a cut only
 * when the member asked, silence only to fill.
 *
 * The lip-sync provider takes a WAV. The plan produces one — 16-bit PCM,
 * mono, 32 kHz (what the TTS provider already writes, so a generated voice
 * and an uploaded one meet the provider the same way) — and does exactly
 * one of three things to its length: nothing, a cut at the video's length,
 * or a silent tail up to it. A file that already IS 16-bit mono PCM at that
 * rate is stream-copied (`transcoded: false` on the row).
 *
 * The same rule as every other plan on this pipeline: a fixed ARGUMENT
 * ARRAY, every element a constant here or one of two paths the worker
 * built itself, proven against `isKnownAudioArg` before it is spawned.
 */

export const AUDIO_WAV_SAMPLE_RATE = 32000;

export interface AudioPreparePlan {
  input: string;
  output: string;
  /** "keep" | "trim" | "pad", from `decideAudioFit`. */
  action: "keep" | "trim" | "pad";
  /** The video's length, integer milliseconds — the target for a trim or a pad. */
  videoMs: number;
  /** True when the input is already 16-bit PCM, mono, at the target rate: copy, do not encode. */
  compatible: boolean;
}

const CONSTANT = new Set<string>([
  "-y", "-hide_banner", "-loglevel", "error", "-nostdin",
  "-i", "-vn", "-map", "0:a:0", "-t",
  "-c:a", "copy", "pcm_s16le", "-ac", "1", "-ar", String(AUDIO_WAV_SAMPLE_RATE),
  "-af", "-f", "wav",
]);

function secondsArg(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0) throw new Error("a time must be a non-negative integer of milliseconds");
  return (ms / 1000).toFixed(3);
}

/** `apad` up to the video's length: silence only, never a repeat of the audio. */
function padFilter(videoMs: number): string {
  return `apad=whole_dur=${secondsArg(videoMs)}`;
}

export function buildAudioPrepareArgs(plan: AudioPreparePlan): string[] {
  if (!Number.isInteger(plan.videoMs) || plan.videoMs <= 0) throw new Error("the video length must be a positive integer of milliseconds");
  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error", "-nostdin", "-i", plan.input, "-vn", "-map", "0:a:0"];
  if (plan.action === "trim") args.push("-t", secondsArg(plan.videoMs));
  if (plan.action === "pad") {
    // A pad is a filter, which means a decode: the copy path is not available here.
    args.push("-af", padFilter(plan.videoMs), "-c:a", "pcm_s16le", "-ac", "1", "-ar", String(AUDIO_WAV_SAMPLE_RATE));
  } else if (plan.compatible) {
    args.push("-c:a", "copy");
  } else {
    args.push("-c:a", "pcm_s16le", "-ac", "1", "-ar", String(AUDIO_WAV_SAMPLE_RATE));
  }
  args.push("-f", "wav", plan.output);
  return args;
}

export function isKnownAudioArg(arg: string, plan: AudioPreparePlan): boolean {
  if (CONSTANT.has(arg)) return true;
  if (arg === plan.input || arg === plan.output) return true;
  if (/^\d+\.\d{3}$/.test(arg)) return true;
  return /^apad=whole_dur=\d+\.\d{3}$/.test(arg);
}

/** Whether a probed stream can be copied into the WAV as-is. */
export function isWavCompatible(probe: { audioCodec: string | null; sampleRate: number | null; channels: number | null }): boolean {
  return probe.audioCodec === "pcm_s16le" && probe.sampleRate === AUDIO_WAV_SAMPLE_RATE && probe.channels === 1;
}
