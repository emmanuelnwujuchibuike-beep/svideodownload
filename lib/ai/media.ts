/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — what a member may hand the product, decided in one place
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure rules and the copy for refusing a file. No React, no DOM, no network —
 * the browser's picker and the server's create route both read THESE numbers,
 * so the two can never disagree about what is allowed, only about who is
 * trusted to say so (the server).
 *
 * ── 🔴 THIS USED TO BE `clean-media.ts`, AND IT WAS AI CLEAN'S ───────────
 *
 * Owner, 2026-09-13: "Just remove the AI Clean features and leave only the new
 * character replace." Every generic module that needed a video ceiling —
 * the job registry, the link validator, the result route — imported it from a
 * file named after one tool, with constants named after that tool. The rules
 * are the platform's, not AI Clean's: the video formats and the 100 MB
 * ceiling apply to whatever tool takes a video next. So they live here under
 * their own names, unchanged in value, and Character Replace adds the one
 * thing AI Clean never needed — an IMAGE rule set for the reference photo.
 */

/* ───────────────────────────── video ─────────────────────────────────────── */

/** 100 MB. A phone clip at 1080p is 20–60 MB; this is comfortably above that. */
export const AI_VIDEO_MAX_BYTES = 100 * 1024 * 1024;

export interface AiMediaFormat {
  label: string;
  extension: string;
  mimeTypes: readonly string[];
}

export const AI_VIDEO_FORMATS: readonly AiMediaFormat[] = [
  { label: "MP4", extension: "mp4", mimeTypes: ["video/mp4"] },
  { label: "MOV", extension: "mov", mimeTypes: ["video/quicktime"] },
  { label: "WebM", extension: "webm", mimeTypes: ["video/webm"] },
  { label: "AVI", extension: "avi", mimeTypes: ["video/x-msvideo", "video/avi", "video/msvideo"] },
];

/** The `accept` attribute: `video/*` first so a phone offers its gallery. */
export const AI_VIDEO_ACCEPT = [
  "video/*",
  ...AI_VIDEO_FORMATS.flatMap((f) => f.mimeTypes),
  ...AI_VIDEO_FORMATS.map((f) => `.${f.extension}`),
].join(",");

export const AI_VIDEO_FORMAT_LINE = AI_VIDEO_FORMATS.map((f) => f.label).join(" · ");

/* ───────────────────────────── image ─────────────────────────────────────── */

/**
 * 20 MB. A full-resolution phone photo is 3–8 MB; a RAW export is not a
 * reference photo and is refused by format before it is refused by size.
 */
export const AI_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * ── 🔴 NO HEIC (yet) ────────────────────────────────────────────────────
 * iPhones shoot HEIC by default. A browser cannot decode it, so the preview
 * step — which is where the member checks the face is clear — would show a
 * broken image. iOS converts on share when the picker's `accept` names only
 * these types, which is the reason the accept string below is explicit
 * rather than `image/*` alone.
 */
export const AI_IMAGE_FORMATS: readonly AiMediaFormat[] = [
  { label: "JPG", extension: "jpg", mimeTypes: ["image/jpeg", "image/jpg", "image/pjpeg"] },
  { label: "JPEG", extension: "jpeg", mimeTypes: ["image/jpeg"] },
  { label: "PNG", extension: "png", mimeTypes: ["image/png"] },
  { label: "WebP", extension: "webp", mimeTypes: ["image/webp"] },
];

export const AI_IMAGE_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  ...AI_IMAGE_FORMATS.map((f) => `.${f.extension}`),
].join(",");

/** "JPG · PNG · WebP" — JPEG is the same format twice and is not listed twice. */
export const AI_IMAGE_FORMAT_LINE = AI_IMAGE_FORMATS.filter((f) => f.label !== "JPEG")
  .map((f) => f.label)
  .join(" · ");

/* ───────────────────────────── refusals ──────────────────────────────────── */

export type AiMediaErrorCode =
  | "unsupported-file"
  | "file-too-large"
  | "invalid-video"
  | "video-too-short"
  | "video-resolution-too-large"
  | "video-resolution-too-small"
  | "unsupported-image"
  | "image-too-large"
  | "image-too-small"
  | "invalid-image"
  | "invalid-url"
  | "upload-failed"
  | "processing-failed";

export interface AiMediaErrorCopy {
  title: string;
  body: string;
  action: string;
}

