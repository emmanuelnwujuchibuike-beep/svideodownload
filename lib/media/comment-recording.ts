/**
 * Shared helpers for the comment platform's voice-note recorder
 * (features/social/voice-recorder.tsx). Browser-only (MediaRecorder/
 * AudioContext) — every export here is safe to call only after confirming
 * `supportsRecording()`.
 */

export const VOICE_MAX_MS = 180_000; // 3 minutes

export const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
];

/** Progressive enhancement gate — hide recording affordances entirely when unsupported. */
export function supportsRecording(): boolean {
  return (
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

/** First candidate the browser can actually record, or "" (let the browser pick a default). */
export function pickMimeType(candidates: string[]): string {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export function extForMime(mime: string): string {
  if (mime.includes("mp4")) return mime.startsWith("video") ? "mp4" : "m4a";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("ogg")) return "ogg";
  return "bin";
}

/** Downsample a recorded audio blob into peak amplitudes for an instant, no-redecode waveform. */
export async function computeAudioPeaks(blob: Blob, buckets = 46): Promise<{ peaks: number[]; durationMs: number }> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const data = audioBuffer.getChannelData(0);
    const samplesPerBucket = Math.max(1, Math.floor(data.length / buckets));
    const peaks: number[] = [];
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      const start = i * samplesPerBucket;
      const end = Math.min(data.length, start + samplesPerBucket);
      for (let j = start; j < end; j++) {
        const v = Math.abs(data[j] ?? 0);
        if (v > max) max = v;
      }
      peaks.push(Math.round(max * 100));
    }
    return { peaks, durationMs: Math.round(audioBuffer.duration * 1000) };
  } finally {
    void ctx.close();
  }
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
