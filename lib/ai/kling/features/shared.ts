import {
  KLING_OMNI,
  KLING_OMNI_MODES,
  KLING_OMNI_ASPECT_RATIOS,
  klingDurationValue,
  klingOmniImageBudget,
  type KlingOmniFrameType,
  type KlingOmniReferType,
} from "@/lib/ai/kling/features/capabilities";
import { invalid, ok, type KlingCommonOptions, type KlingValidation } from "@/lib/ai/kling/features/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT EVERY OMNI HANDLER SHARES — and deliberately nothing more
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The line this file must not cross: it holds rules that are TRUE OF THE
 * MODEL (a duration window, a URL that must be https, the image budget the
 * vendor sets), never rules that are true of a FEATURE. "Text to Video needs
 * a prompt" lives in text-to-video.ts; "a duration outside 3–15 s is refused"
 * lives here, because every handler would otherwise copy it and one of them
 * would copy it wrong.
 *
 * Everything is pure. No `server-only`, no imports from the client, no
 * network, no clock — so a handler's validation is testable on its own.
 */

/* ──────────────────────────── small validators ───────────────────────────── */

/**
 * An input URL.
 *
 * 🔴 https only, and nothing that could be a local address. These strings are
 * handed to a third party that will fetch them; a caller that could pass
 * `http://169.254.169.254/...` would be asking Kling to read our metadata
 * service and hand us the result. The URLs a real caller passes are our own
 * short-lived signed storage links (lib/ai/storage-server.ts), which already
 * satisfy this — the check is here for the day something else calls a handler.
 */
export function validateMediaUrl(value: string, what: string): KlingValidation {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid(`${what} is not a URL.`);
  }
  if (url.protocol !== "https:") return invalid(`${what} must be an https URL.`);
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return invalid(`${what} must be a public https URL.`);
  }
  return ok;
}

export function validatePrompt(prompt: string | null | undefined, opts: { required: boolean; what?: string } = { required: true }): KlingValidation {
  const what = opts.what ?? "The prompt";
  const text = (prompt ?? "").trim();
  if (!text) return opts.required ? invalid(`${what} is required.`) : ok;
  if (text.length > KLING_OMNI.prompt.maxChars) return invalid(`${what} is longer than ${KLING_OMNI.prompt.maxChars} characters.`);
  return ok;
}

/** The shared settings, checked once. A handler calls this before its own rules. */
export function validateCommonOptions(options: KlingCommonOptions | undefined): KlingValidation {
  if (!options) return ok;

  if (options.durationSeconds !== undefined) {
    const d = options.durationSeconds;
    if (!Number.isFinite(d) || !Number.isInteger(d)) return invalid("The duration must be a whole number of seconds.");
    if (d < KLING_OMNI.duration.minSeconds || d > KLING_OMNI.duration.maxSeconds) {
      return invalid(`This engine makes videos between ${KLING_OMNI.duration.minSeconds} and ${KLING_OMNI.duration.maxSeconds} seconds.`);
    }
  }
  if (options.mode !== undefined && !KLING_OMNI_MODES.includes(options.mode)) return invalid("That quality isn't one this engine offers.");
  if (options.aspectRatio !== undefined && !KLING_OMNI_ASPECT_RATIOS.includes(options.aspectRatio)) return invalid("That aspect ratio isn't one this engine offers.");
  if (options.sound !== undefined && options.sound !== "on" && options.sound !== "off") return invalid("The sound setting must be on or off.");

  const negative = validatePrompt(options.negativePrompt, { required: false, what: "The negative prompt" });
  if (!negative.ok) return negative;
  return ok;
}

/**
 * 🔴 The vendor's rule, in one place: native audio may not be requested
 * alongside a reference video. Two handlers accept a video and both must obey
 * it, so neither gets to remember it.
 */
export function validateSoundWithVideo(options: KlingCommonOptions | undefined, hasVideo: boolean): KlingValidation {
  if (!hasVideo || options?.sound !== "on") return ok;
  if (KLING_OMNI.soundAllowedWithVideo) return ok;
  return invalid("Generated sound isn't available when a reference video is used. Turn sound off, or remove the video.");
}

export interface KlingImageRef {
  url: string;
  /** Which end of the clip this image pins. Omitted = an ordinary reference. */
  frame?: KlingOmniFrameType;
}

/** The image list, against the budget the vendor sets — which depends on the video and the elements. */
export function validateImageRefs(images: readonly KlingImageRef[], opts: { hasVideo: boolean; elementCount: number; required: boolean }): KlingValidation {
  if (images.length === 0) return opts.required ? invalid("At least one image is required.") : ok;

  const budget = klingOmniImageBudget({ hasVideo: opts.hasVideo, elementCount: opts.elementCount });
  if (images.length > budget) {
    return invalid(
      opts.hasVideo
        ? `With a video, this engine takes ${KLING_OMNI.images.withVideo.maxImagesAndElementsCombined} references in total (images and characters together).`
        : `This engine takes up to ${KLING_OMNI.images.withoutVideo.max} reference images.`,
    );
  }
  for (const image of images) {
    const verdict = validateMediaUrl(image.url, "A reference image");
    if (!verdict.ok) return verdict;
    if (image.frame !== undefined && !KLING_OMNI.images.frameTypes.includes(image.frame)) return invalid("That frame position isn't one this engine offers.");
  }
  const firsts = images.filter((i) => i.frame === "first_frame").length;
  const ends = images.filter((i) => i.frame === "end_frame").length;
  if (firsts > 1) return invalid("Only one image can be the first frame.");
  if (ends > 1) return invalid("Only one image can be the last frame.");
  return ok;
}

