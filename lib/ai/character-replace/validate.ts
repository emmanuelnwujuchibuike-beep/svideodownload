import type { CharacterReplacePublicConfig, CharacterReplaceQualityId } from "@/lib/ai/character-replace/config";
import type { ReplacementMode } from "@/lib/ai/character-replace/modes";
import type {
  AspectRatio,
  CharacterReplaceJobInput,
  CharacterReplaceProject,
  VideoMetadata,
} from "@/lib/ai/character-replace/types";
import { AI_IMAGE_FORMATS, AI_IMAGE_MAX_BYTES, fileExtension, type AiMediaErrorCode, type AiMediaFormat } from "@/lib/ai/media";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHARACTER REPLACE — validation, readiness, and the job input
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Part 2, §5: "Create a centralized validation layer… configuration-driven."
 * Every rule the interface applies to a file lives here, reads its numbers
 * from ONE `CharacterReplaceLimits` object derived from the server's public
 * config, and answers in the media module's error vocabulary so the picker
 * prints a sentence rather than a code.
 *
 * ── 🔴 THIS IS UX, NOT A CONTROL ────────────────────────────────────────────
 *
 * §19: "Frontend validation is only UX." Every ceiling here is re-checked by
 * the server against the file it actually receives — the create route checks
 * the claimed size and type, /start checks what storage reports, and the
 * worker's ffprobe measures the real duration and frame size. What this layer
 * buys is a fast, kind answer before an upload, not safety.
 *
 * Pure: no DOM, no React. The decoders that PRODUCE a `VideoMetadata` live in
 * features/ai/character-replace/read-media.ts; this module only judges one.
 */

/* ───────────────────────────── formats ───────────────────────────────────── */

/**
 * The video containers this TOOL accepts — MP4, MOV, WebM.
 *
 * ── 🔴 NARROWER THAN THE PLATFORM LIST, ON PURPOSE ─────────────────────────
 *
 * lib/ai/media.ts also lists AVI, which the create route and the storage key
 * derive from. No browser can decode AVI, and this tool needs the browser to
 * decode the file: the preview, the duration, the frame size and the trim all
 * come from the member's own device before anything is uploaded (§4: "Do not
 * assume every browser can decode every format"). An AVI would pass the type
 * check and fail at the decoder with "we couldn't read this video", which is
 * true and unhelpful. Refusing it by format, with the list in the sentence,
 * is the kinder answer.
 *
 * MOV is kept: a QuickTime container with H.264 inside decodes in Safari and
 * Chrome, and it is what an iPhone's camera writes.
 */
export const CHARACTER_REPLACE_VIDEO_FORMATS: readonly AiMediaFormat[] = [
  { label: "MP4", extension: "mp4", mimeTypes: ["video/mp4"] },
  { label: "MOV", extension: "mov", mimeTypes: ["video/quicktime"] },
  { label: "WebM", extension: "webm", mimeTypes: ["video/webm"] },
];

export const CHARACTER_REPLACE_VIDEO_ACCEPT = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  ...CHARACTER_REPLACE_VIDEO_FORMATS.map((f) => `.${f.extension}`),
].join(",");

export const CHARACTER_REPLACE_VIDEO_FORMAT_LINE = CHARACTER_REPLACE_VIDEO_FORMATS.map((f) => f.label).join(" · ");

/* ───────────────────────────── limits ────────────────────────────────────── */

/**
 * Every ceiling the interface validates against, in one object.
 *
 * Derived from the server's public config — the operator's numbers — with the
 * platform's own constants as the floor. Nothing in a component reads a bare
 * number; it asks this. When the server has not answered yet the platform
 * defaults apply, and the server re-checks everything anyway.
 */
export interface CharacterReplaceLimits {
  photo: {
    maxBytes: number;
    formats: readonly AiMediaFormat[];
    /** Below this on the shorter edge a face is too small to carry across. */
    minEdge: number;
  };
  video: {
    maxBytes: number;
    formats: readonly AiMediaFormat[];
    /** Width × height ceiling. */
    maxPixels: number;
    /** Integer milliseconds the KEPT range may be. */
    maxDurationMs: number;
    minDurationMs: number;
    /** Below this on the shorter edge the model has too little to work with. */
    minEdge: number;
  };
  trim: { enabled: boolean };
  /** How many reference images this mode takes (Part 6). */
  references: { max: number };
}

