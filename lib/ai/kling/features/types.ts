import type { KlingAspectRatio, KlingAudioMode, KlingResolution } from "@/lib/ai/kling/features/capabilities";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FEATURE-HANDLER CONTRACT — one handler per product operation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 4 §2: "EVERY FEATURE MUST HAVE ITS OWN PIPELINE. Do NOT create one
 * large generic Kling video pipeline that contains conditional branches for
 * every feature." §4: "The registry may discover the feature, but the registry
 * must not contain the feature's processing logic."
 *
 * So this file is the SHAPE only. Each handler is its own module, owns its own
 * input type, its own validation and its own request body, and shares nothing
 * but the transport (client.ts), the verified limits (capabilities.ts) and the
 * small validators in shared.ts that encode MODEL rules.
 *
 * ── 🔴 `validate` IS PURE, AND THAT IS THE BILLING SAFETY PROPERTY ──────────
 *
 * The Part 1 audit recorded what happens when a capability check runs late:
 * every Lip Sync Pro job failed `SUBMIT_FAILED` because `ai_lip_sync` was
 * missing from a `supports()` list — after the member had been charged, after
 * the video had been downloaded, after the worker had prepared it and made the
 * speech. The refund fired every time and the feature simply never ran.
 *
 * `validate` therefore takes only values a caller already has and touches
 * nothing: no network, no database, no clock it cannot be given. A `/start` can
 * call it BEFORE reserving anything, which is the order §13 requires:
 *
 *      capability → input → quote → reserve/charge → create job → submit
 *
 * `buildRequest` may assume `validate` passed; it is also pure, so every request
 * body in this system can be asserted on in a test without a key.
 */

/** The product operations this migration names. A member never sees these ids. */
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
 *   unsupported — the direct Kling API does not do this. The reason quotes the
 *                 concrete limitation, verified against the live API.
 *   invalid     — Kling could do it; this request may not. The member can fix it.
 */
export type KlingRefusalKind = "unsupported" | "invalid";

export type KlingValidation = { ok: true } | { ok: false; kind: KlingRefusalKind; reason: string };

export const ok: KlingValidation = { ok: true };
export const invalid = (reason: string): KlingValidation => ({ ok: false, kind: "invalid", reason });
export const unsupported = (reason: string): KlingValidation => ({ ok: false, kind: "unsupported", reason });

/**
 * 🔴 HOW SURE WE ARE THAT A HANDLER WORKS — and it is a field, not a comment.
 *
 * The owner's §31.24 is "do not declare unsupported features supported", and the
 * honest answer for some of these is in between. So it is recorded per handler
 * and the routing layer can require `"generation"` before a member's money is
 * ever involved.
 *
 *   generation  a real generation completed end to end against the live API.
 *   fields      every field name and allowed value was verified from the
 *               vendor's own validation messages, but no completed generation
 *               proves the OUTPUT is what the product wants.
 *   none        neither. Nothing may route here.
 */
export type KlingVerification = "generation" | "fields" | "none";

/** Settings every Omni generation shares. A handler may narrow them; none may widen them. */
export interface KlingCommonOptions {
  /**
   * 3–15 s.
   *
   * ⚠️ The vendor does NOT range-check this — `0`, `1` and `20` are all
   * accepted. The window is ours to enforce, which `validateCommonOptions` does.
   */
  durationSeconds?: number;
  /** `settings.resolution` — 480p | 720p | 1080p | 4k (lower-case). */
  resolution?: KlingResolution;
  /** `settings.aspect_ratio` — required unless a first frame is supplied. */
  aspectRatio?: KlingAspectRatio;
  /** `settings.audio` — `native` generates sound, `off` does not. */
  audio?: KlingAudioMode;
}

/**
 * A handler.
 *
 * `TInput` is the feature's OWN input type, declared in the feature's own
 * module. Nothing here is generic over "all features": the registry stores
 * handlers behind a narrow read-only view and each call site knows which one it
 * holds.
 */
export interface KlingFeatureHandler<TInput> {
  readonly id: KlingFeatureId;
  /** For operators and logs. Never shown to a member. */
  readonly label: string;
  /**
   * Whether the direct Kling API serves this operation AT ALL.
   *
   * 🔴 False is a real, documented answer, not a to-do. A handler that answers
   * false must never be made to "work" by routing to Replicate, to fal.ai, to
   * another model or by chaining models (§1, §7, §31.10) — hence
   * `unavailableReason` carries the concrete limitation rather than a shrug.
   */
  readonly available: boolean;
  /** The documented limitation, when `available` is false. Null when it is true. */
  readonly unavailableReason: string | null;
  /** How much of this handler is proven against the live API. See `KlingVerification`. */
  readonly verification: KlingVerification;
  /** The Kling model this handler submits to. */
  readonly model: string;
  /** The create path, when it is not the Omni one (Lip Sync has its own endpoint). */
  readonly path?: string;
  /** Pure. Safe to call before anything is reserved or charged. */
  validate(input: TInput): KlingValidation;
  /** Pure. The exact body for THIS feature. Assumes `validate` passed. */
  buildRequest(input: TInput): Record<string, unknown>;
}

/** A capability declaration for an operation the direct API does not serve. */
export interface KlingUnavailableFeature {
  readonly id: KlingFeatureId;
  readonly label: string;
  readonly available: false;
  readonly unavailableReason: string;
  /** What would have to become true for this to change. Operator-facing. */
  readonly revisitWhen: string;
}
