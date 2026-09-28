import { klingFullCharacter, type KlingFullCharacterInput } from "@/lib/ai/kling/features/full-character";
import { klingImageToVideo, type KlingImageToVideoInput } from "@/lib/ai/kling/features/image-to-video";
import { klingReferenceImage, type KlingReferenceImageInput } from "@/lib/ai/kling/features/reference-image";
import { klingReferenceVideo, type KlingReferenceVideoInput } from "@/lib/ai/kling/features/reference-video";
import { klingTextToVideo, type KlingTextToVideoInput } from "@/lib/ai/kling/features/text-to-video";
import { klingUnavailableFeature, KLING_UNAVAILABLE_FEATURES } from "@/lib/ai/kling/features/unavailable";
import { KLING_FEATURE_IDS, type KlingFeatureHandler, type KlingFeatureId, type KlingValidation } from "@/lib/ai/kling/features/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE HANDLER TABLE — a directory, NOT a pipeline
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The distinction the owner drew, kept honestly: this file knows which
 * handlers exist and nothing about what any of them does. There is no shared
 * request builder here, no `switch (feature)` that assembles a body, no
 * common validation path that every feature is squeezed through. Each handler
 * is imported, listed, and otherwise left alone.
 *
 *              text-to-video  image-to-video  reference-image  …
 *                     └──────────────┬──────────────┘
 *                            this directory
 *                                    │
 *                     the shared client (transport only)
 *                                    │
 *                        the EXISTING job system
 *
 * ── 🔴 THIS FILE IS NOT WIRED TO PRODUCTION (§9) ───────────────────────────
 *
 * Nothing in `app/`, nothing in `server/` and nothing in the provider
 * resolver imports it. Part 3 builds the handlers; Part 4 connects routing.
 * `klingProvider.supports()` still answers false for every feature, so even
 * an accidental future wiring is refused before a charge.
 */

/** A feature whose handler is built and serviceable. */
export type KlingImplementedFeatureId = "text_to_video" | "image_to_video" | "reference_image" | "reference_video" | "full_character";

/** The input each implemented handler takes — so a caller cannot hand one feature another's input. */
export interface KlingFeatureInputs {
  text_to_video: KlingTextToVideoInput;
  image_to_video: KlingImageToVideoInput;
  reference_image: KlingReferenceImageInput;
  reference_video: KlingReferenceVideoInput;
  full_character: KlingFullCharacterInput;
}

export const KLING_HANDLERS: {
  [K in KlingImplementedFeatureId]: KlingFeatureHandler<KlingFeatureInputs[K]>;
} = {
  text_to_video: klingTextToVideo,
  image_to_video: klingImageToVideo,
  reference_image: klingReferenceImage,
  reference_video: klingReferenceVideo,
  full_character: klingFullCharacter,
};

export const KLING_IMPLEMENTED_FEATURE_IDS: readonly KlingImplementedFeatureId[] = ["text_to_video", "image_to_video", "reference_image", "reference_video", "full_character"];

export function isKlingImplementedFeature(id: string): id is KlingImplementedFeatureId {
  return (KLING_IMPLEMENTED_FEATURE_IDS as readonly string[]).includes(id);
}

/** The handler for a feature, typed to its own input. Null for anything Omni does not serve. */
export function klingHandler<K extends KlingImplementedFeatureId>(id: K): KlingFeatureHandler<KlingFeatureInputs[K]> {
  return KLING_HANDLERS[id];
}

/* ─────────────────────────── the capability gate ─────────────────────────── */

export type KlingCapability =
  | { available: true; id: KlingImplementedFeatureId; label: string; model: string }
  | { available: false; id: KlingFeatureId; label: string; reason: string; revisitWhen: string | null };

/**
 * Can Kling do this at all?
 *
 * 🔴 PURE, AND THAT IS THE POINT (§4, §5). No network, no database, no clock.
 * A caller asks this BEFORE it reserves credits, takes a complimentary
 * creation or charges a wallet — which is the order the Part 1 audit found
 * the Lip Sync Pro regression violating, when a missing `supports()` entry
 * failed every job after the charge, the download and the prepare.
 *
 * `klingFeatureGate("lip_sync")` answers `available: false` with the
 * documented limitation, in nanoseconds, for free.
 */
export function klingFeatureGate(id: string): KlingCapability {
  if (isKlingImplementedFeature(id)) {
    const handler = KLING_HANDLERS[id];
    return { available: true, id, label: handler.label, model: handler.model };
  }
  const declared = klingUnavailableFeature(id);
  if (declared) return { available: false, id: declared.id, label: declared.label, reason: declared.unavailableReason, revisitWhen: declared.revisitWhen };
  return { available: false, id: id as KlingFeatureId, label: id, reason: "That operation is not part of the Kling integration.", revisitWhen: null };
}

/**
 * The gate AND the feature's own validation, in the order §5 requires.
 * Still pure; still safe to call before anything is reserved.
 */
export function klingValidateBeforeBilling<K extends KlingImplementedFeatureId>(id: K, input: KlingFeatureInputs[K]): KlingValidation {
  const capability = klingFeatureGate(id);
  if (!capability.available) return { ok: false, kind: "unsupported", reason: capability.reason };
  return KLING_HANDLERS[id].validate(input);
}

/** Every feature this migration names, with its verdict — for the Part 3 document and the tests. */
export function klingCapabilityReport(): KlingCapability[] {
  return KLING_FEATURE_IDS.map((id) => klingFeatureGate(id));
}

export { KLING_UNAVAILABLE_FEATURES };
