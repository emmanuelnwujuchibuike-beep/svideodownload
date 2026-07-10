/**
 * Shared helpers for the comment platform's voice-note and video-reply
 * recorders (features/social/voice-recorder.tsx, video-comment-recorder.tsx).
 * Browser-only (MediaRecorder/AudioContext) — every export here is safe to
 * call only after confirming `supportsRecording()`.
 */

export const VOICE_MAX_MS = 180_000; // 3 minutes
export const VIDEO_MAX_MS = 60_000; // 60 seconds

export const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
];
export const VIDEO_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
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

/** Grab a poster frame from a recorded video element at its current time. */
export function captureVideoFrame(video: HTMLVideoElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 720;
      canvas.height = video.videoHeight || 1280;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85);
    } catch {
      resolve(null);
    }
  });
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