const PLATFORM_MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const PLATFORM_MAX_PIXELS = 3840 * 2160;

/**
 * The ceilings for ONE mode (Part 6). Face Only and Skin + Face carry their
 * own in the public config; Full Character's are the tool's top-level ones
 * — the same numbers the mode view reports, so passing `full_character`
 * (or nothing) gives exactly the limits Parts 1–5 applied.
 */
export function characterReplaceLimits(config: CharacterReplacePublicConfig | null, mode: ReplacementMode = "full_character"): CharacterReplaceLimits {
  // Full Character's ceilings ARE the top-level fields (Parts 1–5); the two new modes carry their own.
  const m = mode === "full_character" ? null : (config?.modes?.find((x) => x.id === mode) ?? null);
  return {
    photo: {
      maxBytes: AI_IMAGE_MAX_BYTES,
      formats: AI_IMAGE_FORMATS,
      minEdge: 256,
    },
    video: {
      maxBytes: Math.min(PLATFORM_MAX_VIDEO_BYTES, m?.maximumUploadBytes ?? config?.maximumUploadBytes ?? PLATFORM_MAX_VIDEO_BYTES),
      formats: CHARACTER_REPLACE_VIDEO_FORMATS,
      maxPixels: Math.min(PLATFORM_MAX_PIXELS, m?.maximumPixels ?? config?.maximumPixels ?? PLATFORM_MAX_PIXELS),
      maxDurationMs: Math.round((m?.maximumDurationSeconds ?? config?.maximumDurationSeconds ?? 120) * 1000),
      minDurationMs: Math.round((config?.trim.minimumSeconds ?? 1) * 1000),
      minEdge: 240,
    },
    trim: { enabled: config?.trim.enabled ?? true },
    references: { max: m?.maximumReferenceImages ?? 1 },
  };
}

/* ───────────────────────────── file checks ───────────────────────────────── */

export type CharacterReplaceVerdict = { ok: true } | { ok: false; code: AiMediaErrorCode };

function knownFormat(file: { name: string; type: string }, formats: readonly AiMediaFormat[]): boolean {
  const type = file.type.toLowerCase();
  const ext = fileExtension(file.name);
  return formats.some((f) => f.mimeTypes.includes(type) || f.extension === ext);
}

/** The photo, before it is decoded: kind, then size, then emptiness. */
export function validatePhotoFile(file: { name: string; size: number; type: string }, limits: CharacterReplaceLimits): CharacterReplaceVerdict {
  if (!knownFormat(file, limits.photo.formats)) return { ok: false, code: "unsupported-image" };
  if (file.size > limits.photo.maxBytes) return { ok: false, code: "image-too-large" };
  if (file.size === 0) return { ok: false, code: "invalid-image" };
  return { ok: true };
}

/** The photo, once decoded: a picture too small to hold a face is refused. */
export function validatePhotoPixels(size: { width: number; height: number } | null, limits: CharacterReplaceLimits): CharacterReplaceVerdict {
  if (!size) return { ok: false, code: "invalid-image" };
  if (Math.min(size.width, size.height) < limits.photo.minEdge) return { ok: false, code: "image-too-small" };
  return { ok: true };
}

/** The video, before it is decoded: kind, then size, then emptiness. */
export function validateVideoFile(file: { name: string; size: number; type: string }, limits: CharacterReplaceLimits): CharacterReplaceVerdict {
  if (!knownFormat(file, limits.video.formats)) return { ok: false, code: "unsupported-file" };
  if (file.size > limits.video.maxBytes) return { ok: false, code: "file-too-large" };
  if (file.size === 0) return { ok: false, code: "invalid-video" };
  return { ok: true };
}

/**
 * The video, once decoded. A video LONGER than the ceiling is not refused
 * here — the trim step exists to shorten it, and the reducer pre-trims the
 * kept range to the ceiling. Too short, too small, or too many pixels are
 * facts a trim cannot change, so they are refused with a sentence.
 */
