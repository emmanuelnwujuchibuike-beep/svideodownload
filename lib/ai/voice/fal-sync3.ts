import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import { falConfigured, falQueueSubmit } from "@/lib/ai/fal/client";
import { FAL_SYNC3, providerRunEstimateUsdCents, type ProviderModelConfig } from "@/lib/ai/providers/config";
import type { LipSyncProvider, LipSyncRequest, LipSyncSubmission } from "@/lib/ai/voice/lipsync-provider";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SYNC-3 on fal.ai — the fal.ai Lip Sync adapter (§16)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Read from the endpoint's published schema on 2026-09-21
 * (fal-ai/sync-lipsync/v3, `Sync3Input`):
 *
 *   video_url   string, required
 *   audio_url   string, required
 *   sync_mode   "cut_off" | "loop" | "bounce" | "silence" | "remap", default "cut_off"
 *   options     Sync3GenerationOptions — model_mode, emotion prompt, temperature,
 *               active speaker detection … NOT sent (§16: "Do not blindly
 *               send unsupported parameters"; §33 of Part 6: "Do not invent
 *               provider parameters").
 *
 * Output: `{ video: { url, content_type, file_name, file_size, width, height,
 * fps, duration, num_frames } }`.
 *
 * ── Audio-driven only (§16) ─────────────────────────────────────────────────
 * This adapter receives a video URL and an AUDIO URL — the worker's prepared
 * WAV, whether the member uploaded it or ElevenLabs v3 synthesised it from
 * text during prepare. Text never reaches Sync-3: there is no field for it.
 *
 * ── Durations ───────────────────────────────────────────────────────────────
 * Our worker has already made the audio the video's length (cut when the
 * member asked, padded with silence when shorter), so `sync_mode` only ever
 * handles a frame's rounding. It is sent from the operator's setting
 * (`audio.syncMode`: silence | loop | bounce — all three are in Sync-3's
 * enum); `cut_off` and `remap` would change the length the member was priced
 * for and are never sent.
 */
export interface Sync3Input {
  video_url: string;
  audio_url: string;
  sync_mode: "silence" | "loop" | "bounce";
}

export const SYNC3_INPUT_FIELDS = ["video_url", "audio_url", "sync_mode"] as const;

export function buildSync3Input(req: { videoUrl: string; audioUrl: string; syncMode: "silence" | "loop" | "bounce" }): Sync3Input {
  if (!/^https:\/\//.test(req.videoUrl) || !/^https:\/\//.test(req.audioUrl)) throw new Error("provider inputs must be https urls");
  const mode = req.syncMode === "loop" || req.syncMode === "bounce" ? req.syncMode : "silence";
  return { video_url: req.videoUrl, audio_url: req.audioUrl, sync_mode: mode };
}

export function falSync3Provider(model: ProviderModelConfig): LipSyncProvider & { estimateUsdCents(durationMs: number): number | null } {
  const endpoint = model.model || FAL_SYNC3;
  return {
    id: "fal",
    model: endpoint,
    version: model.version,
    isConfigured() {
      return falConfigured() && model.enabled && !!endpoint;
    },
    estimateUsdCents(durationMs) {
      return providerRunEstimateUsdCents(model, durationMs);
    },
    buildInput(req) {
      return buildSync3Input(req) as unknown as Record<string, unknown>;
    },
    async createPrediction(req: LipSyncRequest): Promise<LipSyncSubmission> {
      if (!this.isConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", "the fal.ai lip-sync model is not configured");
      const input = buildSync3Input(req);
      const res = await falQueueSubmit(endpoint, input as unknown as Record<string, unknown>, { webhookUrl: req.webhookUrl, label: "sync-3", jobId: req.jobId });
      return {
        reference: res.requestId,
        status: "processing",
        model: endpoint,
        modelVersion: model.version || null,
        settings: { sync_mode: input.sync_mode, queuePosition: res.queuePosition, submitLatencyMs: res.latencyMs },
      };
    },
  };
}
