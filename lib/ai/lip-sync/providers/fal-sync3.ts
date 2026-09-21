import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import { falQueueSubmit } from "@/lib/ai/fal/client";
import type { LipSyncCapabilities } from "@/lib/ai/lip-sync/config";
import { LipSyncCapabilityError, type LipSyncProProvider, type LipSyncProRequest, type LipSyncProSubmission } from "@/lib/ai/lip-sync/providers/types";
import { modelConfigFor, type AiProvidersConfig } from "@/lib/ai/providers/config";
import { buildSync3Input, falSync3Provider } from "@/lib/ai/voice/fal-sync3";

/**
 * Sync-3 on fal.ai (fal-ai/sync-lipsync/v3) for Lip Sync Pro — AUDIO ONLY.
 * The schema (read 2026-09-21): video_url, audio_url, sync_mode; the
 * `options` block (model_mode, emotion prompt, temperature, active speaker)
 * is not sent (§4: "Do not send unsupported parameters"). The input builder
 * is the one the Character Replace lip-sync stage uses (lib/ai/voice/fal-sync3.ts).
 */
const CAPABILITIES: LipSyncCapabilities = {
  supports_text: false,
  supports_audio: true,
  supports_voice_selection: false,
  supports_language: false,
  supports_speed: false,
  supports_active_speaker: false,
  supports_temperature: false,
  supports_duration_control: true,
  video: { minDurationMs: null, maxDurationMs: null, minEdgePx: null, maxEdgePx: null, maxBytes: null },
  audio: { maxBytes: null, containers: ["audio/wav", "audio/mpeg"] },
};

export function falSync3ProProvider(providers: AiProvidersConfig, endpoint?: string): LipSyncProProvider {
  // the endpoint is AI → Lip Sync's own choice (Sync-3, or a newer fal-ai/sync-lipsync/v… the operator typed); the providers tab's model config supplies the rest
  const base = falSync3Provider({ ...modelConfigFor(providers, "lip_sync", "fal"), ...(endpoint ? { model: endpoint } : {}) });
  return {
    id: "fal",
    model: base.model,
    version: base.version,
    capabilities: CAPABILITIES,
    nativeVoices: null,
    isConfigured() {
      return base.isConfigured();
    },
    buildInput(req) {
      if (req.speech.kind !== "audio") throw new LipSyncCapabilityError("Sync-3 takes audio, not text — the worker makes the speech first");
      return buildSync3Input({ videoUrl: req.videoUrl, audioUrl: req.speech.audioUrl, syncMode: req.syncMode }) as unknown as Record<string, unknown>;
    },
    async createPrediction(req: LipSyncProRequest): Promise<LipSyncProSubmission> {
      if (!this.isConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", "the fal.ai lip-sync model is not configured");
      if (req.speech.kind !== "audio") throw new LipSyncCapabilityError("Sync-3 takes audio, not text");
      const input = buildSync3Input({ videoUrl: req.videoUrl, audioUrl: req.speech.audioUrl, syncMode: req.syncMode });
      const res = await falQueueSubmit(base.model, input as unknown as Record<string, unknown>, { webhookUrl: req.webhookUrl, label: "sync-3-pro", jobId: req.jobId });
      return { reference: res.requestId, status: "processing", model: base.model, modelVersion: base.version || null, settings: { sync_mode: input.sync_mode, queuePosition: res.queuePosition, submitLatencyMs: res.latencyMs } };
    },
  };
}
