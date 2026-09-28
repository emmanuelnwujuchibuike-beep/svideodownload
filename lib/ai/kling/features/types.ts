import type { KlingOmniAspectRatio, KlingOmniMode, KlingOmniSound } from "@/lib/ai/kling/features/capabilities";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FEATURE-HANDLER CONTRACT — one handler per product operation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 3: "Do NOT create one giant KlingPipeline or
 * KlingGenerateEverything or a single shared feature switch containing all
 * behavior. Each feature must have its own handler, request construction,
 * validation, and capability declaration."
 *
 * So this file is the SHAPE only — four small members and no machinery. Each
 * handler is its own module, owns its own input type, its own validation and
 * its own request body, and shares nothing but the transport (client.ts), the
 * verified limits (capabilities.ts) and the small validators in shared.ts.
 *
 *        text-to-video   image-to-video   reference-image   …
 *               └────────────┬─────────────────┘
 *                     the shared Kling client
 *                            │
 *                   the EXISTING job system
 *
 * ── 🔴 `validate` IS PURE, AND THAT IS THE BILLING SAFETY PROPERTY (§5) ────
 *
 * The Part 1 audit recorded what happens when a capability check runs late:
 * every Lip Sync Pro job failed `SUBMIT_FAILED` because `ai_lip_sync` was
 * missing from a `supports()` list — after the member had been charged, after
 * the video had been downloaded, after the worker had prepared it and made
 * the speech. The refund fired every time and the feature simply never ran.
 *
 * `validate` therefore takes only values a caller already has and touches
 * nothing: no network, no database, no storage, no clock it cannot be given.
 * A future /start can call it BEFORE reserving anything, which is the order
 * §5 requires:
 *
 *      capability → input → quote → reserve/charge → create job → submit
 *
 * `buildRequest` may assume `validate` passed; it is also pure, so every
 * request body in this system can be asserted on in a test without a key.
 */

/** The product operations this migration cares about. A member never sees these ids. */
export type KlingFeatureId =
  | "text_to_video"
  | "image_to_video"
  | "reference_image"
  | "reference_video"
  | "full_character"
  | "upper_body"
  | "face_only"
  | "face_skin"
  | "lip_sync";

export const KLING_FEATURE_IDS: readonly KlingFeatureId[] = ["text_to_video", "image_to_video", "reference_image", "reference_video", "full_character", "upper_body", "face_only", "face_skin", "lip_sync"];

/**
 * Why a feature is refused.
 *
 *   unsupported — Kling 3.0 Omni does not do this. Permanent until the vendor
 *                 ships it; the reason quotes the documented limitation.
 *   invalid     — the model could do it; this request may not. The member can
 *                 fix it.
 */
export type KlingRefusalKind = "unsupported" | "invalid";

export type KlingValidation = { ok: true } | { ok: false; kind: KlingRefusalKind; reason: string };

export const ok: KlingValidation = { ok: true };
export const invalid = (reason: string): KlingValidation => ({ ok: false, kind: "invalid", reason });
export const unsupported = (reason: string): KlingValidation => ({ ok: false, kind: "unsupported", reason });

/** Settings every Omni generation shares. A handler may narrow them; none may widen them. */
export interface KlingCommonOptions {
  /** 3–15 s. Omitted = the vendor's default (5). */
  durationSeconds?: number;
  mode?: KlingOmniMode;
  aspectRatio?: KlingOmniAspectRatio;
  /** Omni's native audio. Refused alongside a reference video — the vendor's rule, not ours. */
  sound?: KlingOmniSound;
  negativePrompt?: string;
}

/**
 * A handler.
 *
 * `TInput` is the feature's OWN input type, declared in the feature's own
 * module. Nothing here is generic over "all features": the registry stores
 * handlers behind a narrow read-only view and each call site knows which one
 * it holds.
 */
export interface KlingFeatureHandler<TInput> {
  readonly id: KlingFeatureId;
  /** For operators and logs. Never shown to a member. */
  readonly label: string;
  /**
   * Whether Kling 3.0 Omni serves this operation AT ALL on the direct API.
   *
   * 🔴 False is a real, documented answer, not a to-do. A handler that
   * answers false must never be made to "work" by routing to Replicate, to
   * fal.ai, to another model or by chaining models — the owner's Part 3 rule,
   * and the reason `unavailableReason` carries the concrete limitation rather
   * than a shrug.
   */
  readonly available: boolean;
  /** The documented limitation, when `available` is false. Null when it is true. */
  readonly unavailableReason: string | null;
  /** The Kling model this handler submits to. */
  readonly model: string;
  /** Pure. Safe to call before anything is reserved or charged. */
  validate(input: TInput): KlingValidation;
  /** Pure. The exact body for THIS feature. Assumes `validate` passed. */
  buildRequest(input: TInput): Record<string, unknown>;
}

/** A handler whose input type the caller has not yet narrowed — what the registry stores. */
export type AnyKlingFeatureHandler = KlingFeatureHandler<never> & {
  validate(input: unknown): KlingValidation;
  buildRequest(input: unknown): Record<string, unknown>;
};

/** A capability declaration for an operation Omni does not serve — no input type, no request builder. */
export interface KlingUnavailableFeature {
  readonly id: KlingFeatureId;
  readonly label: string;
  readonly available: false;
  readonly unavailableReason: string;
  /** What Part 4+ would have to be true for this to change. Operator-facing. */
  readonly revisitWhen: string;
}
