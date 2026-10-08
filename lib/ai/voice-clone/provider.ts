import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import { elevenLabsAddVoice, elevenLabsConfigured, elevenLabsDeleteVoice, elevenLabsEditVoice, ElevenLabsError, type ElevenLabsVoiceSample } from "@/lib/ai/voice/elevenlabs";
import type { VoiceCloneConfig } from "@/lib/ai/voice-clone/config";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VOICE CLONING — the provider seam, and its one implementation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The same shape as every other provider in this project: an interface the
 * application layer sees, and one adapter that is the only file knowing the
 * vendor's field names. The clone path never touches Replicate or fal.ai —
 * 2026-09-27 the owner stopped all new work on both, and the direct
 * ElevenLabs API is the audio path.
 *
 * ── 🔴 WHY THERE IS NO PREDICTION, NO WEBHOOK AND NO WORKER ─────────────────
 *
 * Instant cloning answers in the request, in a second or two, with a voice id
 * and nothing else — no file to bring home, no frames, no ffmpeg. Putting it
 * through the video machinery would mean a prediction row, a webhook route, a
 * pipeline stage and a finalizer lease, all to carry one string. The owner's
 * standing instruction for this session says it plainly: every AI feature its
 * own standalone pipeline, "a cleaner premium result rather than making them
 * all go through same pipeline."
 *
 * So the whole provider step is one call, made after the response
 * (`after()`), and the job is complete when the row exists.
 */
/** A sample as the provider takes it. Aliased rather than redeclared so the two cannot drift. */
export type VoiceCloneSample = ElevenLabsVoiceSample;

export interface VoiceCloneResult {
  providerVoiceId: string;
  providerName: string;
}

export interface VoiceCloneProvider {
  readonly id: "elevenlabs";
  readonly model: string;
  isConfigured(): boolean;
  /** Make the voice. Throws `AiJobError` with a code the caller can act on. */
  clone(req: { name: string; description: string; samples: readonly VoiceCloneSample[]; labels?: Record<string, string>; removeBackgroundNoise?: boolean }): Promise<VoiceCloneResult>;
  /** Best-effort: keep the provider's copy of the name in step with ours. */
  rename(req: { providerVoiceId: string; name: string; description: string }): Promise<void>;
  /** Free the slot. `alreadyGone` is a success. */
  remove(providerVoiceId: string): Promise<{ deleted: boolean; alreadyGone: boolean }>;
}

/**
 * The provider's own refusals, mapped to codes this product can act on:
 *
 *   input  → VOICE_CLONE_REJECTED  the samples are the problem (too short,
 *            unreadable, too quiet, a format the vendor will not take). The
 *            member can fix it, so they are told so and refunded.
 *   auth   → FEATURE_UNAVAILABLE   the key is missing or the plan does not
 *            include cloning, or the account is out of voice slots on the
 *            vendor's side. The operator's problem, said loudly in the log.
 *   else   → PROVIDER_ERROR        transient; the member may try again.
 */
function mapFailure(e: unknown): AiJobError {
  if (e instanceof ElevenLabsError) {
    if (e.kind === "input") return new AiJobError("VOICE_CLONE_REJECTED", e.message);
    if (e.kind === "auth") return new AiJobError("FEATURE_UNAVAILABLE", e.message);
    return new AiJobError("PROVIDER_ERROR", e.message);
  }
  return new AiJobError("PROVIDER_ERROR", e instanceof Error ? e.message : String(e));
}

export function elevenLabsVoiceCloneProvider(model: string): VoiceCloneProvider {
  return {
    id: "elevenlabs",
    model,
    isConfigured() {
      return elevenLabsConfigured();
    },
    async clone(req) {
      if (!elevenLabsConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", "ELEVENLABS_API_KEY is not set on this deployment");
      if (req.samples.length === 0) throw new AiJobError("INVALID_INPUT", "a clone needs at least one sample");
      try {
        const made = await elevenLabsAddVoice(req);
        return { providerVoiceId: made.voiceId, providerName: made.name };
      } catch (e) {
        throw mapFailure(e);
      }
    },
    async rename(req) {
      if (!elevenLabsConfigured()) return;
      try {
        await elevenLabsEditVoice({ voiceId: req.providerVoiceId, name: req.name, description: req.description });
      } catch (e) {
        // never fails the member's rename: our row is the name they see
        console.warn("[vc/provider] provider rename failed", { voiceId: req.providerVoiceId, error: String(e).slice(0, 200) });
      }
    },
    async remove(providerVoiceId) {
      if (!elevenLabsConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", "ELEVENLABS_API_KEY is not set on this deployment");
      try {
        return await elevenLabsDeleteVoice(providerVoiceId);
      } catch (e) {
        throw mapFailure(e);
      }
    },
  };
}

/** The provider for the operator's configured model. One vendor today; the seam is what makes a second one a file rather than a rewrite. */
export function voiceCloneProviderFor(config: VoiceCloneConfig): VoiceCloneProvider {
  return elevenLabsVoiceCloneProvider(config.model);
}

export interface ResolvedVoiceCloneProvider {
  provider: VoiceCloneProvider;
  enabled: boolean;
  configured: boolean;
  diagnostic: string | null;
}

/** Whether this deployment can actually clone right now — the offer and the refusal must never disagree. */
export function resolveVoiceCloneProvider(config: VoiceCloneConfig): ResolvedVoiceCloneProvider {
  const provider = voiceCloneProviderFor(config);
  const configured = provider.isConfigured();
  return {
    provider,
    enabled: config.enabled,
    configured,
    diagnostic: !config.enabled ? "Voice Cloning is switched off" : !configured ? "ELEVENLABS_API_KEY is not set on this deployment" : null,
  };
}
