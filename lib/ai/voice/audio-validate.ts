/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REPLACEMENT AUDIO — what is accepted, how it is checked, how it is fitted
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 6 §3: MP3, WAV, M4A, AAC, OGG; "Perform server-side validation
 * regardless of client validation. Validate MIME type, actual file
 * signature, file size, duration, corrupted files, unsupported codecs,
 * malicious/malformed uploads. Do not trust the filename or extension."
 * §4: "Do not blindly stretch or loop audio. Create a clear synchronization
 * strategy… The backend must make the final authoritative decision."
 *
 * Pure. The browser uses the format table and the size check before an
 * upload (UX only); the worker uses everything — the magic bytes on the
 * real file, ffprobe's facts, the fit decision — before anything is sent to
 * a provider. Nothing here reads a file: the caller hands it bytes and
 * facts.
 */

export interface AudioFormat {
  label: string;
  extension: string;
  mimeTypes: readonly string[];
}

export const AUDIO_FORMATS: readonly AudioFormat[] = [
  { label: "MP3", extension: "mp3", mimeTypes: ["audio/mpeg", "audio/mp3"] },
  { label: "WAV", extension: "wav", mimeTypes: ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"] },
  { label: "M4A", extension: "m4a", mimeTypes: ["audio/mp4", "audio/x-m4a", "audio/m4a"] },
  { label: "AAC", extension: "aac", mimeTypes: ["audio/aac", "audio/x-aac", "audio/aacp"] },
  { label: "OGG", extension: "ogg", mimeTypes: ["audio/ogg", "application/ogg", "audio/opus"] },
  /*
    Owner, 2026-09-15: "make users able to upload videos from gallery too for
    the voice lip sync, not only an audio file." A phone keeps a recorded
    voice as a video more often than as an audio file. The worker already
    takes the audio track only (`-vn -map 0:a:0`, lib/ai/voice/audio-ffmpeg.ts)
    and refuses a file without one, so accepting the container is the whole
    change. The picture in the file is never used.
  */
  { label: "MP4 video", extension: "mp4", mimeTypes: ["video/mp4"] },
  { label: "MOV video", extension: "mov", mimeTypes: ["video/quicktime"] },
  { label: "WebM", extension: "webm", mimeTypes: ["video/webm", "audio/webm"] },
];

export const AUDIO_ACCEPT = [...new Set(AUDIO_FORMATS.flatMap((f) => f.mimeTypes)), ...AUDIO_FORMATS.map((f) => `.${f.extension}`)].join(",");
export const AUDIO_FORMAT_LINE = AUDIO_FORMATS.map((f) => f.label).join(" · ");

export type AudioErrorCode =
  | "unsupported-audio"
  | "audio-too-large"
  | "invalid-audio"
  | "audio-too-long"
  | "audio-too-short"
  | "audio-longer-than-video"
  | "audio-much-shorter-than-video";

export const AUDIO_ERRORS: Record<AudioErrorCode, { title: string; body: string }> = {
  "unsupported-audio": { title: "That audio format isn't supported", body: `Use ${AUDIO_FORMAT_LINE}.` },
  "audio-too-large": { title: "That audio file is too large", body: "Choose a smaller file." },
  "invalid-audio": { title: "We couldn't read that audio", body: "The file may be damaged. Try exporting it again." },
  "audio-too-long": { title: "That audio is too long", body: "Choose a shorter clip." },
  "audio-too-short": { title: "That audio is too short", body: "There's nothing to sync yet." },
  "audio-longer-than-video": { title: "Your audio is longer than the selected video", body: "Trim the audio, keep more of the video, or choose to cut the audio to fit." },
  "audio-much-shorter-than-video": { title: "Your audio is much shorter than the selected video", body: "Trim the video or use longer audio." },
};

/* ───────────────────────────── the file, before it is opened ─────────────── */

export function audioExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export type AudioVerdict = { ok: true } | { ok: false; code: AudioErrorCode };

/** The browser's check and the create route's: kind by type OR extension, then size, then emptiness. */
export function validateAudioFile(file: { name: string; size: number; type: string }, limits: { maxBytes: number }): AudioVerdict {
  const type = file.type.toLowerCase();
  const ext = audioExtension(file.name);
  const known = AUDIO_FORMATS.some((f) => f.mimeTypes.includes(type) || f.extension === ext);
  if (!known) return { ok: false, code: "unsupported-audio" };
  if (file.size > limits.maxBytes) return { ok: false, code: "audio-too-large" };
  if (file.size === 0) return { ok: false, code: "invalid-audio" };
  return { ok: true };
}

/* ───────────────────────────── the bytes themselves ──────────────────────── */

export type AudioContainer = "mp3" | "wav" | "mp4" | "aac" | "ogg" | "webm";

/**
 * What the first bytes say the file is. The claim in the name and the type
 * is worth nothing (§3: "Do not trust the filename or extension"); this is
 * the signature check, and `sniffedContainerAgrees` is what the worker
 * refuses on.
 *
 *   ID3 / 0xFFE… (MPEG sync)   → mp3
 *   RIFF….WAVE                 → wav
 *   ….ftyp (M4A/MP4)           → mp4
 *   0xFFF (ADTS sync)          → aac
 *   OggS                       → ogg
 */
export function sniffAudioContainer(head: Uint8Array): AudioContainer | null {
  if (head.length < 12) return null;
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (ascii(0, 3) === "ID3") return "mp3";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "wav";
  if (ascii(4, 8) === "ftyp") return "mp4";
  if (ascii(0, 4) === "OggS") return "ogg";
  // EBML header — WebM (and Matroska). 1A 45 DF A3.
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "webm";
  // MPEG audio frame sync: 11 set bits. Layer bits decide ADTS (AAC, layer 00) vs MP3 (layer 01).
  if (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) {
    const layer = (head[1]! >> 1) & 0x03;
    return layer === 0 ? "aac" : "mp3";
  }
  return null;
}

/** Whether the sniffed container is one the declared kind could legitimately be. */
export function sniffedContainerAgrees(sniffed: AudioContainer | null, declared: { name: string; type: string }): boolean {
  if (!sniffed) return false;
  const type = declared.type.toLowerCase();
  const ext = audioExtension(declared.name);
  const kinds = new Set<string>();
  for (const f of AUDIO_FORMATS) if (f.mimeTypes.includes(type) || f.extension === ext) kinds.add(f.extension);
  // A file that lied about its kind is still accepted when the bytes are a real audio container we take:
  // the point of the signature is to refuse a PDF called song.mp3, not an MP3 called song.wav.
  const accepted: Record<AudioContainer, boolean> = { mp3: true, wav: true, mp4: true, aac: true, ogg: true, webm: true };
  return accepted[sniffed] && kinds.size > 0;
}

/** Codecs ffprobe may report for a file we accept. Anything else is "unsupported codec". */
export const ACCEPTED_AUDIO_CODECS = new Set(["mp3", "mp3float", "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_u8", "pcm_s16be", "aac", "aac_latm", "vorbis", "opus", "flac", "alac"]);

export interface ProbedAudio {
  hasAudio: boolean;
  hasVideo: boolean;
  durationSeconds: number | null;
  audioCodec: string | null;
  sampleRate: number | null;
  channels: number | null;
  bitrate: number | null;
}

/**
 * The worker's verdict on a file it has opened: a readable audio stream in
 * an accepted codec, within the operator's length ceiling, not zero. A file
 * with a VIDEO stream alongside is fine since 2026-09-15 (a gallery video used
 * for its voice — the owner's ask); the picture is dropped by the ffmpeg plan
 * (`-vn`), and a video with NO sound is still refused as unreadable audio.
 */
export function validateProbedAudio(probe: ProbedAudio | null, limits: { maxDurationMs: number; minDurationMs: number }): AudioVerdict {
  if (!probe || !probe.hasAudio) return { ok: false, code: "invalid-audio" };
  if (!probe.audioCodec || !ACCEPTED_AUDIO_CODECS.has(probe.audioCodec.toLowerCase())) return { ok: false, code: "unsupported-audio" };
  const ms = probe.durationSeconds !== null ? Math.round(probe.durationSeconds * 1000) : 0;
  if (ms <= 0) return { ok: false, code: "invalid-audio" };
  if (ms < limits.minDurationMs) return { ok: false, code: "audio-too-short" };
  if (ms > limits.maxDurationMs) return { ok: false, code: "audio-too-long" };
  return { ok: true };
}

/* ───────────────────────────── fitting audio to video (§4) ───────────────── */

export interface AudioFitPolicy {
  /** Audio shorter than the video: pad with silence, or refuse. */
  shorterAudio: "silence" | "reject";
  /** The least of the video the audio must cover (0–1); 0 disables. */
  minimumCoverageFraction: number;
  /** The member explicitly asked for longer audio to be cut to the video. */
  trimToFit: boolean;
}

export type AudioFit =
  | { ok: true; action: "keep" | "pad" | "trim"; audioMs: number; videoMs: number }
  | { ok: false; code: "audio-longer-than-video" | "audio-much-shorter-than-video" | "audio-too-short"; audioMs: number; videoMs: number };

/** Half a second: a container's rounding, not a mismatch worth a decision. */
export const AUDIO_FIT_TOLERANCE_MS = 500;

/**
 * The authoritative decision, made from MEASURED durations on the worker.
 * Never stretches, never loops (§4): longer audio is cut only when the
 * member chose it; shorter audio is padded with silence when the operator
 * allows, and refused when it covers too little of the video for the
 * result to make sense.
 */
export function decideAudioFit(audioMs: number, videoMs: number, policy: AudioFitPolicy): AudioFit {
  if (audioMs <= 0) return { ok: false, code: "audio-too-short", audioMs, videoMs };
  const diff = audioMs - videoMs;
  if (Math.abs(diff) <= AUDIO_FIT_TOLERANCE_MS) return { ok: true, action: "keep", audioMs, videoMs };
  if (diff > 0) {
    return policy.trimToFit ? { ok: true, action: "trim", audioMs, videoMs } : { ok: false, code: "audio-longer-than-video", audioMs, videoMs };
  }
  // shorter
  const coverage = audioMs / videoMs;
  if (policy.minimumCoverageFraction > 0 && coverage < policy.minimumCoverageFraction) {
    return { ok: false, code: "audio-much-shorter-than-video", audioMs, videoMs };
  }
  if (policy.shorterAudio === "reject") return { ok: false, code: "audio-much-shorter-than-video", audioMs, videoMs };
  return { ok: true, action: "pad", audioMs, videoMs };
}

/**
 * A rough speaking-time estimate for a dialogue, so the interface can warn
 * BEFORE generation that the text is longer than the video (§4). About 15
 * characters a second of unhurried speech. Honest about being an estimate:
 * the worker measures the generated audio and decides for real.
 */
export function estimateSpeechMs(text: string): number {
  const chars = Array.from(text.trim()).length;
  if (chars === 0) return 0;
  return Math.round((chars / 15) * 1000);
}
