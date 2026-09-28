import { KLING_OMNI, KLING_OMNI_MODEL_NAME, klingElementRef, klingOmniImageBudget, klingVideoRef } from "@/lib/ai/kling/features/capabilities";
import {
  commonRequestFields,
  elementListField,
  validateCommonOptions,
  validateElementRef,
  validatePrompt,
  validateSoundWithVideo,
  validateVideoRef,
  videoListField,
  type KlingElementInputRef,
  type KlingVideoRefInput,
} from "@/lib/ai/kling/features/shared";
import { invalid, ok, type KlingCommonOptions, type KlingFeatureHandler } from "@/lib/ai/kling/features/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FULL CHARACTER on Kling 3.0 Omni — the person in a clip, replaced
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ✅ SUPPORTED. This is the one existing Frenz AI replacement scope Omni
 * genuinely serves: a base video (`video_list`, `refer_type: "base"`) plus a
 * character element (`element_list`), which is exactly what the 3.0 Omni
 * model guide means by element reference over a supplied video. The guide's
 * numbers apply: the clip is 3–10 s, ≤ 200 MB, ≤ 2K, and images and elements
 * share one budget of four once a video is present.
 *
 * ── 🔴 WHY THE OTHER THREE SCOPES ARE NOT HERE ─────────────────────────────
 *
 * Face Only, Face + Skin and Upper Body are in unavailable.ts with their
 * reasons. The short version: Omni has **no parameter that scopes a
 * replacement to a region of the body**. `element_list` replaces a subject,
 * whole. Offering "Face Only" on this endpoint would mean sending the exact
 * same request as Full Character and hoping the model restrained itself —
 * which is not a feature, it is a coin flip the member pays for.
 *
 * ── 🔴 AND WHY NO VOICE OR LIP-SYNC STAGE IS CHAINED HERE (§6) ─────────────
 *
 * The existing production pipeline composes replace → voice → lip-sync across
 * two vendors. The owner's Part 3 rule is explicit: do not chain "character
 * replace → generated voice → lip sync" inside a generic Kling handler, and
 * do not silently redesign a deliberate product composition. So this handler
 * does ONE thing — one Kling request, one generation — and the question of
 * how the product composes operations is left exactly where Part 1 found it,
 * for Part 4 to decide with routing.
 *
 * Omni can bind a voice to an element natively (`element_list[].audio`, 5–30 s
 * per the guide), which is offered here as an INPUT rather than as a chained
 * stage: one request, no intermediate download, no re-encode, no second
 * vendor. That is the quality win §6 asks for, available the day Part 4
 * chooses to use it.
 */

export interface KlingFullCharacterInput {
  /** The member's footage — the clip that comes back edited. */
  videoUrl: string;
  /** Measured by our worker on the prepared file, never claimed by a browser. */
  videoDurationSeconds?: number;
  videoBytes?: number;
  /** Whether the source audio survives into the output. */
  keepOriginalSound?: boolean;
  /**
   * The replacement character: several angles of ONE person, or a short clip
   * of them, with an optional voice.
   *
   * 🔴 One element, always. A second element is a second character, and the
   * member asked for their own face in a clip, not for a crowd.
   */
  character: KlingElementInputRef;
  /** What the model should do. Defaulted below rather than required — see the note on the prompt. */
  prompt?: string;
  options?: KlingCommonOptions;
}

/**
 * The instruction, when the caller supplies none.
 *
 * Written here rather than in a shared prompt file for the reason the fal
 * adapter's own prompt is written beside its adapter: a better wording found
 * in testing should change ONE feature, and a prompt shared between scopes is
 * a prompt that is wrong for most of them. It names the transformation and
 * then lists everything to preserve, because a replacement model left
 * unconstrained rewrites the scene as well as the person.
 */
export function defaultFullCharacterPrompt(): string {
  return (
    `Replace the person in ${klingVideoRef(1)} with the character shown in ${klingElementRef(1)}, keeping that character's identity consistent in every frame. ` +
    "Keep everything else exactly as it is: the same movements and body motion, the same facial expressions and timing, the same camera movement, framing and scene composition, the same lighting, background and environment. Do not add, remove or restyle anything else."
  );
}

export const klingFullCharacter: KlingFeatureHandler<KlingFullCharacterInput> = {
  id: "full_character",
  label: "Full Character",
  available: true,
  unavailableReason: null,
  model: KLING_OMNI_MODEL_NAME,

  validate(input) {
    if (!input.videoUrl?.trim()) return invalid("Choose the video to work on.");

    const common = validateCommonOptions(input.options);
    if (!common.ok) return common;

    const prompt = validatePrompt(input.prompt, { required: false });
    if (!prompt.ok) return prompt;

    const sound = validateSoundWithVideo(input.options, true);
    if (!sound.ok) return sound;

    const video: KlingVideoRefInput = { url: input.videoUrl, referType: "base", keepOriginalSound: input.keepOriginalSound, durationSeconds: input.videoDurationSeconds, bytes: input.videoBytes };
    const videoVerdict = validateVideoRef(video);
    if (!videoVerdict.ok) return videoVerdict;

    const characterVerdict = validateElementRef(input.character, 0);
    if (!characterVerdict.ok) return characterVerdict;

    /*
      The four-reference budget, counted honestly: the base video takes one,
      and the character's photos take one each. A member who uploaded four
      angles plus a clip would be refused by the vendor after being charged.
    */
    const remaining = klingOmniImageBudget({ hasVideo: true, elementCount: 1 });
    if (input.character.imageUrls.length > remaining) {
      return invalid(`With a video, this engine takes up to ${remaining} photos of the character. Remove ${input.character.imageUrls.length - remaining}.`);
    }
    if (input.character.imageUrls.length > KLING_OMNI.element.maxImagesPerElement) {
      return invalid(`A character can have up to ${KLING_OMNI.element.maxImagesPerElement} photos.`);
    }
    return ok;
  },

  buildRequest(input) {
    return {
      model_name: KLING_OMNI_MODEL_NAME,
      multi_shot: false,
      prompt: (input.prompt?.trim() || defaultFullCharacterPrompt()),
      video_list: videoListField([{ url: input.videoUrl, referType: "base", keepOriginalSound: input.keepOriginalSound ?? true }]),
      element_list: elementListField([input.character]),
      ...commonRequestFields(input.options),
    };
  },
};
