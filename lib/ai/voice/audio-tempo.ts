/**
 * The speaking-speed change for a VOICE-PROVIDER-made speech (Lip Sync Pro
 * §1: "Speed 0.8x — 2.0x"). A text-native model takes `voice_speed` itself;
 * ElevenLabs speech is made at its natural pace and re-timed here with
 * ffmpeg's `atempo`, which keeps the pitch (no chipmunk). One filter stage
 * covers 0.5–2.0; a speed past 2.0 is two stages. Like every ffmpeg plan on
 * this pipeline, the argument list is fixed constants plus two paths and
 * numbers this module formatted — a test walks it.
 */
export interface TempoPlan {
  input: string;
  output: string;
  /** 0.5–3.0, rounded to two decimals; 1 = no change (the caller skips the run). */
  speed: number;
}

const CONSTANT = new Set<string>(["-y", "-hide_banner", "-loglevel", "error", "-nostdin", "-i", "-vn", "-filter:a", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", "-f", "wav"]);

export function tempoFilter(speed: number): string {
  const s = Math.min(3, Math.max(0.5, Math.round(speed * 100) / 100));
  if (s <= 2) return `atempo=${s.toFixed(2)}`;
  // two stages: sqrt(s) each, both inside atempo's 0.5–2.0 window for s ≤ 4
  const half = Math.sqrt(s);
  return `atempo=${half.toFixed(3)},atempo=${half.toFixed(3)}`;
}

export function buildTempoArgs(plan: TempoPlan): string[] {
  if (!(plan.speed >= 0.5 && plan.speed <= 3)) throw new Error("speed must be 0.5–3");
  return ["-y", "-hide_banner", "-loglevel", "error", "-nostdin", "-i", plan.input, "-vn", "-filter:a", tempoFilter(plan.speed), "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", "-f", "wav", plan.output];
}

export function isKnownTempoArg(arg: string, plan: TempoPlan): boolean {
  if (CONSTANT.has(arg)) return true;
  if (arg === plan.input || arg === plan.output) return true;
  return /^atempo=\d+\.\d{2,3}(,atempo=\d+\.\d{2,3})?$/.test(arg);
}
