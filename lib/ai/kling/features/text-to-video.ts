import { KLING_OMNI_MODEL_NAME } from "@/lib/ai/kling/features/capabilities";
import { promptItem, referenceItems, settingsField, validateAspectRatioPresence, validateCommonOptions, validatePrompt, validateReferenceInputs, type KlingReferenceInputs } from "@/lib/ai/kling/features/shared";
import { invalid, type KlingCommonOptions, type KlingFeatureHandler } from "@/lib/ai/kling/features/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TEXT → VIDEO on Kling 3.0 Omni — its own pipeline, nothing shared
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ✅ **VERIFIED END TO END, 2026-09-28.** A real generation was submitted with a
 * real key and it succeeded:
 *
 *   POST /omni-video/kling-v3-omni
 *   { "contents": [ { "type": "prompt", "text": "…" } ],
 *     "settings": { "aspect_ratio": "16:9", "resolution": "720p", "duration": 5 } }
 *
 *   → 200 { code: 0, data: { id: "933557962801545273", status: "submitted" } }
 *   → GET /tasks?task_ids=…  status "succeeded",
 *       outputs: [ { type: "video", url: "https://…", duration: "5.041" } ],
 *       billing: [ { charge_type: "unit", amount: "3", package_type: "video" } ]
 *
 * This handler is the ONLY one in this migration with that status; the rest are
 * verified to the field level at best. See `verification` on each.
 *
 * ── 🔴 WHAT PART 3 SENT, AND WHY IT WOULD HAVE FAILED ───────────────────────
 *
 * Part 3 emitted `{ model_name, multi_shot, prompt, multi_prompt[], shot_type,
 * mode, sound, duration }`. The live API answers
 * `400 {"code":1201,"message":"contents cannot be empty"}` to that: there is no
 * top-level `prompt`, no `multi_prompt`, no `shot_type`, no `mode`, no `sound`,
 * and the model is a path segment rather than a body field.
 *
 * ── Multi-shot ──────────────────────────────────────────────────────────────
 *
 * `settings.multi_shot` is a real boolean (the vendor validates it). But the
 * per-shot prompt list Part 3 invented — `multi_prompt[{index,prompt,duration}]`
 * — is NOT a verified field, and `contents[].type` has no `shot` value. So
 * multi-shot is offered here as the flag the vendor actually accepts, over a
 * single prompt, and a per-shot list is NOT faked. Asking for one would need the
 * field name, which no readable source gives.
 */

export interface KlingTextToVideoInput extends KlingReferenceInputs {
  /** What to make. The whole instruction — there is nothing else to go on. */
  prompt: string;
  /**
   * Ask the model to cut the clip into several shots itself
   * (`settings.multi_shot`). It divides the duration; we do not direct it.
   */
  multiShot?: boolean;
  options?: KlingCommonOptions;
}


export const klingTextToVideo: KlingFeatureHandler<KlingTextToVideoInput> = {
  id: "text_to_video",
  label: "Text to Video",
  available: true,
  unavailableReason: null,
  verification: "generation",
  model: KLING_OMNI_MODEL_NAME,

  validate(input) {
    const prompt = validatePrompt(input.prompt, { required: true });
    if (!prompt.ok) return prompt;

    const common = validateCommonOptions(input.options);
    if (!common.ok) return common;

    if (input.multiShot !== undefined && typeof input.multiShot !== "boolean") return invalid("The multi-shot setting must be on or off.");

    // 7 images, or 4 alongside a reference video — the vendor rule, in one place.
    const refs = validateReferenceInputs(input);
    if (!refs.ok) return refs;

    /*
      🔴 There is no first frame here, so the vendor REQUIRES an aspect ratio.
      Refused as a sentence now rather than as a 400 after the charge.
    */
    return validateAspectRatioPresence(input.options, false);
  },

  buildRequest(input) {
    const settings = settingsField(input.options);
    if (input.multiShot !== undefined) settings.multi_shot = input.multiShot;
    return {
      contents: [promptItem(input.prompt), ...referenceItems(input)],
      settings,
    };
  },
};