export const AI_MEDIA_ERRORS: Record<AiMediaErrorCode, AiMediaErrorCopy> = {
  "unsupported-file": {
    title: "That file won't work",
    body: `Frenz AI takes video files — ${AI_VIDEO_FORMAT_LINE}.`,
    action: "Choose another video",
  },
  "file-too-large": {
    title: "That video is too large",
    body: `Videos need to be under ${Math.round(AI_VIDEO_MAX_BYTES / (1024 * 1024))} MB for now. A shorter clip or a smaller export will work.`,
    action: "Choose another video",
  },
  "invalid-video": {
    title: "We couldn't read this video",
    body: "The file looks like a video but your device couldn't open it. Try another MP4 or MOV file.",
    action: "Choose another video",
  },
  "video-too-short": {
    title: "That video is too short",
    body: "There isn't enough footage to work with. Choose a video that runs for at least a second.",
    action: "Choose another video",
  },
  "video-resolution-too-large": {
    title: "That video is too large to process",
    body: "Videos above 4K resolution can't be processed yet. A 1080p export of the same clip will work.",
    action: "Choose another video",
  },
  "video-resolution-too-small": {
    title: "That video is too small",
    body: "The picture is too low-resolution for a convincing result. Choose a clearer export, at least 240 pixels on the shorter side.",
    action: "Choose another video",
  },
  "unsupported-image": {
    title: "That photo won't work",
    body: `Use a photo file — ${AI_IMAGE_FORMAT_LINE}.`,
    action: "Choose another photo",
  },
  "image-too-large": {
    title: "That photo is too large",
    body: `Photos need to be under ${Math.round(AI_IMAGE_MAX_BYTES / (1024 * 1024))} MB. A normal camera photo is well within that.`,
    action: "Choose another photo",
  },
  "image-too-small": {
    title: "That photo is too small",
    body: "The face would be too small to carry across. Choose a photo at least 256 pixels on the shorter side.",
    action: "Choose another photo",
  },
  "invalid-image": {
    title: "We couldn't read that photo",
    body: "The file looks like a photo but your device couldn't open it. It may be damaged or only partly downloaded.",
    action: "Choose another photo",
  },
  "invalid-url": {
    title: "That link doesn't look right",
    body: "Paste a full web address, starting with https://",
    action: "Try another link",
  },
  "upload-failed": {
    title: "Something went wrong",
    body: "We couldn't use this file. Try another one.",
    action: "Choose another file",
  },
  "processing-failed": {
    title: "Something went wrong",
    body: "The job didn't finish. Nothing was charged — you can try again.",
    action: "Try again",
  },
};

/* ───────────────────────────── inspection ────────────────────────────────── */

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export type AiMediaVerdict = { ok: true } | { ok: false; code: AiMediaErrorCode };

/**
 * Is this a video we take? Kind first, then size, then "is there anything in
 * it" — in that order, because "too large" is only a useful thing to say once
 * we know it is a video at all.
 *
 * An empty MIME type is accepted when the extension is known: Android's
 * document picker reports no type constantly, and refusing that would make
 * the tool unusable on the devices it is built for.
 */
export function inspectVideoFile(file: { name: string; size: number; type: string }): AiMediaVerdict {
  const type = file.type.toLowerCase();
  const ext = fileExtension(file.name);
  const known = AI_VIDEO_FORMATS.some((f) => f.mimeTypes.includes(type) || f.extension === ext);
  if (!known) return { ok: false, code: "unsupported-file" };
  // Size last: "too large" is only useful once we know it is a video at all.
  if (file.size > AI_VIDEO_MAX_BYTES) return { ok: false, code: "file-too-large" };
  if (file.size === 0) return { ok: false, code: "invalid-video" };
  return { ok: true };
}

/** The same shape and the same order, for the reference photo. */
export function inspectImageFile(file: { name: string; size: number; type: string }): AiMediaVerdict {
  const type = file.type.toLowerCase();
  const ext = fileExtension(file.name);
  const known = AI_IMAGE_FORMATS.some((f) => f.mimeTypes.includes(type) || f.extension === ext);
  if (!known) return { ok: false, code: "unsupported-image" };
  if (file.size > AI_IMAGE_MAX_BYTES) return { ok: false, code: "image-too-large" };
  if (file.size === 0) return { ok: false, code: "invalid-image" };
  return { ok: true };
}

/**
 * A pasted link, normalised, or null. Nothing is FETCHED here — this only
 * decides whether the string is a web address at all. The server's allow-list
 * (lib/ai/source-url.ts) decides whether it is one we will go and get.
 */
