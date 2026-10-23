import type { KlingUnsupportedPipeline } from "@/lib/ai/kling/pipelines/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FEATURES THE DIRECT KLING API CANNOT PERFORM (§10, §37)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Declared here so the registry is a complete map and the UI can render an
 * honest state, and so a future engineer finds the evidence instead of
 * re-running it.
 *
 * 🔴 CORRECTED 2026-10-19. This list used to include Reference Image,
 * Reference Video and Full Character on evidence a later generation and
 * Kling's own documentation disproved — see the header of
 * lib/ai/kling/features/unavailable.ts for the record. Reference inputs are
 * served by Text to Video / Image to Video (registry.ts
 * KLING_PIPELINE_HOSTS); Full Character runs as Character Replace
 * (person-replace.ts). What remains is the region scopes: Omni has no field
 * that limits an edit to part of a person.
 *
 * 🔴 No entry here may ever be "made to work" by routing to another provider or
 * by chaining models (§1, §7) — each says what would have to change at KLING.
 */

const REGION_DETAIL =
  "Kling 3.0 Omni's request has no mask, region, box, point or track field (Kling's own 3.0 Omni API reference, 2026-10-19): `contents` takes prompt, first_frame, last_frame, refer_image, feature_video, base_video and element; `settings` takes resolution, duration, aspect_ratio, audio and multi_shot. A replacement is described in the prompt only, so a body-part scope is a sentence the model is never made to obey. Whole-person replacement ships as Character Replace.";

const MEMBER_REGION = "Replacing only part of a person isn't something this engine can do. You can replace the whole person with Character Replace. Nothing has been charged.";

export const KLING_UNSUPPORTED_PIPELINES: readonly KlingUnsupportedPipeline[] = [
  {
    feature: "face_only",
    supported: false,
    label: "Face Only",
    memberReason: MEMBER_REGION,
    detail: REGION_DETAIL,
    revisitWhen: "Kling documents a mask or region input on Omni, or a dedicated face-swap endpoint on the direct API.",
  },
  {
    feature: "face_skin",
    supported: false,
    label: "Face + Head",
    memberReason: MEMBER_REGION,
    detail: `${REGION_DETAIL} "Face and head, but not the body" needs exactly that missing control.`,
    revisitWhen: "Kling documents region-scoped replacement on Omni.",
  },
  {
    feature: "upper_body",
    supported: false,
    label: "Upper Body",
    memberReason: MEMBER_REGION,
    detail: `${REGION_DETAIL} This verdict is NOT inherited from the old fal.ai capability mapping, which allowed Upper Body on Kling O1 Video Edit — it is refused because the DIRECT API has no region control.`,
    revisitWhen: "Kling documents region control on Omni, or the product decides Upper Body and Character Replace are one operation.",
  },
];

const BY_FEATURE = new Map(KLING_UNSUPPORTED_PIPELINES.map((p) => [p.feature, p]));

export function klingUnsupportedPipeline(feature: string): KlingUnsupportedPipeline | null {
  return BY_FEATURE.get(feature as KlingUnsupportedPipeline["feature"]) ?? null;
}
