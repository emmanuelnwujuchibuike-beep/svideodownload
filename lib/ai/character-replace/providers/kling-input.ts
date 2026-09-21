import type { ReplacementMode } from "@/lib/ai/character-replace/modes";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KLING O1 VIDEO EDIT — the input, its limits, its prompt (pure, tested)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Read from the endpoint's published schema on 2026-09-21
 * (fal-ai/kling-video/o1/standard/video-to-video/edit, `OmniV2VEditInput`):
 *
 *   prompt        string, required — "Use @Element1, @Element2 to reference
 *                 elements and @Image1, @Image2 to reference images in order."
 *   video_url     string, required — "Only .mp4/.mov formats supported, 3-10
 *                 seconds duration, 720-2160px resolution, max 200MB.
 *                 Min duration 3.0s, Max duration 10.05s, Min FPS 24, Max FPS 60"
 *   elements      OmniVideoElementInput[] — { frontal_image_url (required;
 *                 ≤ 10 MB, ≥ 300 px, aspect 0.40–2.50), reference_image_urls?
 *                 (1–3, "different angles") } — "Maximum 4 total (elements +
 *                 reference images) when using video"
 *   image_urls    string[] — style/appearance references (@Image1 …), same cap
 *   keep_audio    boolean — "Whether to keep the original audio from the video"
 *
 * Output: `{ video: { url, content_type, file_name, file_size } }`.
 *
 * ── The character-reference architecture (§6) ───────────────────────────────
 *
 * The member's photo is ELEMENT 1's frontal image — the identity the model
 * carries through the clip. Extra photos (Face + Head-style multi-reference
 * uploads are not a fal scope, but Full Character may one day allow two)
 * become the element's `reference_image_urls` (different angles of the same
 * person), never separate elements: a second element would be a second
 * character. Nothing goes in `image_urls` — a style image would pull the
 * scene, and §6 says do not alter the source scene.
 *
 * ── The prompt (§6) ─────────────────────────────────────────────────────────
 *
 * One sentence per scope, provider-specific and kept HERE. It names the
 * transformation and lists everything to preserve — movement, body motion,
 * expressions, camera, framing, composition, lighting, environment, timing —
 * as the brief asks. Not hard-coded elsewhere; a better wording found in
 * testing changes this file only.
 */

export const KLING_O1_EDIT_LIMITS = {
  minDurationMs: 3_000,
  /** The schema's validation boundary is 10.05 s; the member-facing ceiling is 10 s. */
  maxDurationMs: 10_050,
  maxDurationSecondsForMembers: 10,
  minEdgePx: 720,
  maxEdgePx: 2160,
  maxBytes: 200 * 1024 * 1024,
  minFps: 24,
  maxFps: 60,
  containers: ["video/mp4", "video/quicktime"] as const,
  maxElementsAndImages: 4,
  element: { maxBytes: 10 * 1024 * 1024, minEdgePx: 300, minAspect: 0.4, maxAspect: 2.5, maxReferenceImages: 3 },
} as const;

export interface KlingElementInput {
  frontal_image_url: string;
  reference_image_urls?: string[];
}

export interface KlingEditInput {
  prompt: string;
  video_url: string;
  elements?: KlingElementInput[];
  image_urls?: string[];
  keep_audio?: boolean;
}

export const KLING_EDIT_INPUT_FIELDS = ["prompt", "video_url", "elements", "image_urls", "keep_audio"] as const;

const PRESERVE =
  "Keep the original video exactly as it is in every other way: the same movements and body motion, the same facial expressions and timing, the same camera movement, framing and scene composition, the same lighting, background and environment. Do not add, remove or restyle anything else. Keep the person's identity consistent in every frame.";

/** The scope's sentence. Only the scopes the adapter claims have one; the others throw so a mis-route cannot invent a prompt. */
export function klingEditPrompt(mode: ReplacementMode): string {
  switch (mode) {
    case "full_character":
      return `Replace the person in the video with @Element1 — the same face, hair, skin, body and clothing as @Element1, matching the original person's pose and movements. ${PRESERVE}`;
    case "upper_body":
      return `Replace the person in the video with @Element1 — the face, hair, torso and clothing as @Element1 — matching the original person's pose and movements. ${PRESERVE}`;
    default:
      throw new Error(`Kling O1 Video Edit has no prompt for ${mode}: the scope is not in its capability mapping`);
  }
}

