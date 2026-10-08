/**
 * The sound of a video, as a small mono WAV — in the browser, no upload of
 * the video itself (owner, 2026-10-08: "it should be able to clone from a
 * video from gallery, it should be clean").
 *
 * A phone's gallery picker offers photos and videos only, so a voice a member
 * recorded on camera arrived as `video/mp4` / `video/quicktime` and Voice
 * Cloning refused it as "not audio files". The voice-clone pipeline has no
 * ffmpeg (it sends the samples straight to the provider), so the soundtrack is
 * taken out HERE: the browser's own decoder reads the video's audio track
 * (MP4/MOV with AAC decode on iPhone, Android and desktop), an
 * OfflineAudioContext mixes it to mono at 22.05 kHz — plenty for a voice — and
 * it is written as 16-bit PCM WAV, a format every provider accepts.
 *
 * ~44 KB per second, so the 5-minute per-sample ceiling is ~13 MB.
 */

export class NoUsableAudioError extends Error {}

const VOICE_RATE = 22_050;
/** Above this the decode itself would hold hundreds of MB in a phone's memory. */
export const MAX_VIDEO_BYTES_FOR_AUDIO = 250 * 1024 * 1024;

export function looksLikeVideo(file: { name: string; type: string }): boolean {
  if (file.type.startsWith("video/")) return true;
  return /\.(mp4|mov|m4v|3gp|webm|mkv)$/i.test(file.name) && !file.type.startsWith("audio/");
}

/** Interleaved mono Float32 → a 16-bit PCM WAV blob. Pure, so it is testable. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = 44 + samples.length * 2;
  const buf = new ArrayBuffer(bytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, bytes - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** The loudest sample — a video with a silent or missing track decodes to (near) zeros. */
export function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]!);
    if (a > peak) peak = a;
  }
  return peak;
}

type AudioCtxCtor = typeof AudioContext;
type OfflineCtor = typeof OfflineAudioContext;

export async function extractAudioAsWav(file: File, opts: { maxSeconds: number }): Promise<{ file: File; durationMs: number }> {
  if (file.size > MAX_VIDEO_BYTES_FOR_AUDIO) throw new NoUsableAudioError("too large");
  const w = window as unknown as { AudioContext?: AudioCtxCtor; webkitAudioContext?: AudioCtxCtor; OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  const Ctx = w.AudioContext ?? w.webkitAudioContext;
  const Offline = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (!Ctx || !Offline) throw new NoUsableAudioError("no audio engine");

  const ctx = new Ctx();
  let decoded: AudioBuffer;
  try {
    const bytes = await file.arrayBuffer();
    // the callback form: older Safari never resolved the promise form
    decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      const p = ctx.decodeAudioData(bytes, resolve, reject) as unknown as Promise<AudioBuffer> | undefined;
      p?.catch?.(reject);
    });
  } catch {
    throw new NoUsableAudioError("no audio track");
  } finally {
    void ctx.close?.();
  }

  const seconds = Math.min(decoded.duration, opts.maxSeconds);
  if (!(seconds > 0.5)) throw new NoUsableAudioError("too short");
  const frames = Math.ceil(seconds * VOICE_RATE);
  // one output channel: the context mixes every input channel down to mono
  const offline = new Offline(1, frames, VOICE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  const mono = rendered.getChannelData(0);
  if (peakOf(mono) < 0.01) throw new NoUsableAudioError("silent");

  const base = file.name.replace(/\.[^.]+$/, "") || "video";
  return { file: new File([encodeWav(mono, VOICE_RATE)], `${base} (voice).wav`, { type: "audio/wav", lastModified: file.lastModified }), durationMs: Math.round(seconds * 1000) };
}
