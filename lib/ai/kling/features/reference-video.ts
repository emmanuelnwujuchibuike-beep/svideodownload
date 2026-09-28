import { KLING_OMNI, KLING_OMNI_MODEL_NAME, klingVideoRef } from "@/lib/ai/kling/features/capabilities";
import { contentItem, promptItem, settingsField, validateCommonOptions, validateMediaUrl, validatePrompt } from "@/lib/ai/kling/features/shared";
import { invalid, ok, type KlingCommonOptions, type KlingFeatureHandler } from "@/lib/ai/kling/features/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REFERENCE VIDEO on Kling 3.0 Omni — a clip the model works from
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ✅ **Fields verified, 2026-09-28.** `contents[].type: "video"` is accepted and
 * its url is genuinely validated:
 *
 *   {"type":"video","url":"notaurl"} → 400 "Video URL is invalid"
 *
 * ⚠️ **BEHAVIOUR IS NOT VERIFIED, AND THAT IS WHY THIS IS NOT ROUTABLE YET.**
 *
 * `verification: "fields"`. What a supplied video actually DOES is the open
 * question, and it is the whole product question:
 *
 *   · does the model EDIT the clip (the member's own footage, returned changed)?
 *   · or does it merely take CUES from it (a new video that resembles it)?
 *
 * Part 3 claimed the distinction was expressed by `video_list[].refer_type`
 * (`"base"` vs `"feature"`). **There is no `refer_type` and no `video_list`** —
 * the live request has one flat `contents` array and a `video` item carries only
 * a `url`. So the two products Part 3 split into two handlers are, on the real
 * API, *the same request*, and which behaviour you get is undocumented.
 *
 * 🔴 That matters more than it looks. A member who uploads their footage
 * expecting it edited, and receives something merely *inspired* by it, has been
 * given the wrong product and charged for it. So this handler exists, is
 * complete, and stays **unroutable until one real generation settles which
 * behaviour the API has** (contract document §7, run #2).
 *
 * There is also negative evidence worth recording: supplying a `video` does NOT
 * satisfy the vendor's "or the task is video editing" exemption from the
 * aspect-ratio rule — a prompt + video with no `aspect_ratio` is still refused
 * with "Aspect ratio must be specified…". So on this surface a `video` item is
 * probably NOT "video editing", which leans towards *cues* rather than *edit*.
 * Leaning is not knowing, and nothing is declared on a lean.
 */

export interface KlingReferenceVideoInput {
  /** The clip to work from. 3–10 s — the VIDEO's window, not the output's. */
  videoUrl: string;
  /** Measured by our worker, never claimed by a browser. Omitted = unmeasured, and then unchecked. */
  videoDurationSeconds?: number;
  videoBytes?: number;
  /** What to make from it. Required: without it the model has a mood and no subject. */
  prompt: string;
  options?: KlingCommonOptions;
}

/** The token that names the nth video inside a prompt. 1-based, like the vendor's own syntax. */
export function promptForVideo(oneBasedIndex: number): string {
  return klingVideoRef(oneBasedIndex);
}

export const klingReferenceVideo: KlingFeatureHandler<KlingReferenceVideoInput> = {
  id: "reference_video",
  label: "Reference Video",
  available: true,
  unavailableReason: null,
  verification: "fields",
  model: KLING_OMNI_MODEL_NAME,

  validate(input) {
    if (!input.videoUrl?.trim()) return invalid("Choose the video to work from.");

    const url = validateMediaUrl(input.videoUrl, "The video");
    if (!url.ok) return url;

    const prompt = validatePrompt(input.prompt, { required: true });
    if (!prompt.ok) return prompt;

    const common = validateCommonOptions(input.options);
    if (!common.ok) return common;

    /*
      ⚠️ The VIDEO's window is 3–10 s; the OUTPUT's is 3–15 s. Omni lengthened
      what it can produce without lengthening what it will read, and conflating
      the two is the trap this check exists to make impossible.
    */
    if (input.videoDurationSeconds !== undefined) {
      const d = input.videoDurationSeconds;
      if (!Number.isFinite(d) || d <= 0) return invalid("The video's length could not be measured.");
      if (d < KLING_OMNI.video.minSeconds) return invalid(`This engine needs at least ${KLING_OMNI.video.minSeconds} seconds of video.`);
      if (d > KLING_OMNI.video.maxSeconds) return invalid(`This engine reads up to ${KLING_OMNI.video.maxSeconds} seconds of video. Trim your clip and try again.`);
    }
    if (input.videoBytes !== undefined && input.videoBytes > KLING_OMNI.video.maxBytes) {
      return invalid(`This engine takes videos up to ${Math.round(KLING_OMNI.video.maxBytes / (1024 * 1024))} MB.`);
    }

    /*
      ✅ Verified: a `video` item does NOT exempt the request from the
      aspect-ratio requirement, so one is required here exactly as for
      text-to-video.
    */
    if (input.options?.aspectRatio === undefined) return invalid("Choose a shape for the video (landscape, portrait or square).");
    return ok;
  },

  buildRequest(input) {
    return {
      contents: [promptItem(input.prompt), contentItem("video", { url: input.videoUrl })],
      settings: settingsField(input.options),
    };
  },
};
