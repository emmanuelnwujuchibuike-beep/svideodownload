import type { KlingPricedFeature, KlingPricedResolution, KlingPricingConfig, KlingQuote } from "@/lib/ai/kling/pricing";
import type { KlingValidation } from "@/lib/ai/kling/features/types";
import type { AiFeature } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PIPELINE CONTRACT — one pipeline per feature, owning its whole lifecycle
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 5 §2: "EVERY FEATURE MUST HAVE ITS OWN PIPELINE. Do NOT create one
 * giant shared video pipeline… Each pipeline must: validate its own inputs,
 * build its own Kling request, calculate its own usage, submit independently,
 * track its own provider run, receive its own callback, process its own result,
 * finalize its own output, preserve the common job/notification infrastructure
 * where appropriate. Shared infrastructure is allowed. Shared feature execution
 * is NOT."
 *
 * That distinction is the whole design of this directory:
 *
 *   SHARED (infrastructure)        NEVER SHARED (execution)
 *   the HTTP client                which endpoint this feature calls
 *   signing and callback verify    what its request body looks like
 *   status normalisation           what counts as valid input
 *   the job row + transitions      how its usage is calculated
 *   storage, notifications         what its result means
 *
 * There is deliberately no `runKlingVideo(feature, input)` anywhere. A function
 * with that shape would have to branch on the feature to build a body, and that
 * branch is the "giant shared pipeline" §2 forbids — it is how one feature's
 * change silently alters another's output.
 *
 * ── 🔴 WHY UNSUPPORTED FEATURES STILL GET AN ENTRY ─────────────────────────
 *
 * §10 and §37: an unsupported capability must be "marked as unavailable" with "a
 * clean UI state" and the architecture "ready for future direct Kling support" —
 * never approximated, never routed to another provider. So Reference Image,
 * Reference Video, Full Character and the body-region scopes are declared here
 * with their evidence, not omitted. The registry is then a complete map of every
 * feature the product names, and the UI can render an honest state for each.
 */

/** The product features this migration names. One pipeline entry each, supported or not. */
export type KlingPipelineFeature =
  | "text_to_video"
  | "image_to_video"
  | "reference_image"
  | "reference_video"
  | "full_character"
  | "face_only"
  | "face_skin"
  | "upper_body"
  | "lip_sync";

export const KLING_PIPELINE_FEATURES: readonly KlingPipelineFeature[] = [
  "text_to_video",
  "image_to_video",
  "reference_image",
  "reference_video",
  "full_character",
  "face_only",
  "face_skin",
  "upper_body",
  "lip_sync",
];

/**
 * §36: the states the backend may report to the frontend.
 *
 *   available              the pipeline can run this right now
 *   admin_disabled         an operator turned the tier off, or paused Kling
 *   temporarily_unavailable the credential is missing or the vendor is unreachable
 *   unsupported            🔴 the direct Kling API cannot do this AT ALL. Not a
 *                          configuration problem and not a to-do — a verified
 *                          limitation, with the evidence in `reason`.
 *
 * 🔴 "The UI must never display a feature as available if the backend cannot
 * actually execute it" (§36). `available` is therefore computed from the
 * pipeline AND the live configuration, never declared by hand.
 */
export type KlingCapabilityState = "available" | "admin_disabled" | "temporarily_unavailable" | "unsupported";

export interface KlingCapabilityReport {
  feature: KlingPipelineFeature;
  /** What a member sees this called. */
  label: string;
  state: KlingCapabilityState;
  /** Why, when the state is not `available`. A sentence a member could read. */
  reason: string | null;
  /** The operator's detail — the verified limitation, or what to fix. Never shown to a member. */
  detail: string | null;
  /** What would have to become true. Null when it is available. */
  revisitWhen: string | null;
}

/**
 * A pipeline that can actually run.
 *
 * `TInput` is the feature's OWN input type, declared in the feature's own
 * module. Nothing is generic over "all features".
 */
export interface KlingSupportedPipeline<TInput> {
  readonly feature: KlingPipelineFeature;
  readonly supported: true;
  readonly label: string;
  /**
   * The `ai_jobs.feature` value a job of this kind carries. Distinct from
   * `feature` above: that is the product operation, this is the DB row's tool.
   */
  readonly aiFeature: AiFeature;
  /**
   * 🔴 THE ENDPOINT THIS PIPELINE OWNS — §4: "the feature registry must make it
   * obvious which Kling endpoint/capability owns each feature". Written on the
   * pipeline rather than decided by a shared submitter, so the mapping is
   * readable in one place and testable.
   */
  readonly endpoint: string;
  readonly model: string;
  /** Which row of the pricing matrix this feature bills against. */
  readonly pricedAs: KlingPricedFeature;

  /** 🔴 ITS OWN rules (§27). Pure — safe to call before anything is reserved. */
  validate(input: TInput): KlingValidation;
  /** 🔴 ITS OWN request body (§2). Pure, and asserted on directly in tests. */
  buildRequest(input: TInput): Record<string, unknown>;
  /**
   * 🔴 ITS OWN usage calculation (§2, §21).
   *
   * The pipeline decides what is billable about ITS request — the duration a
   * member actually chose, the resolution actually asked for, whether audio is
   * on. It then defers the arithmetic to the one shared calculator, so
   * subscription and prepaid cannot diverge (§25). Deciding the dimensions is
   * the feature's business; turning them into money is not.
   */
  quote(input: TInput, pricing: KlingPricingConfig): KlingQuote;
}

/** A feature the direct Kling API cannot perform. Declared, with its evidence. */
export interface KlingUnsupportedPipeline {
  readonly feature: KlingPipelineFeature;
  readonly supported: false;
  readonly label: string;
  /** A sentence a member can read. Never mentions a provider. */
  readonly memberReason: string;
  /** The verified limitation, for operators and for the next engineer. */
  readonly detail: string;
  /** What would have to become true for this to be reconsidered. */
  readonly revisitWhen: string;
}

export type KlingAnyPipeline = KlingSupportedPipeline<never> | KlingUnsupportedPipeline;

/** Narrowing helper, so a call site cannot read `endpoint` off an unsupported entry. */
export function isSupportedPipeline(p: { supported: boolean }): p is KlingSupportedPipeline<never> {
  return p.supported === true;
}

/** The resolution a request will actually be billed and generated at. */
export type KlingPipelineResolution = KlingPricedResolution;