export interface KlingVideoRefInput {
  url: string;
  referType: KlingOmniReferType;
  keepOriginalSound?: boolean;
  /** Measured by our worker, not claimed by a browser. Omitted = unmeasured, and then unchecked. */
  durationSeconds?: number;
  bytes?: number;
}

/**
 * The reference video.
 *
 * ⚠️ The duration window here is the VIDEO's (3–10 s), which is NOT the
 * output's (3–15 s). Omni lengthened what it can produce without lengthening
 * what it will read. Conflating the two is the mistake this function exists
 * to make impossible.
 */
export function validateVideoRef(video: KlingVideoRefInput): KlingValidation {
  const urlVerdict = validateMediaUrl(video.url, "The video");
  if (!urlVerdict.ok) return urlVerdict;
  if (!KLING_OMNI.video.referTypes.includes(video.referType)) return invalid("That video reference type isn't one this engine offers.");

  if (video.durationSeconds !== undefined) {
    if (!Number.isFinite(video.durationSeconds) || video.durationSeconds <= 0) return invalid("The video's length could not be measured.");
    if (video.durationSeconds < KLING_OMNI.video.minSeconds) return invalid(`This engine needs at least ${KLING_OMNI.video.minSeconds} seconds of video.`);
    if (video.durationSeconds > KLING_OMNI.video.maxSeconds) return invalid(`This engine reads up to ${KLING_OMNI.video.maxSeconds} seconds of video. Trim your clip and try again.`);
  }
  if (video.bytes !== undefined && video.bytes > KLING_OMNI.video.maxBytes) {
    return invalid(`This engine takes videos up to ${Math.round(KLING_OMNI.video.maxBytes / (1024 * 1024))} MB.`);
  }
  return ok;
}

export interface KlingElementInputRef {
  /** Several angles of ONE subject. Never two people — that would be two elements. */
  imageUrls: readonly string[];
  /** A short clip of the subject instead of stills. */
  clipUrl?: string;
  clipDurationSeconds?: number;
  /** Speech bound to this element. */
  voiceUrl?: string;
  voiceDurationSeconds?: number;
}

export function validateElementRef(element: KlingElementInputRef, index: number): KlingValidation {
  const label = `Character ${index + 1}`;
  const hasImages = element.imageUrls.length > 0;
  const hasClip = !!element.clipUrl;
  if (!hasImages && !hasClip) return invalid(`${label} needs at least one photo, or a short clip.`);
  if (element.imageUrls.length > KLING_OMNI.element.maxImagesPerElement) {
    return invalid(`${label} can have up to ${KLING_OMNI.element.maxImagesPerElement} photos.`);
  }
  for (const url of element.imageUrls) {
    const verdict = validateMediaUrl(url, `${label}'s photo`);
    if (!verdict.ok) return verdict;
  }
  if (element.clipUrl) {
    const verdict = validateMediaUrl(element.clipUrl, `${label}'s clip`);
    if (!verdict.ok) return verdict;
    const d = element.clipDurationSeconds;
    if (d !== undefined && (d < KLING_OMNI.element.clip.minSeconds || d > KLING_OMNI.element.clip.maxSeconds)) {
      return invalid(`${label}'s clip should be between ${KLING_OMNI.element.clip.minSeconds} and ${KLING_OMNI.element.clip.maxSeconds} seconds.`);
    }
  }
  if (element.voiceUrl) {
    const verdict = validateMediaUrl(element.voiceUrl, `${label}'s voice`);
    if (!verdict.ok) return verdict;
    const d = element.voiceDurationSeconds;
    if (d !== undefined && (d < KLING_OMNI.element.voice.minSeconds || d > KLING_OMNI.element.voice.maxSeconds)) {
      return invalid(`${label}'s voice should be between ${KLING_OMNI.element.voice.minSeconds} and ${KLING_OMNI.element.voice.maxSeconds} seconds.`);
    }
  }
  return ok;
}

/* ─────────────────────────── request fragments ───────────────────────────── */

/**
 * The settings every Omni body carries.
 *
 * 🔴 An omitted option is OMITTED, not defaulted here. Sending `duration: "5"`
 * because nobody chose one silently overrides whatever the vendor's own
 * default becomes, and a future default change would never reach us. The
 * exception is documented per call site.
 */
export function commonRequestFields(options: KlingCommonOptions | undefined): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (!options) return body;
  if (options.durationSeconds !== undefined) body.duration = klingDurationValue(options.durationSeconds);
  if (options.mode !== undefined) body.mode = options.mode;
  if (options.aspectRatio !== undefined) body.aspect_ratio = options.aspectRatio;
  if (options.sound !== undefined) body.sound = options.sound;
  const negative = options.negativePrompt?.trim();
  if (negative) body.negative_prompt = negative;
  return body;
}

export function imageListField(images: readonly KlingImageRef[]): Record<string, unknown>[] {
  return images.map((image) => ({ image: image.url, ...(image.frame ? { type: image.frame } : {}) }));
}

export function videoListField(videos: readonly KlingVideoRefInput[]): Record<string, unknown>[] {
  return videos.map((video) => ({
    video: video.url,
    refer_type: video.referType,
    ...(video.keepOriginalSound === undefined ? {} : { keep_original_sound: video.keepOriginalSound }),
  }));
}

export function elementListField(elements: readonly KlingElementInputRef[]): Record<string, unknown>[] {
  return elements.map((element, i) => ({
    element_id: i + 1,
    ...(element.imageUrls.length ? { images: element.imageUrls.slice() } : {}),
    ...(element.clipUrl ? { video: element.clipUrl } : {}),
    ...(element.voiceUrl ? { audio: element.voiceUrl } : {}),
  }));
}
