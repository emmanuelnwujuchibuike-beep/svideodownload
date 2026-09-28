import {
  KLING_ASPECT_RATIOS,
  KLING_AUDIO_MODES,
  KLING_OMNI,
  KLING_RESOLUTIONS,
  klingDurationValue,
  type KlingContentType,
} from "@/lib/ai/kling/features/capabilities";
import { invalid, ok, type KlingCommonOptions, type KlingValidation } from "@/lib/ai/kling/features/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT EVERY OMNI HANDLER SHARES — and deliberately nothing more
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 4 §2: "Shared infrastructure must NOT become a hidden shared
 * video-processing pipeline."
 *
 * The line this file must not cross: it holds rules that are TRUE OF THE MODEL
 * (the duration window, a URL that must be https, the allowed setting values),
 * never rules that are true of a FEATURE. "Text to Video needs a prompt" lives
 * in text-to-video.ts; "a duration outside 3–15 s is refused" lives here,
 * because every handler would otherwise copy it and one would copy it wrong.
 *
 * There is no request BUILDER for a feature here — only the two fragments every
 * body has (`settings`, and one `contents` item helper). A handler assembles its
 * own `contents` array, in its own order, with its own items.
 *
 * Everything is pure. No `server-only`, no imports from the client, no network,
 * no clock — so a handler's validation is testable on its own.
 */

/* ──────────────────────────── small validators ───────────────────────────── */

/**
 * An input URL.
 *
 * 🔴 https only, and nothing that could be a local address. These strings are
 * handed to a third party that will fetch them; a caller that could pass
 * `http://169.254.169.254/...` would be asking Kling to read our metadata
 * service and hand us the result. The URLs a real caller passes are our own
 * short-lived signed storage links, which already satisfy this — the check is
 * here for the day something else calls a handler.
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

/**
 * The shared settings, checked once. A handler calls this before its own rules.
 *
 * 🔴 The duration window is enforced HERE because the vendor does not enforce it
 * at all: `settings.duration` of `0`, `1` and `20` were all accepted live, and
 * only a non-numeric value is refused. An unenforced range is a member charged
 * for a length the model may silently truncate.
 */
export function validateCommonOptions(options: KlingCommonOptions | undefined): KlingValidation {
  if (!options) return ok;

  if (options.durationSeconds !== undefined) {
    const d = options.durationSeconds;
    if (!Number.isFinite(d) || !Number.isInteger(d)) return invalid("The duration must be a whole number of seconds.");
    if (d < KLING_OMNI.duration.minSeconds || d > KLING_OMNI.duration.maxSeconds) {
      return invalid(`This engine makes videos between ${KLING_OMNI.duration.minSeconds} and ${KLING_OMNI.duration.maxSeconds} seconds.`);
    }
  }
  if (options.resolution !== undefined && !KLING_RESOLUTIONS.includes(options.resolution)) return invalid("That quality isn't one this engine offers.");
  if (options.aspectRatio !== undefined && !KLING_ASPECT_RATIOS.includes(options.aspectRatio)) return invalid("That aspect ratio isn't one this engine offers.");
  if (options.audio !== undefined && !KLING_AUDIO_MODES.includes(options.audio)) {
    /*
      🔴 `original` is a value the VENDOR lists but `kling-v3-omni` refuses:
      "audio mode 'original' is not supported by the current model". Refusing it
      here means a member sees a sentence instead of a provider rejection after
      the charge.
    */
    return invalid("That sound setting isn't one this engine offers.");
  }
  return ok;
}

/**
 * 🔴 The vendor's own rule, verified: `settings.aspect_ratio` is REQUIRED unless
 * a first frame is supplied — "Aspect ratio must be specified unless a first
 * frame is provided or the task is video editing".
 *
 * Checked by us so the refusal is a sentence before the charge, rather than a
 * 400 from Kling after it.
 */
export function validateAspectRatioPresence(options: KlingCommonOptions | undefined, hasFirstFrame: boolean): KlingValidation {
  if (hasFirstFrame || options?.aspectRatio !== undefined) return ok;
  return invalid("Choose a shape for the video (landscape, portrait or square).");
}

/* ─────────────────────────── request fragments ───────────────────────────── */

/**
 * `settings` — the only object every Omni body carries.
 *
 * 🔴 An omitted option is OMITTED, not defaulted here. Sending `duration: 5`
 * because nobody chose one silently overrides whatever the vendor's own default
 * becomes, and a future default change would never reach us.
 */
export function settingsField(options: KlingCommonOptions | undefined): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  if (!options) return settings;
  if (options.durationSeconds !== undefined) settings.duration = klingDurationValue(options.durationSeconds);
  if (options.resolution !== undefined) settings.resolution = options.resolution;
  if (options.aspectRatio !== undefined) settings.aspect_ratio = options.aspectRatio;
  if (options.audio !== undefined) settings.audio = options.audio;
  return settings;
}

/**
 * One `contents` item.
 *
 * ✅ The shape is `{ type, ... }` where `type` is one of the seven verified
 * values, `prompt` carries `text` and every media item carries `url`. Kept as a
 * one-item helper rather than a list builder so no handler can be handed
 * somebody else's `contents` array.
 */
export function contentItem(type: KlingContentType, value: { text?: string; url?: string; elementId?: string }): Record<string, unknown> {
  if (type === "prompt") return { type, text: (value.text ?? "").trim() };
  if (type === "element") return { type, element_id: value.elementId ?? "" };
  return { type, url: value.url ?? "" };
}

/** A prompt item, which every implemented feature sends. */
export function promptItem(text: string): Record<string, unknown> {
  return contentItem("prompt", { text });
}
