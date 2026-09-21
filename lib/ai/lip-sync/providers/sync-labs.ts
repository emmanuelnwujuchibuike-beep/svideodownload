import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import type { LipSyncCapabilities } from "@/lib/ai/lip-sync/config";
import { LipSyncCapabilityError, requireHttps, type LipSyncProProvider, type LipSyncProRequest, type LipSyncProSubmission } from "@/lib/ai/lip-sync/providers/types";
import { createReplicatePrediction, toState } from "@/lib/ai/replicate/provider";
import { replicateSyncLabsProvider } from "@/lib/ai/voice/lipsync-provider";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SYNC LABS on Replicate (sync/lipsync-2-pro · sync/lipsync-2) — AUDIO ONLY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Read from the live schemas on 2026-09-21 (version pins in
 * lib/ai/voice/lipsync-provider.ts, shared with the Character Replace stage):
 *
 *   video          uri, required   "Input video file (.mp4)"
 *   audio          uri, required   "Input audio file (.wav)"
 *   sync_mode      loop | bounce | cut_off | silence | remap   (default loop)
 *   temperature    0–1 (default 0.5)   "How expressive lipsync can be"
 *   active_speaker bool (default false) "whoever is speaking in the clip will be used"
 *
 * There is NO text field (§17: "Do not force text directly into Sync Lipsync
 * 2 Pro"). A text job reaches this adapter only after the worker made the
 * speech with ElevenLabs — `speech.kind` is then "audio". `cut_off` and
 * `remap` are never sent (they change the length the member was priced for).
 */
export const SYNC_LABS_INPUT_FIELDS = ["video", "audio", "sync_mode", "temperature", "active_speaker"] as const;

const CAPABILITIES: LipSyncCapabilities = {
  supports_text: false,
  supports_audio: true,
  supports_voice_selection: false,
  supports_language: false,
  supports_speed: false,
  supports_active_speaker: true,
  supports_temperature: true,
  supports_duration_control: true,
  video: { minDurationMs: null, maxDurationMs: null, minEdgePx: null, maxEdgePx: null, maxBytes: null },
  audio: { maxBytes: null, containers: ["audio/wav"] },
};

export function buildSyncLabsProInput(req: Omit<LipSyncProRequest, "jobId" | "webhookUrl">): { video: string; audio: string; sync_mode: "silence" | "loop" | "bounce"; temperature?: number; active_speaker?: boolean } {
  if (req.speech.kind !== "audio") throw new LipSyncCapabilityError("Sync Labs takes audio, not text — the worker makes the speech first");
  const input: { video: string; audio: string; sync_mode: "silence" | "loop" | "bounce"; temperature?: number; active_speaker?: boolean } = {
    video: requireHttps(req.videoUrl, "the video"),
    audio: requireHttps(req.speech.audioUrl, "the audio"),
    sync_mode: req.syncMode === "loop" || req.syncMode === "bounce" ? req.syncMode : "silence",
  };
  if (typeof req.temperature === "number" && Number.isFinite(req.temperature)) input.temperature = Math.min(1, Math.max(0, req.temperature));
  if (typeof req.activeSpeaker === "boolean") input.active_speaker = req.activeSpeaker;
  return input;
}

export function syncLabsProProvider(model: "sync/lipsync-2-pro" | "sync/lipsync-2"): LipSyncProProvider {
  const base = replicateSyncLabsProvider(model);
  return {
    id: "replicate",
    model,
    version: base.version,
    capabilities: CAPABILITIES,
    nativeVoices: null,
    isConfigured() {
      return base.isConfigured();
    },
    buildInput(req) {
      return buildSyncLabsProInput(req) as unknown as Record<string, unknown>;
    },
    async createPrediction(req: LipSyncProRequest): Promise<LipSyncProSubmission> {
      if (!this.isConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", `lip-sync model ${model} is not configured`);
      const input = buildSyncLabsProInput(req);
      const body = await createReplicatePrediction({ jobId: req.jobId, version: base.version, input: input as unknown as Record<string, unknown>, webhookUrl: req.webhookUrl, label: "lipsync-pro" });
      const state = toState(body, body.id);
      return {
        reference: state.reference,
        status: state.status,
        model,
        modelVersion: state.modelVersion ?? base.version,
        settings: { sync_mode: input.sync_mode, ...(input.temperature !== undefined ? { temperature: input.temperature } : {}), ...(input.active_speaker !== undefined ? { active_speaker: input.active_speaker } : {}) },
      };
    },
  };
}