function https(url: string, what: string): string {
  if (!/^https:\/\//.test(url)) throw new Error(`${what} must be an https url`);
  return url;
}

export function buildKlingEditInput(req: { mode: ReplacementMode; videoUrl: string; referenceImageUrls: readonly string[]; keepAudio: boolean }): KlingEditInput {
  const refs = req.referenceImageUrls.filter((u) => typeof u === "string" && u.length > 0);
  if (!refs.length) throw new Error("Kling O1 Video Edit needs the character photo as element 1");
  // One element (one character) + its other angles; the schema's cap counts elements AND images together.
  const others = refs.slice(1, 1 + KLING_O1_EDIT_LIMITS.element.maxReferenceImages);
  if (1 + others.length > KLING_O1_EDIT_LIMITS.maxElementsAndImages) throw new Error("too many reference images for the model");
  const element: KlingElementInput = { frontal_image_url: https(refs[0]!, "the character photo") };
  if (others.length) element.reference_image_urls = others.map((u) => https(u, "a reference photo"));
  return {
    prompt: klingEditPrompt(req.mode),
    video_url: https(req.videoUrl, "the video"),
    elements: [element],
    keep_audio: req.keepAudio === true,
  };
}

/** A member-facing sentence for a limit, once, in one place. */
export const KLING_LIMIT_MESSAGES = {
  tooLong: `This engine works on clips of up to ${KLING_O1_EDIT_LIMITS.maxDurationSecondsForMembers} seconds. Trim your video to ${KLING_O1_EDIT_LIMITS.maxDurationSecondsForMembers} seconds or less — nothing has been charged.`,
  tooShort: `This engine needs at least ${KLING_O1_EDIT_LIMITS.minDurationMs / 1000} seconds of video — nothing has been charged.`,
  container: "This engine takes MP4 or MOV video. Export the clip as MP4 and try again — nothing has been charged.",
  tooBig: "This engine takes videos up to 200 MB. Use a smaller export — nothing has been charged.",
} as const;

export type KlingSelectionVerdict = { ok: true } | { ok: false; code: "too_long" | "too_short" | "container" | "too_big"; message: string };

/**
 * §5 / §29: BEFORE BILLING. The selected (trimmed) length, the upload's
 * container and its size decide whether a job may even be paid for. A video
 * over the ceiling is not cut — the sentence sends the member to the trim
 * workflow, which is how they choose what the 10 seconds are.
 */
export function klingSelectionVerdict(facts: { selectedDurationMs: number; mime: string | null | undefined; bytes: number | null | undefined }): KlingSelectionVerdict {
  if (facts.selectedDurationMs > KLING_O1_EDIT_LIMITS.maxDurationMs) return { ok: false, code: "too_long", message: KLING_LIMIT_MESSAGES.tooLong };
  if (facts.selectedDurationMs < KLING_O1_EDIT_LIMITS.minDurationMs) return { ok: false, code: "too_short", message: KLING_LIMIT_MESSAGES.tooShort };
  const mime = (facts.mime ?? "").toLowerCase().split(";")[0]!.trim();
  // The worker re-encodes to MP4 anyway; the check is on the UPLOAD so a member is told before paying rather than after a re-encode surprises them.
  if (mime && !(KLING_O1_EDIT_LIMITS.containers as readonly string[]).includes(mime)) return { ok: false, code: "container", message: KLING_LIMIT_MESSAGES.container };
  if (typeof facts.bytes === "number" && facts.bytes > KLING_O1_EDIT_LIMITS.maxBytes) return { ok: false, code: "too_big", message: KLING_LIMIT_MESSAGES.tooBig };
  return { ok: true };
}

export interface KlingPreparedFacts {
  durationMs: number;
  width: number;
  height: number;
  bytes: number;
  fps?: number | null;
}

/** BEFORE SUBMISSION: the prepared file the worker measured must sit inside every documented limit, or nothing is sent. */
export function validateKlingInputFacts(f: KlingPreparedFacts): { ok: true } | { ok: false; reason: string } {
  const L = KLING_O1_EDIT_LIMITS;
  if (f.durationMs < L.minDurationMs) return { ok: false, reason: `${f.durationMs} ms is under the 3 s minimum` };
  if (f.durationMs > L.maxDurationMs) return { ok: false, reason: `${f.durationMs} ms is over the 10.05 s maximum` };
  if (Math.min(f.width, f.height) < L.minEdgePx) return { ok: false, reason: `${f.width}x${f.height} is under the 720 px minimum edge` };
  if (Math.max(f.width, f.height) > L.maxEdgePx) return { ok: false, reason: `${f.width}x${f.height} is over the 2160 px maximum edge` };
  if (f.bytes > L.maxBytes) return { ok: false, reason: `${f.bytes} bytes is over 200 MB` };
  if (typeof f.fps === "number" && f.fps > 0 && (f.fps < L.minFps - 0.01 || f.fps > L.maxFps + 0.01)) return { ok: false, reason: `${f.fps} fps is outside 24–60` };
  return { ok: true };
}

/** An element image inside the model's limits (checked on the worker's re-encoded reference, before submission). */
export function validateKlingElementImage(f: { width: number; height: number; bytes: number }): { ok: true } | { ok: false; reason: string } {
  const E = KLING_O1_EDIT_LIMITS.element;
  if (Math.min(f.width, f.height) < E.minEdgePx) return { ok: false, reason: `${f.width}x${f.height} is under the 300 px minimum` };
  const aspect = f.width / f.height;
  if (aspect < E.minAspect || aspect > E.maxAspect) return { ok: false, reason: `aspect ${aspect.toFixed(2)} is outside 0.40–2.50` };
  if (f.bytes > E.maxBytes) return { ok: false, reason: `${f.bytes} bytes is over 10 MB` };
  return { ok: true };
}

/**
 * The geometry the worker's prepare step must produce for this model: both
 * edges ≥ 720, long edge ≤ 2160, even numbers. Returns null when the source
 * already fits after the tier's long-edge cap (no extra scaling needed).
 */
export function klingTargetGeometry(source: { width: number; height: number }, tierLongEdge: number): { width: number; height: number } | null {
  const L = KLING_O1_EDIT_LIMITS;
  const long = Math.max(source.width, source.height);
  const short = Math.min(source.width, source.height);
  if (long <= 0 || short <= 0) return null;
  // the tier's cap first (never upload 4K to a 720p tier), then the model's floor and ceiling
  let scale = Math.min(1, tierLongEdge / long);
  if (short * scale < L.minEdgePx) scale = L.minEdgePx / short;
  if (long * scale > L.maxEdgePx) scale = L.maxEdgePx / long;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const w = even(source.width * scale);
  const h = even(source.height * scale);
  if (w === source.width && h === source.height) return null;
  return { width: w, height: h };
}
