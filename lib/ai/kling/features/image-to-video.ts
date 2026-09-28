import { KLING_OMNI_MODEL_NAME } from "@/lib/ai/kling/features/capabilities";
import { contentItem, promptItem, settingsField, validateCommonOptions, validateMediaUrl, validatePrompt } from "@/lib/ai/kling/features/shared";
import { invalid, ok, type KlingCommonOptions, type KlingFeatureHandler } from "@/lib/ai/kling/features/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  IMAGE → VIDEO on Kling 3.0 Omni — a picture BECOMES the clip
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ✅ **Fields verified, 2026-09-28.** The vendor validates both frame items and
 * genuinely FETCHES the url:
 *
 *   {"type":"first_frame"}            → "content item of type 'first_frame' must have a non-blank url"
 *   {"type":"last_frame"}             → "content item of type 'last_frame' must have a non-blank url"
 *   first_frame with an unreachable url → the task is accepted and then FAILS with
 *       "Something went wrong when we tried to get the contents of the file."
 *       and `billing: [{"amount":"0"}]`
 *
 * That last line is the proof the url is actually read — and incidentally proves
 * **a task that fails before generating is not billed**, which the refund path
 * can rely on.
 *
 * ⚠️ `verification: "fields"` rather than `"generation"`: no completed run from a
 * REACHABLE image has been made, because that spends the owner's money and was
 * not authorised. The run is listed in the contract document §7 as #1.
 *
 * ── 🔴 `last_frame`, NOT `end_frame` ────────────────────────────────────────
 *
 * Part 3 guessed `end_frame`, which the live API rejects outright
 * (`contents[i].type value 'end_frame' is invalid`). Every two-frame request it
 * built would have 400'd.
 *
 * ── 🔴 THIS IS NOT THE SAME FEATURE AS A REFERENCE IMAGE ────────────────────
 *
 * A FRAME is where the clip literally starts or ends — the output opens on that
 * exact picture. A REFERENCE is a subject or a look the model consults but never
 * draws as a frame. Handling both in one builder would mean a boolean deciding
 * whether a member's photo is shown or merely consulted — a coin flip on what
 * they get. (As it happens the reference kind is not available at all on this
 * API; see unavailable.ts.)
 *
 * ── Why no aspect ratio is required here ────────────────────────────────────
 *
 * ✅ The vendor's own rule: "Aspect ratio must be specified unless a first frame
 * is provided". The frame defines the shape, so an aspect ratio is optional —
 * and is left out of the body entirely unless the caller set one.
 */

export interface KlingImageToVideoInput {
  /** The picture the clip starts on. */
  firstFrameUrl: string;
  /** Optional: the picture it ends on. The model interpolates between them. */
  lastFrameUrl?: string;
  /** What should happen between the frames. Optional — the frames alone are an instruction. */
  prompt?: string;
  options?: KlingCommonOptions;
}

export const klingImageToVideo: KlingFeatureHandler<KlingImageToVideoInput> = {
  id: "image_to_video",
  label: "Image to Video",
  available: true,
  unavailableReason: null,
  verification: "fields",
  model: KLING_OMNI_MODEL_NAME,

  validate(input) {
    if (!input.firstFrameUrl?.trim()) return invalid("Choose the photo the video should start from.");

    const first = validateMediaUrl(input.firstFrameUrl, "The starting photo");
    if (!first.ok) return first;

    if (input.lastFrameUrl?.trim()) {
      const last = validateMediaUrl(input.lastFrameUrl, "The ending photo");
      if (!last.ok) return last;
    }

    const common = validateCommonOptions(input.options);
    if (!common.ok) return common;

    const prompt = validatePrompt(input.prompt, { required: false });
    if (!prompt.ok) return prompt;

    // A first frame is present, so the aspect ratio is genuinely optional here.
    return ok;
  },

  buildRequest(input) {
    const contents: Record<string, unknown>[] = [];
    const prompt = input.prompt?.trim();
    if (prompt) contents.push(promptItem(prompt));
    contents.push(contentItem("first_frame", { url: input.firstFrameUrl }));
    if (input.lastFrameUrl?.trim()) contents.push(contentItem("last_frame", { url: input.lastFrameUrl }));

    return { contents, settings: settingsField(input.options) };
  },
};