export function validateVideoMetadata(meta: VideoMetadata, limits: CharacterReplaceLimits): CharacterReplaceVerdict {
  if (meta.durationMs !== null && meta.durationMs < limits.video.minDurationMs) return { ok: false, code: "video-too-short" };
  if (meta.width !== null && meta.height !== null) {
    if (meta.width * meta.height > limits.video.maxPixels) return { ok: false, code: "video-resolution-too-large" };
    if (Math.min(meta.width, meta.height) < limits.video.minEdge) return { ok: false, code: "video-resolution-too-small" };
  }
  return { ok: true };
}

/* ───────────────────────────── metadata helpers ──────────────────────────── */

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** 1080×1920 → 9:16; 1280×720 → 16:9; 1080×1350 → 4:5; anything else reduced. */
export function aspectRatioOf(width: number | null, height: number | null): AspectRatio | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  const d = gcd(Math.round(width), Math.round(height));
  let w = Math.round(width) / d;
  let h = Math.round(height) / d;
  // 1080×1920 reduces to 9:16 exactly; 1080×1080 to 1:1. Camera sizes that
  // are a pixel off (1080×1918) would reduce to nonsense, so snap to the
  // named ratios when within 1%.
  const named: [number, number][] = [
    [9, 16],
    [16, 9],
    [1, 1],
    [4, 5],
    [5, 4],
    [4, 3],
    [3, 4],
    [3, 2],
    [2, 3],
    [21, 9],
  ];
  const ratio = width / height;
  for (const [nw, nh] of named) {
    if (Math.abs(ratio - nw / nh) / (nw / nh) < 0.01) {
      w = nw;
      h = nh;
      break;
    }
  }
  return {
    w,
    h,
    label: `${w}:${h}`,
    orientation: width > height ? "landscape" : width < height ? "portrait" : "square",
  };
}

/**
 * "720p" / "1080p" / "4K" from the SHORTER edge, which is how a phone video
 * (1080×1920) and a landscape one (1920×1080) both read as 1080p. Below 480p
 * the raw height is printed, because "360p" is a fact and "SD" is a shrug.
 */
export function resolutionLabelOf(width: number | null, height: number | null): string | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  const short = Math.min(width, height);
  if (short >= 2100) return "4K";
  if (short >= 1400) return "1440p";
  if (short >= 1000) return "1080p";
  if (short >= 680) return "720p";
  if (short >= 460) return "480p";
  return `${short}p`;
}

/** "mp4" from the name first (a picker's type can lie), then the type, then unknown. */
export function containerOf(name: string, mimeType: string): string {
  const ext = fileExtension(name);
  if (CHARACTER_REPLACE_VIDEO_FORMATS.some((f) => f.extension === ext)) return ext;
  const byType = CHARACTER_REPLACE_VIDEO_FORMATS.find((f) => f.mimeTypes.includes(mimeType.toLowerCase()));
  return byType?.extension ?? "unknown";
}

/** Milliseconds, as an integer, from a decoder's floating seconds. */
export function toMs(seconds: number | null): number | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds * 1000);
}

/* ───────────────────────────── quality guidance (§13) ────────────────────── */

/**
 * Whether a requested output quality asks for more detail than the source
 * holds — a sentence, never a refusal. "Your source video is 720p. 1080p
 * output may not add real detail." The server decides the actual output
 * resolution; this only stops a member paying for pixels that are not there.
 */
export function qualityGuidance(
  meta: VideoMetadata | null,
  quality: CharacterReplaceQualityId | string,
  qualities: CharacterReplacePublicConfig["qualities"],
): string | null {
  if (!meta || meta.width === null || meta.height === null) return null;
  const chosen = qualities.find((q) => q.id === quality);
  if (!chosen) return null;
  const sourceLong = Math.max(meta.width, meta.height);
  if (chosen.longEdge > sourceLong * 1.05) {
    const label = meta.resolutionLabel ?? `${Math.min(meta.width, meta.height)}p`;
    return `Your source video is ${label}. ${chosen.label} output may not add real detail.`;
  }
  return null;
}

/**
 * Is this quality one the member may pick for this mode? Full Character
 * reads the 480p/720p/1080p list; Face Only and Skin + Face read THEIR
 * tiers (standard/high/ultra).
 *
 * 🔴 The gate used to read only `config.qualities` — so in Face Only the
 * tier "standard" was never found, Continue stayed grey, and the summary
 * said "Check the selected range" about a range that was fine (owner,
 * 2026-09-14: "I can't click the continue button after inputting a video").
 */
