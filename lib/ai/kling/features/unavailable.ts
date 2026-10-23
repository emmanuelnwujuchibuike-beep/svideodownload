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
 * ── 🔴 CORRECTED 2026-10-19 — THIS LIST USED TO SAY MORE THAN WAS TRUE ─────
 *
 * It declared five more things impossible, on evidence that later turned out to
 * be about the WRONG request:
 *
 *   · reference images / reference video — the 09-28 runs sent `image` and
 *     `video`, types Omni accepts and ignores. `refer_image`, `base_video` and
 *     `feature_video` were found on 10-06 and each settled by generation; they
 *     ship inside Text to Video and Image to Video (registry.ts
 *     KLING_HOSTED_FEATURES).
 *   · Full Character — "no endpoint creates an element" was a probe of
 *     `/elements`, `/v1/elements` and `/v1/videos/elements`. Kling's own 3.0
 *     Omni reference documents `POST /v1/general/advanced-custom-elements`, and
 *     a free read of its list endpoint answered `code 0` on this account
 *     (2026-10-19). More to the point, a base video plus a reference PHOTO was
 *     proven to replace a person (task 936598991629459463). Full Character
 *     therefore ships as Character Replace (person-replace.ts).
 *
 * ── WHAT REMAINS TRUE ───────────────────────────────────────────────────────
 *
 * The three body-REGION scopes. Kling 3.0 Omni's request has no mask, region,
 * box, point or track field of any kind — the person and the part of the person
 * are named in the prompt and nowhere else. "The face but not the hair" or
 * "the upper body but not the legs" cannot be expressed as anything the API
 * enforces, so offering them would sell a distinction the model is never given.
 */

/** The documented limitation, written once and quoted by all three scopes. */
const REGION_LIMITATION =
  "Kling 3.0 Omni has no field that scopes an edit to a region of a person: its request carries `contents` (prompt, first_frame, last_frame, refer_image, feature_video, base_video, element) and `settings` (resolution, duration, aspect_ratio, audio, multi_shot) — no mask, region, box, point or track (Kling's own 3.0 Omni API reference, read 2026-10-19). A replacement is described in the prompt and nowhere else, so \"only this part of the person\" is a request the model is never given in a form it must obey. Whole-person replacement IS available (Character Replace); a body-part scope would be the same request with a sentence the product could not stand behind.";

export const KLING_UNAVAILABLE_FEATURES: readonly KlingUnavailableFeature[] = [
  {
    id: "face_only",
    label: "Face Only",
    available: false,
    unavailableReason: REGION_LIMITATION,
    revisitWhen: "Kling documents a mask or region input on Omni, or a dedicated face-swap endpoint on the direct API.",
  },
  {
    id: "face_skin",
    label: "Face + Head",
    available: false,
    unavailableReason: `${REGION_LIMITATION} "Face and head, but not the body" needs exactly that missing control.`,
    revisitWhen: "Kling documents region-scoped replacement on Omni, or a model whose documented behaviour is head-and-face only.",
  },
  {
    id: "upper_body",
    label: "Upper Body",
    available: false,
    unavailableReason: `${REGION_LIMITATION} Note this is NOT inherited from the old fal.ai capability mapping, which ALLOWED Upper Body on Kling O1 Video Edit — reusing that answer would be exactly the inference the brief forbids.`,
    revisitWhen: "Kling documents region control on Omni, or the product decides that Upper Body and whole-person Character Replace are one operation.",
  },
];

const BY_ID = new Map(KLING_UNAVAILABLE_FEATURES.map((f) => [f.id, f]));

export function klingUnavailableFeature(id: string): KlingUnavailableFeature | null {
  return BY_ID.get(id as KlingUnavailableFeature["id"]) ?? null;
}
