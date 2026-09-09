import type { AiHardware, AiModelTier } from "@/lib/ai/hardware";
import type { AiCleanEngine } from "@/lib/ai/config";
import type { AiFeatureDef, AiJobStatus, AiProviderId } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — the seam a provider will slot into
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-07 (Part 2): establish the provider interface, do NOT
 * implement Replicate, and do not over-engineer.
 *
 * So this file is four method signatures and no machinery: no plugin loader, no
 * dependency injection, no abstract base class. It exists to answer one
 * question in advance — what does the rest of the system get to assume about a
 * provider? — so that Part 3 writes an adapter instead of a redesign.
 *
 * ── The one decision worth making now ────────────────────────────────────────
 *
 * 🔴 A provider returns a REFERENCE, never a result. `submit` hands back an id
 * and nothing else; the outcome arrives later through `poll` or a webhook. That
 * shape is not about Replicate — it is what stops a job ever being awaited
 * inside an HTTP request, which is the failure this whole architecture is built
 * to avoid: a route holding a connection open for four minutes of video work,
 * timing out at the platform's limit, and leaving a paid-for prediction with
 * nobody listening for it.
 *
 * Every method is therefore fast, and none of them return media.
 */

/** What a provider needs to start work. Assembled by the server, never by a client. */
export interface AiProviderSubmission {
  jobId: string;
  feature: AiFeatureDef;
  /** A short-lived signed URL to the input. The provider never gets a bucket key. */
  sourceUrl: string;
  /** Where the provider should call back when it finishes. */
  webhookUrl: string;
  /**
   * Which engine this job runs on, resolved ONCE by the caller.
   *
   * 🔴 Passed rather than read here, because the answer must not be able to
   * change between a job's two stages. An operator flipping the admin switch
   * mid-flight would otherwise leave a job detected with `hybrid` — already
   * smeared — and then "reconstructed" from that smear, which is worse than
   * either engine on its own. The value is recorded on the job and the worker
   * reads it back from there rather than asking the setting again.
   */
  engine: AiCleanEngine;
  /**
   * Which silicon this job runs on, resolved ONCE by the caller from the
   * member's plan (lib/ai/hardware.ts).
   *
   * 🔴 Passed for the same reason as `engine`: the answer must not be able to
   * change between resolving and submitting. It also must never come from the
   * request — a client that could name its hardware could name the model.
   */
  hardware: AiHardware;
  /**
   * Which MODEL this plan gets — standard, the GPU build, or BRIA (Max AI).
   *
   * 🔴 Separate from `hardware` because "faster" and "more accurate" are
   * different promises sold separately, and BRIA is a different model rather
   * than the same one on better silicon.
   */
  modelTier: AiModelTier;
}

/** What a provider says about work it is holding. */
export interface AiProviderState {
  /** The provider's own id for this work — stored on the job. */
  reference: string;
  status: AiJobStatus;
  /**
   * The exact model version that ran, pinned. Recorded on the job so history
   * stays true after the provider changes its default.
   */
  modelVersion: string | null;
  /** A short-lived URL to the output, when there is one. */
  resultUrl: string | null;
  /** Provider-side failure detail. Stored for operators, never sent to a client. */
  detail: string | null;
}

export interface AiProvider {
  readonly id: AiProviderId;
  /** Whether this deployment holds the credentials it needs. */
  isConfigured(): boolean;
  /** Start work. Returns a reference immediately — never the result. */
  submit(input: AiProviderSubmission): Promise<AiProviderState>;
  /** Ask about work already submitted. */
  poll(reference: string): Promise<AiProviderState>;
  /** Stop work, best effort. A provider that cannot cancel says so by returning false. */
  cancel(reference: string): Promise<boolean>;
  /**
   * Turn a verified callback body into a state.
   *
   * 🔴 Verification is the provider's own job, inside this method, because only
   * the adapter knows how its signatures are made. A route may not treat a
   * webhook as trusted just because it arrived: an unsigned callback is an
   * open invitation to mark anybody's job complete with any result.
   */
  parseWebhook(headers: Headers, rawBody: string): Promise<AiProviderState | null>;
}

/**
 * The providers this build has adapters for.
 *
 * Empty, honestly: Part 2 ships no adapter, and an entry here would be a claim
 * that something can run. `providerFor` therefore returns null for every
 * feature, which is exactly what `featureAvailability` reports to the client —
 * one truth, two places that read it.
 */
const PROVIDERS = new Map<AiProviderId, AiProvider>();

export function registerAiProvider(provider: AiProvider): void {
  PROVIDERS.set(provider.id, provider);
}

export function providerFor(id: AiProviderId): AiProvider | null {
  return PROVIDERS.get(id) ?? null;
}

/** Whether anything can actually run a given feature right now. */
export function hasProviderFor(feature: AiFeatureDef): boolean {
  const provider = providerFor(feature.provider);
  return !!provider && provider.isConfigured();
}
