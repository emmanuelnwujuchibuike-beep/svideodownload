import type { KlingUnavailableFeature } from "@/lib/ai/kling/features/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT KLING 3.0 OMNI DOES NOT DO — declared, not faked
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 3: "If Kling 3.0 Omni does NOT directly support one of these
 * features: DO NOT FAKE SUPPORT. Do not silently route it to Replicate, do
 * not silently route it to fal.ai, do not use another AI model, do not chain
 * multiple AI models, do not build a fake compatibility layer, do not claim
 * the feature works when it doesn't. Instead: leave that feature
 * unimplemented, document the exact API limitation, keep the handler
 * capability disabled."
 *
 * This is that list. It is a table of REFUSALS rather than four empty modules
 * because a refusal has no input type, no validation and no request to build —
 * a stub handler for each would be four files whose only content is the
 * sentence below, and the sentences are easier to compare side by side.
 *
 * ── 🔴 THE EVIDENCE, AND ITS LIMITS ────────────────────────────────────────
 *
 * Kling's 3.0 Omni model guide (kling.ai, read 2026-09-28 — server-rendered,
 * unlike the API reference) lists the model's modes: Text-to-Video,
 * Image-to-Video (start & end frames, multi-image reference, element
 * reference), Video Element Reference, and Element Voice Control. Lip-sync,
 * motion control and video editing are absent from that list, and the guide's
 * FAQ says they "function the same as in O1" — that is, they remain separate
 * endpoints and models, not capabilities of Omni.
 *
 * None of the four below is therefore something Omni refuses at request time;
 * each is something Omni was never documented to do. That distinction matters
 * for Part 4: two of them may be reachable on a DIFFERENT direct Kling model,
 * which is a decision the owner said would be made separately.
 */

export const KLING_UNAVAILABLE_FEATURES: readonly KlingUnavailableFeature[] = [
  {
    id: "face_only",
    label: "Face Only",
    available: false,
    unavailableReason:
      "Kling 3.0 Omni has no face-swap operation and no parameter that scopes a replacement to a region of the body. Its element reference replaces a SUBJECT as a whole — there is no documented way to ask it to change only the face and leave hair, head shape and body untouched. Building this on Omni would mean sending the identical request Full Character sends and hoping the model restrained itself, which is not a feature.",
    revisitWhen: "Kling publishes a face-swap endpoint, or an element parameter that scopes the replacement region.",
  },
  {
    id: "face_skin",
    label: "Face + Head",
    available: false,
    unavailableReason:
      "The same limitation as Face Only. 'Face and head, but not the body' is a region-scoped replacement, and Kling 3.0 Omni's documented element reference offers no region control at all.",
    revisitWhen: "Kling publishes region-scoped replacement, or a model whose documented behaviour is head-and-face only.",
  },
  {
    id: "upper_body",
    label: "Upper Body",
    available: false,
    unavailableReason:
      "Again a region-scoped replacement, and again unsupported for the same reason. Note this one is NOT blocked by the old fal.ai capability mapping — that mapping allowed Upper Body on Kling O1 Video Edit. It is blocked because the DIRECT Omni API documents no way to express 'upper body only', and inheriting the fal adapter's answer would be exactly the inference the brief forbids.",
    revisitWhen: "Kling documents region control on the Omni element reference, or the product accepts that Upper Body and Full Character are the same operation.",
  },
  {
    id: "lip_sync",
    label: "Lip Sync",
    available: false,
    unavailableReason:
      "Lip sync is not a documented mode of Kling 3.0 Omni. Kling's own 3.0 Omni model guide lists the model's modes and lip-sync is not among them; its FAQ states that lip sync functions as it did in O1 — that is, through a SEPARATE Kling endpoint and model, not through the Omni request this seam builds. Omni's Element Voice Control binds a voice to a character it is generating, which is a different operation from driving the mouth of an existing person in existing footage.",
    revisitWhen: "A decision is taken to integrate Kling's separate direct lip-sync endpoint, which the owner said would be decided separately. Until then Lip Sync Pro stays on its current providers and is not this seam's business.",
  },
];

const BY_ID = new Map(KLING_UNAVAILABLE_FEATURES.map((f) => [f.id, f]));

export function klingUnavailableFeature(id: string): KlingUnavailableFeature | null {
  return BY_ID.get(id as KlingUnavailableFeature["id"]) ?? null;
}
