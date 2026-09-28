import type { KlingUnavailableFeature } from "@/lib/ai/kling/features/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT THE DIRECT KLING API DOES NOT DO — declared, not faked
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 4 §7: "If a requested feature cannot be performed by direct Kling
 * using the required quality/behavior: DO NOT use Replicate or fal.ai. Return a
 * clear unsupported capability state until a proper direct Kling implementation
 * exists. Do not fake support." §31.24: "Do not declare unsupported features
 * supported."
 *
 * This is that list. Every reason below is **verified against the live API on
 * 2026-09-28**, quoting the vendor's own words — not inferred from Omni's model
 * guide, not inherited from the fal.ai adapter's capability mapping, and not
 * carried over from Part 3.
 *
 * ── 🔴 THE HEADLINE, AND IT IS A PRODUCT DECISION, NOT AN ENGINEERING ONE ───
 *
 * **Character Replace has no engine on the direct Kling API.** All four of its
 * scopes are unavailable, and the reason is not "no region control" (Part 3's
 * answer) but something more basic that Part 3 could not have known:
 *
 *   `contents[].type: "element"` requires an `element_id` that refers to an
 *   element ALREADY EXISTING IN THE KLING ACCOUNT, and there is no endpoint to
 *   create one.
 *
 *       {"type":"element","element_id":"1"}  → 400 "Element id not found: 1"
 *       {"type":"element"}                   → 400 "Invalid element id: "
 *
 *   Supplying the images alongside it in every shape tried — `images[]`,
 *   `image`, `url`, `urls[]`, a nested `contents[]`, and top-level `elements`,
 *   `element_list`, `elementList` — changes nothing. And no element-creation
 *   endpoint exists: `/elements`, `/v1/elements` and `/v1/videos/elements` are
 *   all 404, `/omni-video/elements` answers "model is not supported".
 *
 * So an element is something a human makes in Kling's web application. It cannot
 * be part of an automated product flow at all, which means character replacement
 * — the operation every scope is a variant of — is not expressible through this
 * API. This is not a limitation that "Full Character works and the narrower
 * scopes don't"; **none of them work.**
 *
 * Per §7 that is reported as unsupported and NOT routed to Replicate or fal.ai.
 * What the product should do about a flagship tool losing its engine is the
 * owner's call, and it is flagged rather than decided here.
 */

/** The verified element finding, written once and quoted by all four scopes. */
const ELEMENT_LIMITATION =
  "The direct Kling API cannot be given a character at all. A character is an `element`, and `contents[].type: \"element\"` only accepts an `element_id` that already exists in the Kling ACCOUNT — it answers \"Element id not found\" for any id, and \"Invalid element id\" for none. Supplying the photos alongside it (as `images`, `image`, `url`, `urls`, a nested `contents`, or a top-level `elements` / `element_list`) changes nothing, and there is no endpoint that creates an element: /elements, /v1/elements and /v1/videos/elements are all 404. Elements are made by a person in Kling's web application, so they cannot be part of an automated flow. Verified against the live API on 2026-09-28.";

const REGION_LIMITATION =
  "Separately from the element problem, the direct Kling API documents no parameter that scopes a replacement to a region of the body, so there is no way to express \"this part of the person and not the rest\" even once an element exists.";

export const KLING_UNAVAILABLE_FEATURES: readonly KlingUnavailableFeature[] = [
  {
    id: "full_character",
    label: "Full Character",
    available: false,
    unavailableReason: `${ELEMENT_LIMITATION} Full Character is exactly this operation — a base clip plus a replacement character — so it is the scope that fails FIRST, not the one that survives. Part 3 declared it available on the strength of Omni's model guide; the live API refuses it.`,
    revisitWhen: "Kling publishes an element-creation endpoint, or accepts character images inline in the create request.",
  },
  {
    id: "face_only",
    label: "Face Only",
    available: false,
    unavailableReason: `${ELEMENT_LIMITATION} ${REGION_LIMITATION}`,
    revisitWhen: "Kling publishes an element-creation endpoint AND a way to scope the replacement to the face, or a dedicated face-swap endpoint.",
  },
  {
    id: "face_skin",
    label: "Face + Head",
    available: false,
    unavailableReason: `${ELEMENT_LIMITATION} ${REGION_LIMITATION} \"Face and head, but not the body\" needs both capabilities and has neither.`,
    revisitWhen: "Kling publishes element creation and region-scoped replacement, or a model whose documented behaviour is head-and-face only.",
  },
  {
    id: "upper_body",
    label: "Upper Body",
    available: false,
    unavailableReason: `${ELEMENT_LIMITATION} ${REGION_LIMITATION} Note this is NOT inherited from the old fal.ai capability mapping, which ALLOWED Upper Body on Kling O1 Video Edit — that would be exactly the inference the brief forbids. It is refused because the DIRECT API refuses it.`,
    revisitWhen: "Kling publishes element creation and region control, or the product accepts that Upper Body and Full Character are one operation.",
  },
  {
    id: "reference_video",
    label: "Reference Video",
    available: false,
    unavailableReason:
      "Kling 3.0 Omni does NOT edit a supplied video — it discards it. Verified by generation, not by inference: a 3 s clip of an animated forest was sent as `contents[].type:\"video\"` with the prompt \"keep this exact scene and motion, change only the sky to deep purple\", and the result was a photoreal empty plain under a purple sky with nothing of the source in it. Repeated using Kling's own placeholder syntax (\"Keep <<<video_1>>> exactly as it is…\") and the result was a photoreal tree in a field — again nothing of the source. A third run added a reference photo and asked for the person to be replaced; the output was a different person in a different place, matching neither input. The supplied video is not preserved, so any product built on this would take a member's footage and hand back something unrelated. Note the contrast that proves this is a real finding rather than a bad prompt: /v1/videos/lip-sync DOES preserve the same source video exactly, changing only the mouth.",
    revisitWhen: "Kling documents a genuine video-editing task on Omni (no parameter tried — refer_type, role, edit, task_type at item, settings and top level — reaches the 'task is video editing' branch its own aspect-ratio error mentions), or publishes a video-to-video endpoint.",
  },
  {
    id: "reference_image",
    label: "Reference Image",
    available: false,
    unavailableReason:
      "A plain reference image appears to be ignored by the model rather than refused. `contents[].type: \"image\"` is ACCEPTED with any `url` — the url is never validated and, unlike `first_frame`, never fetched: three tasks sent with an unreachable image url all SUCCEEDED, generating from the prompt alone, where an unreachable `first_frame` url makes the task fail with \"Something went wrong when we tried to get the contents of the file.\" A field whose value is never read is a field that does nothing, and a feature built on it would charge a member for a reference the model never saw. The subject-consistency kind of reference is an `element`, which has the problem above. Verified 2026-09-28.",
    revisitWhen: "A completed generation proves a reachable `image` item actually influences the output (contract document §7, run #3), or Kling documents the field.",
  },
];

const BY_ID = new Map(KLING_UNAVAILABLE_FEATURES.map((f) => [f.id, f]));

export function klingUnavailableFeature(id: string): KlingUnavailableFeature | null {
  return BY_ID.get(id as KlingUnavailableFeature["id"]) ?? null;
}
