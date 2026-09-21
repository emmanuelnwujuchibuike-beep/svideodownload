import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import type { LipSyncCapabilities } from "@/lib/ai/lip-sync/config";
import { LipSyncCapabilityError, requireHttps, type LipSyncProProvider, type LipSyncProRequest, type LipSyncProSubmission, type NativeVoice } from "@/lib/ai/lip-sync/providers/types";
import { KLING_VOICES_PUBLIC } from "@/lib/ai/lip-sync/voices-public";
import { createReplicatePrediction, toState } from "@/lib/ai/replicate/provider";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KLING LIP SYNC on Replicate (kwaivgi/kling-lip-sync) — TEXT-NATIVE, or audio
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Read from the live schema on 2026-09-21 (version 8311467f…, 2025-11-07):
 *
 *   video_url    string   "an .mp4 or .mov file, less than 100MB, a duration
 *                          of 2-10 seconds, a resolution of 720p-1080p
 *                          (720-1920px dimensions)"
 *   audio_file   uri      ".mp3, .wav, .m4a, or .aac and less than 5MB"
 *   text         string   "Text content for lip sync (if not using audio)"
 *   voice_id     enum     46 Kling voices, default "en_AOT" (text only)
 *   voice_speed  number   0.8–2.0, default 1 (text only)
 *   video_id     string   a Kling-generated video — never used here
 *
 * So this model speaks the text ITSELF (§5, §17): a text job sends `text`,
 * `voice_id`, `voice_speed`; an audio job sends `audio_file`. Exactly one —
 * the schema says "if not using audio", and the builder refuses a request
 * that would name both. No sync mode, no temperature, no speaker detection
 * exist on this model, so the capability flags say so and the interface
 * hides those controls while it is active (§8, §9, §12).
 */
export const KLING_LIP_SYNC_MODEL = "kwaivgi/kling-lip-sync";
export const KLING_LIP_SYNC_VERSION = "8311467f07043d4b3feb44584d2586bfa2fc70203eca612ed26f84d0b55df3ce";
export const KLING_LIP_SYNC_INPUT_FIELDS = ["video_url", "audio_file", "text", "voice_id", "voice_speed"] as const;

export const KLING_LIP_SYNC_LIMITS = {
  video: { minDurationMs: 2_000, maxDurationMs: 10_000, minEdgePx: 720, maxEdgePx: 1920, maxBytes: 100 * 1024 * 1024 },
  audio: { maxBytes: 5 * 1024 * 1024, containers: ["audio/mpeg", "audio/wav", "audio/mp4", "audio/aac"] as const },
  speed: { min: 0.8, max: 2.0 },
} as const;

/**
 * The model's own voices — the schema's enum, with a member-facing label.
 * English first; the Chinese voices are offered when the language is zh.
 * The ids are the provider's and never typed by a member: the interface
 * sends a catalogue id the server maps back to one of these.
 */
export const KLING_VOICES: readonly NativeVoice[] = KLING_VOICES_PUBLIC;
const VOICE_IDS = new Set(KLING_VOICES.map((v) => v.id));

const CAPABILITIES: LipSyncCapabilities = {
  supports_text: true,
  supports_audio: true,
  supports_voice_selection: true,
  supports_language: true,
  supports_speed: true,
  supports_active_speaker: false,
  supports_temperature: false,
  supports_duration_control: false,
  video: { ...KLING_LIP_SYNC_LIMITS.video },
  audio: { maxBytes: KLING_LIP_SYNC_LIMITS.audio.maxBytes, containers: KLING_LIP_SYNC_LIMITS.audio.containers },
};

export type KlingLipSyncInput = { video_url: string } & ({ audio_file: string } | { text: string; voice_id: string; voice_speed: number });

export function buildKlingLipSyncInput(req: Omit<LipSyncProRequest, "jobId" | "webhookUrl">): KlingLipSyncInput {
  const video_url = requireHttps(req.videoUrl, "the video");
  if (req.facts) {
    const f = req.facts;
    const L = KLING_LIP_SYNC_LIMITS.video;
    if (f.durationMs < L.minDurationMs || f.durationMs > L.maxDurationMs) throw new LipSyncCapabilityError(`Kling Lip Sync takes 2–10 s of video; the prepared file is ${f.durationMs} ms`);
    if (Math.min(f.width, f.height) < L.minEdgePx || Math.max(f.width, f.height) > L.maxEdgePx) throw new LipSyncCapabilityError(`Kling Lip Sync takes 720–1920 px; the prepared file is ${f.width}x${f.height}`);
    if (f.bytes > L.maxBytes) throw new LipSyncCapabilityError("Kling Lip Sync takes videos under 100 MB");
  }
  if (req.speech.kind === "audio") {
    if (req.audioFacts && req.audioFacts.bytes > KLING_LIP_SYNC_LIMITS.audio.maxBytes) throw new LipSyncCapabilityError("Kling Lip Sync takes audio under 5 MB");
    return { video_url, audio_file: requireHttps(req.speech.audioUrl, "the audio") };
  }
  // text: the model speaks it — never both fields (the schema: "if not using audio")
  const voice = req.speech.providerVoiceId && VOICE_IDS.has(req.speech.providerVoiceId) ? req.speech.providerVoiceId : "en_AOT";
  const speed = Math.min(KLING_LIP_SYNC_LIMITS.speed.max, Math.max(KLING_LIP_SYNC_LIMITS.speed.min, Number.isFinite(req.speech.speed) ? req.speech.speed : 1));
  const text = req.speech.text.trim();
  if (!text) throw new LipSyncCapabilityError("text mode needs text");
  return { video_url, text, voice_id: voice, voice_speed: Math.round(speed * 100) / 100 };
}

export function klingLipSyncProvider(): LipSyncProProvider {
  const version = process.env.REPLICATE_KLING_LIPSYNC_VERSION?.trim() || KLING_LIP_SYNC_VERSION;
  return {
    id: "replicate",
    model: KLING_LIP_SYNC_MODEL,
    version,
    capabilities: CAPABILITIES,
    nativeVoices: KLING_VOICES,
    isConfigured() {
      return !!process.env.REPLICATE_API_TOKEN?.trim() && !!version;
    },
    buildInput(req) {
      return buildKlingLipSyncInput(req) as unknown as Record<string, unknown>;
    },
    async createPrediction(req: LipSyncProRequest): Promise<LipSyncProSubmission> {
      if (!this.isConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", "Kling Lip Sync is not configured");
      const input = buildKlingLipSyncInput(req);
      const body = await createReplicatePrediction({ jobId: req.jobId, version, input: input as unknown as Record<string, unknown>, webhookUrl: req.webhookUrl, label: "kling-lipsync" });
      const state = toState(body, body.id);
      return {
        reference: state.reference,
        status: state.status,
        model: KLING_LIP_SYNC_MODEL,
        modelVersion: state.modelVersion ?? version,
        settings: "text" in input ? { speech: "native-text", voice_id: input.voice_id, voice_speed: input.voice_speed, characters: input.text.length } : { speech: "audio" },
      };
    },
  };
}
