import { KLING_OMNI_MODEL_NAME } from "@/lib/ai/kling/features/capabilities";
import { bindReferencePrompt, contentItem, hasReferenceVideo, promptItem, referenceItems, settingsField, validateCommonOptions, validateMediaUrl, validatePrompt, validateReferenceInputs, type KlingReferenceInputs } from "@/lib/ai/kling/features/shared";
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
 * ✅ **AND VERIFIED BY GENERATION, 2026-09-28.** A reachable portrait was sent as
 * `first_frame` at 720p/3s with the prompt "slow gentle camera push in". The
 * output was that exact photograph, animated — the same person, clothing,
 * lighting and background, faithfully preserved. 1.8 units.
 *
 * 🔴 It is the ONLY input type Omni genuinely honours. A `video` item is
 * discarded and a plain `image` item is ignored (see unavailable.ts), so
 * "the picture becomes the clip" is the real, and the only, image capability.
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

export interface KlingImageToVideoInput extends KlingReferenceInputs {
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
  verification: "generation",
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

    // 7 images, or 4 alongside a reference video — the vendor rule, in one place.
    const refs = validateReferenceInputs(input);
    if (!refs.ok) return refs;

    // A first frame is present, so the aspect ratio is genuinely optional here.
    return ok;
  },

  buildRequest(input) {
    /*
      🔴 References bound and typed the way Omni reads them (see the root-cause
      note on `referenceItems`, 2026-10-06). Here the photo IS the opening
      frame, so a reference video can only be MOTION to follow — never a clip
      to edit, which would contradict the frame — hence `feature` always.
    */
    const refs: KlingReferenceInputs = { ...input, referenceVideoMode: "feature" };
    const contents: Record<string, unknown>[] = [];
    const prompt = bindReferencePrompt(input.prompt ?? "", refs);
    if (prompt) contents.push(promptItem(prompt));
    contents.push(contentItem("first_frame", { url: input.firstFrameUrl }));
    if (input.lastFrameUrl?.trim()) contents.push(contentItem("last_frame", { url: input.lastFrameUrl }));
    contents.push(...referenceItems(refs));

    const settings = settingsField(input.options);
    // A video input REQUIRES multi_shot false (Kling refuses it otherwise).
    if (hasReferenceVideo(refs)) settings.multi_shot = false;
    return { contents, settings };
  },
};