export function qualityOffered(config: CharacterReplacePublicConfig, mode: ReplacementMode, quality: string): boolean {
  if (mode === "full_character") return config.qualities.some((q) => q.id === quality);
  const m = config.modes.find((x) => x.id === mode);
  return !!m && m.tiers.some((t) => t.id === quality && t.enabled && t.supported);
}

/* ───────────────────────────── readiness (§15) ───────────────────────────── */

export type ReadinessIssue =
  | "photo-missing"
  | "video-missing"
  | "video-unmeasured"
  | "trim-too-long"
  | "trim-too-short"
  | "trim-invalid"
  | "quality-unavailable";

/**
 * Whether the two files and the kept range are a complete, valid input — the
 * gate on Continue. Every issue is a fact the interface can verify locally;
 * the server verifies them all again.
 */
export function inputReadiness(
  project: CharacterReplaceProject,
  config: CharacterReplacePublicConfig | null,
): { ready: boolean; issues: ReadinessIssue[] } {
  const issues: ReadinessIssue[] = [];
  const limits = characterReplaceLimits(config, project.mode);
  if (!project.character) issues.push("photo-missing");
  const video = project.video;
  if (!video) {
    issues.push("video-missing");
  } else {
    const range = selectedRangeMs(project);
    if (range === null) {
      issues.push("video-unmeasured");
    } else {
      if (range.endMs <= range.startMs) issues.push("trim-invalid");
      const kept = range.endMs - range.startMs;
      if (kept > limits.video.maxDurationMs + 50) issues.push("trim-too-long");
      if (kept < limits.video.minDurationMs - 50) issues.push("trim-too-short");
    }
  }
  if (config && !qualityOffered(config, project.mode, project.settings.quality)) issues.push("quality-unavailable");
  return { ready: issues.length === 0, issues };
}

/** The kept range in integer milliseconds, or null when the video is unmeasured. */
export function selectedRangeMs(project: CharacterReplaceProject): { startMs: number; endMs: number } | null {
  const duration = project.video?.metadata.durationMs ?? null;
  if (duration === null) return null;
  const trim = project.settings.trim;
  if (!trim) return { startMs: 0, endMs: duration };
  const startMs = Math.max(0, Math.min(duration, Math.round(trim.start * 1000)));
  const endMs = Math.max(startMs, Math.min(duration, Math.round(trim.end * 1000)));
  return { startMs, endMs };
}

/* ───────────────────────────── the job input (§14) ───────────────────────── */

/**
 * The draft as plain JSON for the server. Null when the draft is not complete
 * — a job input with a missing file is not "partially ready", it is not one.
 */
export function buildJobInput(project: CharacterReplaceProject): CharacterReplaceJobInput | null {
  const photo = project.character;
  const video = project.video;
  if (!photo || !video) return null;
  const range = selectedRangeMs(project);
  if (!range) return null;
  const meta = video.metadata;
  return {
    photo: { name: photo.name, sizeBytes: photo.size, mimeType: photo.mimeType, width: photo.width, height: photo.height },
    video: {
      name: video.name,
      sizeBytes: video.size,
      mimeType: video.mimeType,
      container: meta.container,
      originalDurationMs: meta.durationMs,
      sourceWidth: meta.width,
      sourceHeight: meta.height,
      sourceResolution: meta.resolutionLabel,
      aspect: meta.aspect?.label ?? null,
      hasAudio: meta.hasAudio,
      frameRate: meta.frameRate,
    },
    trim: {
      startMs: range.startMs,
      endMs: range.endMs,
      selectedDurationMs: range.endMs - range.startMs,
      whole: range.startMs === 0 && meta.durationMs !== null && range.endMs === meta.durationMs,
    },
    output: { mode: project.mode, requestedQuality: project.settings.quality },
    audio: {
      voiceMode: project.voice.mode,
      voiceSource: project.voice.mode === "new_voice" ? project.voice.source : null,
      languageCode: project.voice.mode === "new_voice" && project.voice.source === "tts" ? project.voice.languageCode : null,
      voiceId: project.voice.mode === "new_voice" && project.voice.source === "tts" ? project.voice.voiceId : null,
      lipSyncMode: project.voice.mode === "new_voice" ? project.lipSync.tier : null,
    },
    consent: project.consent,
  };
}
