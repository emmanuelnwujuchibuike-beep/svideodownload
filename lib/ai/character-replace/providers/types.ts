import "server-only";

import type { ReplacementMode } from "@/lib/ai/character-replace/modes";
import type { CharacterReplaceAnyQuality } from "@/lib/ai/character-replace/pricing";
import type { AiJobStatus } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE REPLACEMENT PROVIDER SEAM (Part 6; capabilities 2026-09-20)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One adapter per MODEL. A mode is routed to an adapter by configuration
 * (`modes[mode].provider.model`, providers/router.ts), and an adapter says in
 * its capabilities which modes, tiers, reference counts and audio it can
 * honour — so the router can refuse a mis-configuration ("Upper Body on a
 * face-swap model") before anything is priced, and the admin form can offer
 * only the models that fit a scope. The customer never sees a model name.
 */
export interface ReplacementRequest {
  jobId: string;
  mode: ReplacementMode;
  videoUrl: string;
  referenceImageUrls: readonly string[];
  quality: CharacterReplaceAnyQuality;
  keepOriginalAudio: boolean;
  goFast: boolean;
  webhookUrl: string;
}

export interface ReplacementSubmission {
  reference: string;
  status: AiJobStatus;
  model: string;
  modelVersion: string | null;
  settings: Record<string, unknown>;
  mergeAudio: boolean;
}

/**
 * What a model can do (the replacement-scope brief §4). Pure facts about the
 * provider, read by the router, the admin form's warnings and the start
 * route's estimate — never by a member.
 */
export interface ReplacementCapabilities {
  /** The scopes this model can honour. */
  modes: readonly ReplacementMode[];
  /** The quality/tier ids this model can honour FOR a scope (a tier the mode's map marks unsupported is still refused by the map). */
  supportsTier(mode: ReplacementMode, quality: CharacterReplaceAnyQuality): boolean;
  /** Whether the model can keep the source audio in its own output (otherwise the finalizer restores it). */
  keepsAudio: boolean;
  /** How many reference images the model takes, at most. */
  maxReferenceImages: number;
  /** The reference framing the model was made for, for the operator's eye. */
  referenceFraming: "portrait" | "head_shoulders" | "half_body" | "full_body" | "any";
}

export interface ReplacementProvider {
  readonly id: "replicate";
  /** The scope this adapter was written for; `capabilities.modes` lists every scope it can serve. */
  readonly mode: ReplacementMode;
  readonly model: string;
  readonly version: string;
  readonly capabilities: ReplacementCapabilities;
  isConfigured(): boolean;
  supportsMode(mode: ReplacementMode): boolean;
  buildInput(req: Omit<ReplacementRequest, "jobId" | "webhookUrl">): Record<string, unknown>;
  settingsFor(quality: CharacterReplaceAnyQuality): Record<string, unknown> | null;
  /**
   * The operator's estimate of what THIS provider bills for a run, in US
   * cents, from the mode's configured per-second figure. Null = unknown.
   * Admin-only (margin monitoring, warnings); never shown to a member.
   */
  estimateProcessingCostUsdCents(durationMs: number, perSecondUsdCents: number): number | null;
  createPrediction(req: ReplacementRequest): Promise<ReplacementSubmission>;
}

/** The shared cost estimate: seconds × the operator's per-second figure, rounded up; unknown when the figure is 0. */
export function linearCostEstimate(durationMs: number, perSecondUsdCents: number): number | null {
  if (!Number.isFinite(perSecondUsdCents) || perSecondUsdCents <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  return Math.ceil((durationMs / 1000) * perSecondUsdCents);
}
