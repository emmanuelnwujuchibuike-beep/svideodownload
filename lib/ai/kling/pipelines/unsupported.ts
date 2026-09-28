import type { KlingUnsupportedPipeline } from "@/lib/ai/kling/pipelines/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FEATURES DIRECT KLING CANNOT DO — declared, evidenced, never faked
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 5 §37: "If direct Kling currently cannot perform an exact requested
 * feature: DO NOT approximate it with another provider, secretly use Replicate,
 * secretly use fal.ai, call a different AI service, pretend the feature works, or
 * create a misleading UI. Instead: capability = unsupported, and keep the
 * architecture ready for future direct Kling support."
 *
 * §10 adds the same for the body-region scopes, and §9 for Full Character: "If
 * Kling's current direct API does not provide an exact body-region control, do
 * NOT fake it with a prompt or claim that it is equivalent."
 *
 * So these are entries, not omissions. Each one has:
 *   · a sentence a MEMBER can read, which never mentions a provider (§30);
 *   · the verified limitation, for operators and the next engineer;
 *   · what would have to change for it to be reconsidered.
 *
 * ── 🔴 EVERY REASON BELOW WAS ESTABLISHED BY A REAL GENERATION ─────────────
 *
 * Not inferred from a model guide, not inherited from the fal.ai adapter's
 * capability mapping, not carried over from an earlier part. The full evidence,
 * including the vendor's own error messages, is in
 * `docs/AI_PROVIDER_MIGRATION_PART4_KLING_CONTRACT.md` §5.
 */

/** The element finding, written once and quoted by the four character scopes. */
const ELEMENT_LIMITATION =
  "The direct Kling API cannot be given a character at all. A character is an `element`, and `contents[].type: \"element\"` only accepts an `element_id` that ALREADY EXISTS in the Kling account — it answers \"Element id not found\" for any id and \"Invalid element id\" for none. Supplying the photos alongside it (as `images`, `image`, `url`, `urls`, a nested `contents`, or a top-level `elements` / `element_list`) changes nothing, and no endpoint creates an element: /elements, /v1/elements and /v1/videos/elements are all 404. Elements are made by a person in Kling's web application, so they cannot be part of an automated flow. Separately, the complete endpoint map contains NO endpoint that accepts a base video plus a character — /v1/videos/multi-image2video was the only one taking inline reference images and it is retired (\"This API is no longer available\", every model), and there is no face-swap endpoint.";

const REGION_LIMITATION =
  "On top of that, the direct API documents no parameter that scopes a replacement to a region of the body, so there is no way to express \"this part of the person and not the rest\" even if an element existed.";

const MEMBER_CHARACTER =
  "Putting a person from a photo into your own video isn't something this engine can do yet. Your video and your photo are never sent anywhere else, and nothing has been charged.";

export const KLING_UNSUPPORTED_PIPELINES: readonly KlingUnsupportedPipeline[] = [
  {
    feature: "reference_image",
    supported: false,
    label: "Reference Image",
    memberReason: "Guiding a video with reference photos isn't something this engine can do yet. Nothing has been charged.",
    detail:
      "A plain reference image is IGNORED by the model rather than refused, which is worse than a refusal because the task succeeds and bills. Proven by a controlled generation: the same prompt and the same seed were run twice, once with `contents[].type:\"image\"` pointing at a highly distinctive reachable photo (a pug wrapped in a plaid blanket) and once with no image at all. The run WITH the reference produced a woman indoors — no pug, no blanket, no forest. Earlier, three tasks sent with an UNREACHABLE image url all succeeded and generated from the prompt alone, where an unreachable `first_frame` url makes the task fail with \"Something went wrong when we tried to get the contents of the file.\" The url is never fetched. A feature built on this would charge a member for a reference the model never saw.",
    revisitWhen: "A generation proves a reachable `image` item actually influences the output, or Kling documents and ships an inline reference-image capability on the direct API.",
  },
  {
    feature: "reference_video",
    supported: false,
    label: "Reference Video",
    memberReason: "Guiding a new video with one of your own clips isn't something this engine can do yet. Nothing has been charged.",
    detail:
      "Kling 3.0 Omni DISCARDS a supplied video rather than working from it. Proven three ways: (1) a 3s animated-forest clip sent as `contents[].type:\"video\"` with the prompt \"keep this exact scene and motion, change only the sky to deep purple\" returned a photoreal empty plain under a purple sky; (2) the same request using Kling's own placeholder syntax (\"Keep <<<video_1>>> exactly as it is…\") returned a photoreal tree in a field; (3) adding a reference photo and asking for the person to be replaced returned a different person in a different place, matching neither input. The placeholder tokens were tested specifically because omitting them was the obvious flaw in the first attempt, and they changed nothing. No parameter reaches the \"task is video editing\" branch that Omni's own aspect-ratio error mentions — refer_type (base/feature), role, edit, type_, mode, as, task_type and video_edit were each tried at item, settings and top level, as was a video_id instead of a url. The contrast that proves this is a real finding rather than a bad prompt: /v1/videos/lip-sync PRESERVES the same kind of source video exactly and changes only the mouth. Kling can edit a supplied video; it cannot do it through Omni.",
    revisitWhen: "Kling documents a genuine video-editing task on Omni, or publishes a video-to-video endpoint on the direct API.",
  },
  {
    feature: "full_character",
    supported: false,
    label: "Full Character",
    memberReason: MEMBER_CHARACTER,
    detail: `${ELEMENT_LIMITATION} Full Character is exactly this operation — a base clip plus a replacement character — so it is the scope that fails FIRST, not the one that survives.`,
    revisitWhen: "Kling publishes an element-creation endpoint, or accepts character images inline in the create request, or ships a video+character endpoint.",
  },
  {
    feature: "face_only",
    supported: false,
    label: "Face Only",
    memberReason: MEMBER_CHARACTER,
    detail: `${ELEMENT_LIMITATION} ${REGION_LIMITATION}`,
    revisitWhen: "Kling publishes element creation AND a way to scope the replacement to the face, or a dedicated face-swap endpoint.",
  },
  {
    feature: "face_skin",
    supported: false,
    label: "Face + Head",
    memberReason: MEMBER_CHARACTER,
    detail: `${ELEMENT_LIMITATION} ${REGION_LIMITATION} "Face and head, but not the body" needs both capabilities and has neither.`,
    revisitWhen: "Kling publishes element creation and region-scoped replacement, or a model whose documented behaviour is head-and-face only.",
  },
  {
    feature: "upper_body",
    supported: false,
    label: "Upper Body",
    memberReason: MEMBER_CHARACTER,
    detail: `${ELEMENT_LIMITATION} ${REGION_LIMITATION} Note this verdict is NOT inherited from the old fal.ai capability mapping, which ALLOWED Upper Body on Kling O1 Video Edit — reusing that answer would be exactly the inference the brief forbids. It is refused because the DIRECT API refuses it.`,
    revisitWhen: "Kling publishes element creation and region control, or the product accepts that Upper Body and Full Character are one operation.",
  },
];

const BY_FEATURE = new Map(KLING_UNSUPPORTED_PIPELINES.map((p) => [p.feature, p]));

export function klingUnsupportedPipeline(feature: string): KlingUnsupportedPipeline | null {
  return BY_FEATURE.get(feature as KlingUnsupportedPipeline["feature"]) ?? null;
}