export function parseVideoUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  /*
    A bare path is not a link, and prefixing one produces nonsense: the URL
    parser collapses the extra slashes in `https:///clip.mp4` and hands back
    `https://clip.mp4/` — a host invented out of a filename, which then passes
    every check below. Caught by the test, not by reading.
  */
  if (/^[/\\]/.test(trimmed)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // A host with no dot is a hostname on a local network at best, and far more
  // often a word someone typed by accident.
  if (!url.hostname.includes(".") || url.hostname.endsWith(".")) return null;
  return url.toString();
}

export function formatResolution(width: number | null, height: number | null): string | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  return `${Math.round(width)} × ${Math.round(height)}`;
}

/** "1:24" for 84 seconds; "12:05" for 725. Never fractional. */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.round(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The extension a stored source object gets. From the NAME first, because a
 * file called `clip.mov` typed `video/mp4` by a confused picker is a MOV; then
 * from the MIME type; then the platform's default container.
 *
 * 🔴 The result is written into the storage key when the upload ticket is
 * minted and read back from the row — never re-derived later — because the
 * first version did re-derive it and looked for a `.mp4` that had been
 * uploaded as `.mov`.
 */
export function extensionForUpload(name: string | undefined, mimeType: string): string {
  const fromName = name ? fileExtension(name) : "";
  if (AI_VIDEO_FORMATS.some((f) => f.extension === fromName)) return fromName;
  const mime = mimeType.trim().toLowerCase();
  const byMime = AI_VIDEO_FORMATS.find((f) => f.mimeTypes.includes(mime));
  if (byMime) return byMime.extension;
  return "mp4";
}

/** The same rule for the reference photo; `jpg` is the default container. */
export function imageExtensionForUpload(name: string | undefined, mimeType: string): string {
  const fromName = name ? fileExtension(name) : "";
  if (AI_IMAGE_FORMATS.some((f) => f.extension === fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  const mime = mimeType.trim().toLowerCase();
  const byMime = AI_IMAGE_FORMATS.find((f) => f.mimeTypes.includes(mime));
  if (byMime) return byMime.extension === "jpeg" ? "jpg" : byMime.extension;
  return "jpg";
}

/** The extension a replacement audio upload is stored under (Part 6). From the name, then the type; "mp3" as the last resort. */
export function audioExtensionForUpload(name: string | undefined, mimeType: string): string {
  const known = ["mp3", "wav", "m4a", "aac", "ogg", "opus"];
  const fromName = name ? fileExtension(name) : "";
  if (known.includes(fromName)) return fromName;
  const mime = mimeType.trim().toLowerCase();
  if (mime === "audio/mpeg" || mime === "audio/mp3") return "mp3";
  if (/wav/.test(mime)) return "wav";
  if (mime === "audio/mp4" || /m4a/.test(mime)) return "m4a";
  if (/aac/.test(mime)) return "aac";
  if (/ogg|opus/.test(mime)) return "ogg";
  return "mp3";
}

/**
 * The name a finished video lands under in a Downloads folder.
 *
 * The member's own name is kept, with a suffix that says what happened to it:
 * "holiday-frenz-ai.mp4" in a folder of thirty downloads is findable;
 * "frenz-ai-9f2c1b8e.mp4" is not.
 *
 * 🔴 `\p{M}` — COMBINING MARKS — belongs in the allow-list, and a test caught
 * its absence. Without it "Ọjọ́" became "Ọjọ": the acute accent is its own
 * code point, so an allow-list of letters and numbers alone silently rewrites
 * every Yoruba, Igbo, Vietnamese or Hindi name it touches. On a product built
 * in Nigeria that is not an edge case, it is the common one.
 */
export function resultFileName(sourceName: string | null, suffix = "frenz-ai"): string {
  const base = (sourceName ?? "")
    .replace(/\.[^.]*$/, "")
    .replace(/[^\p{L}\p{M}\p{N} ._-]/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
  return base ? `${base}-${suffix}.mp4` : "frenz-ai-video.mp4";
}

/**
 * The suffix a finished file carries, by tool. Takes a string rather than
 * `AiFeature` because `lib/ai/jobs.ts` imports this module — a typed import
 * the other way would be a cycle — and an unknown tool simply gets the
 * product name.
 */
export function resultSuffixFor(feature: string): string {
  switch (feature) {
    case "ai_character_replace":
      return "replaced";
    case "ai_clean":
      return "cleaned";
    default:
      return "frenz-ai";
  }
}
