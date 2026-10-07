import {
  KLING_ASPECT_RATIOS,
  KLING_AUDIO_MODES,
  KLING_OMNI,
  KLING_VIDEO_RESOLUTIONS,
  klingDurationValue,
  klingMaxReferenceImages,
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
/** One minute is made at 720p or 1080p only — 4k segments are refused before the charge. */
function validateOneMinute(options: KlingCommonOptions): KlingValidation {
  if (options.resolution !== undefined && options.resolution !== "720p" && options.resolution !== "1080p") {
    return invalid("One-minute videos are made at 720p or 1080p.");
  }
  return validateCommonOptions({ ...options, durationSeconds: undefined });
}

export function validateCommonOptions(options: KlingCommonOptions | undefined): KlingValidation {
  if (!options) return ok;

  if (options.durationSeconds !== undefined) {
    const d = options.durationSeconds;
    if (!Number.isFinite(d) || !Number.isInteger(d)) return invalid("The duration must be a whole number of seconds.");
    // 60 = the one-minute option: four 15 s segments chained on the worker (lib/ai/kling/pricing.ts ONE_MINUTE_*).
    if (d === 60) return validateOneMinute(options);
    if (d < KLING_OMNI.duration.minSeconds || d > KLING_OMNI.duration.maxSeconds) {
      return invalid(`This engine makes videos between ${KLING_OMNI.duration.minSeconds} and ${KLING_OMNI.duration.maxSeconds} seconds.`);
    }
  }
  /*
    🔴 Checked against the VIDEO list, not the field's enum. `480p` passes the
    enum and is then refused at generation ("video resolution value '480p' is
    invalid"), so accepting it here would be a refusal after the charge.
  */
  if (options.resolution !== undefined && !(KLING_VIDEO_RESOLUTIONS as readonly string[]).includes(options.resolution)) {
    return invalid("That quality isn't one this engine offers.");
  }
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REFERENCE INPUTS — the rule that depends on TWO fields (2026-10-04)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The vendor, verbatim: "reference_images: Up to 7 reference images (up to 4
 * when also using a reference video)". And exactly one reference video
 * (`KLING_OMNI.video.maxCount`).
 *
 * 🔴 That conditional is why this is here rather than in the zod schema. The
 * wire schema can say "not more than seven" because that is true of the field
 * on its own; it cannot say "not more than four WHEN a video is attached"
 * without encoding a relationship, and a relationship duplicated in two layers
 * is two rules that drift. So the schema rejects what is nonsense always, and
 * this rejects what is nonsense only in combination.
 *
 * It belongs in `shared.ts` by the file's own test: this is a rule TRUE OF THE
 * MODEL, identical for every feature that accepts references, not a step in
 * anybody's pipeline.
 */
export interface KlingReferenceInputs {
  referenceImageUrls?: string[];
  referenceVideoUrl?: string;
  /**
   * What the reference video is FOR (2026-10-06):
   *   "base"    — the video to EDIT: its scene, motion and camera are kept and
   *               the prompt's change is applied to it (Kling `base_video`);
   *   "feature" — a reference for motion / style only (Kling `feature_video`).
   * Default "base" — keeping the clip is what members were asking for.
   */
  referenceVideoMode?: KlingReferenceVideoMode;
  /**
   * The reference video length, measured in the browser at upload. Used ONLY to
   * price an edit: Kling returns (and bills) the base clip length whatever
   * duration is asked (asked 3 s, got 5.04 s, billed 5 s; 2026-10-06).
   */
  referenceVideoSeconds?: number;
}

export type KlingReferenceVideoMode = "base" | "feature";

export function validateReferenceInputs(input: KlingReferenceInputs, options?: KlingCommonOptions): KlingValidation {
  const images = input.referenceImageUrls ?? [];
  const video = input.referenceVideoUrl?.trim() || null;

  if (video) {
    const verdict = validateMediaUrl(video, "The reference video");
    if (!verdict.ok) return verdict;
  }
  // "Keep the video's sound" needs a video to keep it from (Kling refuses it without one)
  if (!video && options?.audio === "original") return invalid("Keep the video's sound needs a reference video. Attach one, or choose another sound setting.");
  /*
    🔴 A minute is four chained 15 s segments — and a reference video makes Kling
    IGNORE the length (it returns the clip's own length), so the chain could
    never be built from it. Refused here, before the charge.
  */
  if (video && options?.durationSeconds === 60) return invalid("A one-minute video can't use a reference video. Choose up to 15 seconds, or remove the video.");

  const max = klingMaxReferenceImages(!!video);
  if (images.length > max) {
    /*
      Two different sentences, because they call for two different actions: with
      a video attached the member can either remove images OR remove the video,
      and a message that only mentions the image count hides the second option.
    */
    return invalid(
      video
        ? `With a reference video you can use up to ${max} reference images. Remove ${images.length - max}, or remove the video to use up to ${KLING_OMNI.images.max}.`
        : `You can use up to ${max} reference images.`,
    );
  }

  for (const [i, url] of images.entries()) {
    const verdict = validateMediaUrl(url, `Reference image ${i + 1}`);
    if (!verdict.ok) return verdict;
  }

  // A duplicate reference is a wasted slot and a wasted surcharge, not an error
  // the vendor would catch — the member is told rather than quietly charged.
  if (new Set(images).size !== images.length) return invalid("The same reference image is attached more than once.");

  return ok;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 THE REFERENCE TYPES THAT KLING ACTUALLY READS (root cause, 2026-10-06)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner: reference image and video "giving a wrong, not related result".
 * They were sent as `{type:"image"}` and `{type:"video"}`. Omni ACCEPTS those
 * types and then ignores them — an `image` url is never even fetched (a broken
 * one still "succeeds"), and a `video` is discarded. Probing the type list
 * found three it never told us about: `refer_image`, `base_video`,
 * `feature_video`. Settled by generation the same night, direct to Kling:
 *
 *   refer_image + "The man in <<<image_1>>> waves…"  → the SAME man, same
 *       sweater, waving in a park (task 936598943772442698, 1.8 units / 3 s);
 *   base_video + refer_image + "Replace the woman in <<<video_1>>> with the
 *       man in <<<image_1>>>…" → the woman replaced by that man, same scene
 *       (task 936598991629459463, 4.5 units / 5 s = 0.9 units/s — Kling's
 *       "with video input" rate).
 *
 * So: images go as `refer_image`, the video as `base_video` (edit it) or
 * `feature_video` (copy its motion/style). The prompt must NAME them — see
 * `bindReferencePrompt` — and a video input requires `multi_shot: false`
 * ("multi_shot is not supported with video input").
 */
export function referenceItems(input: KlingReferenceInputs): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  for (const url of input.referenceImageUrls ?? []) items.push(contentItem("refer_image", { url }));
  const video = input.referenceVideoUrl?.trim();
  if (video) items.push(contentItem(input.referenceVideoMode === "feature" ? "feature_video" : "base_video", { url: video }));
  return items;
}

/** True when a reference video rides along — Kling then bills its "with video input" rate and refuses multi-shot. */
export function hasReferenceVideo(input: KlingReferenceInputs): boolean {
  return !!input.referenceVideoUrl?.trim();
}

/**
 * The prompt with its references NAMED, which is how Omni binds them
 * (`<<<image_1>>>`, `<<<video_1>>>` — numbered in the order of `contents`).
 * A member writes "put me in this video", not placeholder syntax, so when the
 * prompt names none of them the binding is added here. A prompt that already
 * names them (a power user) is sent exactly as typed.
 */
export function bindReferencePrompt(prompt: string, input: KlingReferenceInputs): string {
  const text = prompt.trim();
  const images = input.referenceImageUrls?.length ?? 0;
  const video = hasReferenceVideo(input);
  const parts: string[] = [];
  if (video && !text.includes("<<<video_1>>>")) {
    parts.push(
      input.referenceVideoMode === "feature"
        ? "Follow the motion, camera movement and style of <<<video_1>>>."
        : "Edit <<<video_1>>>: keep its scene, background, lighting, motion and camera movement unless asked otherwise.",
    );
  }
  if (text) parts.push(text);
  if (images > 0 && !/<<<image_\d+>>>/.test(text)) {
    const names = Array.from({ length: images }, (_, i) => `<<<image_${i + 1}>>>`).join(", ");
    parts.push(images === 1 ? `Use the subject from ${names}.` : `Use the subjects from ${names}.`);
  }
  return parts.join(" ");
}
