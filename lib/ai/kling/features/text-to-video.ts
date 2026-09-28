import { KLING_OMNI, KLING_OMNI_MODEL_NAME, klingDurationValue } from "@/lib/ai/kling/features/capabilities";
import { commonRequestFields, validateCommonOptions, validatePrompt } from "@/lib/ai/kling/features/shared";
import { invalid, ok, type KlingCommonOptions, type KlingFeatureHandler, type KlingValidation } from "@/lib/ai/kling/features/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TEXT → VIDEO on Kling 3.0 Omni
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ✅ SUPPORTED. Kling's own 3.0 Omni model guide lists "Text-to-Video —
 * Supports Native Audio and Multi-shot" as a first-class mode of the model,
 * and this handler uses exactly that: a prompt, or a list of shots, and
 * nothing else. No image, no video, no element.
 *
 * ── Multi-shot is this feature's own business ──────────────────────────────
 *
 * Omni can build one clip from several prompts, each with its own length
 * (`multi_prompt`, 1–6 shots). That belongs HERE rather than in a shared
 * builder, because it is the only mode where `duration` is per shot and the
 * single `prompt` field is absent — a generic builder would have to branch on
 * the feature, which is the thing Part 3 exists to avoid.
 */

export interface KlingTextToVideoInput {
  /** The single-shot prompt. Mutually exclusive with `shots`. */
  prompt?: string;
  /** The multi-shot list. Mutually exclusive with `prompt`. */
  shots?: readonly { prompt: string; durationSeconds?: number }[];
  /** `customize` honours each shot's own length; `intelligence` lets the model divide the time. */
  shotType?: "customize" | "intelligence";
  options?: KlingCommonOptions;
}

function validateShots(shots: readonly { prompt: string; durationSeconds?: number }[]): KlingValidation {
  if (shots.length < KLING_OMNI.multiShot.minShots || shots.length > KLING_OMNI.multiShot.maxShots) {
    return invalid(`A multi-shot video has between ${KLING_OMNI.multiShot.minShots} and ${KLING_OMNI.multiShot.maxShots} shots.`);
  }
  let total = 0;
  for (const shot of shots) {
    const verdict = validatePrompt(shot.prompt, { required: true, what: "Each shot's prompt" });
    if (!verdict.ok) return verdict;
    if (shot.durationSeconds !== undefined) {
      if (!Number.isFinite(shot.durationSeconds) || shot.durationSeconds <= 0) return invalid("Each shot's length must be a positive number of seconds.");
      total += shot.durationSeconds;
    }
  }
  // The shots together are still one video, so they are bound by the model's own ceiling.
  if (total > KLING_OMNI.duration.maxSeconds) {
    return invalid(`The shots add up to more than ${KLING_OMNI.duration.maxSeconds} seconds, which is the longest this engine makes.`);
  }
  return ok;
}

export const klingTextToVideo: KlingFeatureHandler<KlingTextToVideoInput> = {
  id: "text_to_video",
  label: "Text to Video",
  available: true,
  unavailableReason: null,
  model: KLING_OMNI_MODEL_NAME,

  validate(input) {
    const hasPrompt = !!input.prompt?.trim();
    const hasShots = !!input.shots?.length;
    if (!hasPrompt && !hasShots) return invalid("Describe the video you want.");
    /*
      🔴 Refused rather than resolved. A request carrying both is a caller that
      does not know which one it means, and picking one for them is how a
      member gets a video of the wrong thing and is charged for it.
    */
    if (hasPrompt && hasShots) return invalid("Use either a single description or a list of shots, not both.");

    const common = validateCommonOptions(input.options);
    if (!common.ok) return common;

    if (hasShots) {
      if (input.shotType !== undefined && input.shotType !== "customize" && input.shotType !== "intelligence") return invalid("That shot mode isn't one this engine offers.");
      return validateShots(input.shots!);
    }
    return validatePrompt(input.prompt, { required: true });
  },

  buildRequest(input) {
    const body: Record<string, unknown> = { model_name: KLING_OMNI_MODEL_NAME, ...commonRequestFields(input.options) };

    if (input.shots?.length) {
      body.multi_shot = true;
      body.shot_type = input.shotType ?? "customize";
      body.multi_prompt = input.shots.map((shot, i) => ({
        index: i + 1,
        prompt: shot.prompt.trim(),
        ...(shot.durationSeconds === undefined ? {} : { duration: klingDurationValue(shot.durationSeconds) }),
      }));
      /*
        A per-shot list already carries the timing, so a whole-video `duration`
        alongside it would be two answers to one question. The shared fragment
        adds it when the caller set one; here it is removed for multi-shot.
      */
      delete body.duration;
      return body;
    }

    body.multi_shot = false;
    body.prompt = input.prompt!.trim();
    return body;
  },
};
