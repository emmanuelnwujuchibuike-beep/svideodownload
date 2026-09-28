import { KLING_OMNI, KLING_OMNI_MODEL_NAME, klingElementRef } from "@/lib/ai/kling/features/capabilities";
import {
  commonRequestFields,
  elementListField,
  imageListField,
  validateCommonOptions,
  validateElementRef,
  validateImageRefs,
  validatePrompt,
  type KlingElementInputRef,
  type KlingImageRef,
} from "@/lib/ai/kling/features/shared";
import { invalid, ok, type KlingCommonOptions, type KlingFeatureHandler } from "@/lib/ai/kling/features/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REFERENCE IMAGE on Kling 3.0 Omni — photos the model LEARNS FROM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ✅ SUPPORTED. The 3.0 Omni model guide describes multi-image reference and
 * element reference, and states the ceiling explicitly: **up to 7 images**
 * when no video is supplied (minimum 300 px, 10 MB each, .jpg/.jpeg/.png).
 *
 * ── Two kinds of reference, and the prompt has to say which ────────────────
 *
 *   elements   a PERSON (or subject) the output must keep consistent. Several
 *              angles of the same one go in the SAME element — a second
 *              element is a second character, which is the mistake that turns
 *              "my friend from three angles" into three strangers.
 *   images     style, wardrobe, setting: things to look like, not people to be.
 *
 * Omni addresses an element positionally from the prompt
 * (`<<<element_1>>>`), so this handler offers `promptForElement()` rather
 * than leaving every caller to count. An off-by-one here points the model at
 * the wrong person.
 *
 * ── 🔴 NOT image-to-video ──────────────────────────────────────────────────
 * Nothing here is a frame. No `type` is sent, and the output never opens on a
 * supplied picture. See the note in image-to-video.ts.
 */

export interface KlingReferenceImageInput {
  /** What to make. Required: with no frames to follow, the prompt is the whole instruction. */
  prompt: string;
  /** Subjects to keep consistent. Several angles of ONE person belong to ONE element. */
  elements?: readonly KlingElementInputRef[];
  /** Style/appearance references. Never people to reproduce. */
  styleImageUrls?: readonly string[];
  options?: KlingCommonOptions;
}

/** The token that names the nth element inside a prompt. 1-based, like the vendor's own syntax. */
export function promptForElement(oneBasedIndex: number): string {
  return klingElementRef(oneBasedIndex);
}

export const klingReferenceImage: KlingFeatureHandler<KlingReferenceImageInput> = {
  id: "reference_image",
  label: "Reference Image",
  available: true,
  unavailableReason: null,
  model: KLING_OMNI_MODEL_NAME,

  validate(input) {
    const prompt = validatePrompt(input.prompt, { required: true });
    if (!prompt.ok) return prompt;

    const common = validateCommonOptions(input.options);
    if (!common.ok) return common;

    const elements = input.elements ?? [];
    const styleImages = input.styleImageUrls ?? [];
    if (elements.length === 0 && styleImages.length === 0) return invalid("Add at least one reference photo.");

    for (let i = 0; i < elements.length; i++) {
      const verdict = validateElementRef(elements[i]!, i);
      if (!verdict.ok) return verdict;
    }

    /*
      🔴 The budget is over EVERYTHING the model must look at, not over one
      list. With no video the ceiling is seven, and an element's own photos
      count toward it — six style images plus a three-angle character is ten
      pictures, which the vendor would refuse after we had charged.
    */
    const elementImages = elements.reduce((n, e) => n + e.imageUrls.length, 0);
    const total = elementImages + styleImages.length;
    if (total > KLING_OMNI.images.withoutVideo.max) {
      return invalid(`This engine takes up to ${KLING_OMNI.images.withoutVideo.max} reference photos in total. Remove ${total - KLING_OMNI.images.withoutVideo.max}.`);
    }

    const refs: KlingImageRef[] = styleImages.map((url) => ({ url }));
    const verdict = validateImageRefs(refs, { hasVideo: false, elementCount: elements.length, required: false });
    if (!verdict.ok) return verdict;
    return ok;
  },

  buildRequest(input) {
    const elements = input.elements ?? [];
    const styleImages = input.styleImageUrls ?? [];
    return {
      model_name: KLING_OMNI_MODEL_NAME,
      multi_shot: false,
      prompt: input.prompt.trim(),
      ...(elements.length ? { element_list: elementListField(elements) } : {}),
      ...(styleImages.length ? { image_list: imageListField(styleImages.map((url) => ({ url }))) } : {}),
      ...commonRequestFields(input.options),
    };
  },
};
