import { klingImageToVideo, type KlingImageToVideoInput } from "@/lib/ai/kling/features/image-to-video";
import { klingLipSync, type KlingLipSyncInput } from "@/lib/ai/kling/features/lip-sync";
import { klingTextToVideo, type KlingTextToVideoInput } from "@/lib/ai/kling/features/text-to-video";
import { klingUnavailableFeature, KLING_UNAVAILABLE_FEATURES } from "@/lib/ai/kling/features/unavailable";
import { KLING_FEATURE_IDS, type KlingFeatureHandler, type KlingFeatureId, type KlingValidation, type KlingVerification } from "@/lib/ai/kling/features/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE HANDLER TABLE — a DIRECTORY, not a pipeline
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 4 §4: "The registry may discover the feature, but the registry must
 * not contain the feature's processing logic."
 *
 * Kept honestly: this file knows which handlers exist and nothing about what any
 * of them does. There is no shared request builder here, no `switch (feature)`
 * that assembles a body, and no common validation path every feature is squeezed
 * through. Each handler is imported, listed, and otherwise left alone.
 *
 *        text-to-video      image-to-video      lip-sync
 *              └─────────────────┬─────────────────┘
 *                    this directory
 *                           │
 *            the shared client (TRANSPORT only)
 *                           │
 *               the EXISTING job system
 *
 * Note lip-sync submits to a DIFFERENT endpoint and a different model. That is
 * precisely why the handler owns its own `path` — a directory that had to know
 * which endpoint each feature used would be the beginning of the shared pipeline
 * §2 forbids.
 */

/** A feature whose handler is built. Whether it may RUN is a separate question — see `klingFeatureGate`. */
export type KlingImplementedFeatureId = "text_to_video" | "image_to_video" | "lip_sync";

/** The input each implemented handler takes — so a caller cannot hand one feature another's input. */
export interface KlingFeatureInputs {
  text_to_video: KlingTextToVideoInput;
  image_to_video: KlingImageToVideoInput;
  lip_sync: KlingLipSyncInput;
}

export const KLING_HANDLERS: {
  [K in KlingImplementedFeatureId]: KlingFeatureHandler<KlingFeatureInputs[K]>;
} = {
  text_to_video: klingTextToVideo,
  image_to_video: klingImageToVideo,
  lip_sync: klingLipSync,
};

export const KLING_IMPLEMENTED_FEATURE_IDS: readonly KlingImplementedFeatureId[] = ["text_to_video", "image_to_video", "lip_sync"];

export function isKlingImplementedFeature(id: string): id is KlingImplementedFeatureId {
  return (KLING_IMPLEMENTED_FEATURE_IDS as readonly string[]).includes(id);
}

/** The handler for a feature, typed to its own input. */
export function klingHandler<K extends KlingImplementedFeatureId>(id: K): KlingFeatureHandler<KlingFeatureInputs[K]> {
  return KLING_HANDLERS[id];
}

/* ─────────────────────────── the capability gate ─────────────────────────── */

export type KlingCapability =
  | { available: true; id: KlingImplementedFeatureId; label: string; model: string; verification: KlingVerification }
  | { available: false; id: KlingFeatureId; label: string; reason: string; revisitWhen: string | null };

/**
 * Can direct Kling do this at all?
 *
 * 🔴 PURE, AND THAT IS THE POINT (§13). No network, no database, no clock. A
 * caller asks this BEFORE it reserves credits, takes a complimentary creation or
 * charges a wallet — which is the order the Part 1 audit found the Lip Sync Pro
 * regression violating, when a missing `supports()` entry failed every job after
 * the charge, the download and the prepare.
 *
 * `klingFeatureGate("full_character")` answers `available: false` with the
 * verified limitation, in nanoseconds, for free.
 */
export function klingFeatureGate(id: string): KlingCapability {
  if (isKlingImplementedFeature(id)) {
    const handler = KLING_HANDLERS[id];
    return { available: true, id, label: handler.label, model: handler.model, verification: handler.verification };
  }
  const declared = klingUnavailableFeature(id);
  if (declared) return { available: false, id: declared.id, label: declared.label, reason: declared.unavailableReason, revisitWhen: declared.revisitWhen };
  return { available: false, id: id as KlingFeatureId, label: id, reason: "That operation is not part of the Kling integration.", revisitWhen: null };
}

/**
 * 🔴 MAY A MEMBER'S MONEY DEPEND ON THIS HANDLER YET?
 *
 * Distinct from `klingFeatureGate`, and the distinction is the owner's §5 ("verify
 * the live API contract before routing production traffic") and §31.24 ("do not
 * declare unsupported features supported"). A handler can be complete and correct
 * about every field name and still be unproven about what it PRODUCES.
 *
 *   text_to_video    "generation" — a real run completed; output and billing seen
 *   image_to_video   "generation" — the reference photo came back animated, faithfully
 *   lip_sync         "generation" — the source video was preserved and the mouth driven
 *
 * All three were confirmed on 2026-09-28 at 720p. `reference_video` was removed
 * entirely rather than left gated: a generation PROVED Omni discards the supplied
 * video, so there is nothing to un-gate later (unavailable.ts records the runs).
 *
 * Routing consults this, so nothing reaches a paying member on the strength of a
 * validation message alone. It is a one-line change per handler once a run is
 * done — the runs are listed in
 * `docs/AI_PROVIDER_MIGRATION_PART4_KLING_CONTRACT.md` §7.
 */
export function klingFeatureProvenForBilling(id: string): boolean {
  const capability = klingFeatureGate(id);
  return capability.available && capability.verification === "generation";
}

/**
 * The gate AND the feature's own validation, in the order §13 requires.
 * Still pure; still safe to call before anything is reserved.
 */
export function klingValidateBeforeBilling<K extends KlingImplementedFeatureId>(id: K, input: KlingFeatureInputs[K]): KlingValidation {
  const capability = klingFeatureGate(id);
  if (!capability.available) return { ok: false, kind: "unsupported", reason: capability.reason };
  return KLING_HANDLERS[id].validate(input);
}

/** Every feature this migration names, with its verdict — for the documents and the tests. */
export function klingCapabilityReport(): KlingCapability[] {
  return KLING_FEATURE_IDS.map((id) => klingFeatureGate(id));
}

export { KLING_UNAVAILABLE_FEATURES };
