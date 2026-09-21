import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import type { AiJobStatus } from "@/lib/ai/jobs";
import { createReplicatePrediction, toState } from "@/lib/ai/replicate/provider";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LIP SYNC — the provider seam, and the Sync Labs implementation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 6 §8: "Create an abstraction LipSyncProvider. Then implement
 * ReplicateLipSyncProvider. Use sync/lipsync-2-pro as the initial premium
 * provider… The provider abstraction must make it possible to switch to
 * another model later." §33: "Do not invent provider parameters."
 *
 * Read from the live schemas on 2026-09-14:
 *
 *   sync/lipsync-2-pro   version e00dd8e1…  (2026-07-10)  "Studio-grade lipsync"
 *   sync/lipsync-2       version 4f8dc3cf…  (2026-07-10)  "Sync Labs' 2.0 model"
 *
 *   video           string (uri)   "Input video file (.mp4)"   required
 *   audio           string (uri)   "Input audio file (.wav)"   required
 *   sync_mode       "loop" | "bounce" | "cut_off" | "silence" | "remap"   default "loop"
 *                   "Lipsync mode when audio and video durations are out of sync"
 *   temperature     0–1   default 0.5   "How expressive lipsync can be"
 *   active_speaker  bool  default false "detect active speaker… whoever is speaking in the clip"
 *   output          string (uri)
 *
 * The published price of lipsync-2-pro (about $0.08325 per second of output,
 * per the owner's brief) is a provider cost: it lives in the admin's estimate
 * (`lipSyncProviderUsdCentsPerSecond`) and never in the customer UI (§8).
 *
 * ── The tiers → the models ──────────────────────────────────────────────────
 *
 * Standard runs `sync/lipsync-2`, Studio runs `sync/lipsync-2-pro` — the
 * model name is on each tier in the configuration (config.ts `lipSync[]
 * .model`), editable without a deploy; the version pin is here.
 *
 * ── Durations (§4, §9) ──────────────────────────────────────────────────────
 *
 * Our worker has already made the audio the video's length — cut when the
 * member asked for it, padded with silence when it was shorter — so the
 * provider's `sync_mode` only ever handles a frame's rounding. It is sent
 * from the operator's setting (default `silence`: the character stops
 * speaking rather than the clip looping), never `cut_off` or `remap`, both
 * of which would change the length the member was priced for.
 */

export interface LipSyncRequest {
  jobId: string;
  /** The REPLACED video (the replacement stage's output, in our bucket), signed. §10: never the original. */
  videoUrl: string;
  /** The prepared WAV, signed. */
  audioUrl: string;
  syncMode: "silence" | "loop" | "bounce";
  webhookUrl: string;
}

export interface LipSyncSubmission {
  reference: string;
  status: AiJobStatus;
  model: string;
  modelVersion: string | null;
  settings: Record<string, unknown>;
}

export interface LipSyncProvider {
  readonly id: "replicate" | "fal";
  readonly model: string;
  readonly version: string;
  isConfigured(): boolean;
  buildInput(req: Omit<LipSyncRequest, "jobId" | "webhookUrl">): Record<string, unknown>;
  createPrediction(req: LipSyncRequest): Promise<LipSyncSubmission>;
}

const SYNC_VERSIONS: Record<string, string> = {
  "sync/lipsync-2-pro": "e00dd8e1b1ef26d1f350786bf329006baeb5022abf936e6c0cb36086866c385f",
  "sync/lipsync-2": "4f8dc3cfda4ff844a6158ac347d21fcd025210f6dad4b16265fc53074ee4f77f",
};

/** The owner's figure for lipsync-2-pro, in US cents per second of output. Standard is not published in the brief; zero = unknown. */
export function lipSyncProviderUsdCentsPerSecond(model: string): number {
  if (model === "sync/lipsync-2-pro") return 8.325;
  return 0;
}

export interface SyncLabsInput {
  video: string;
  audio: string;
  sync_mode: "silence" | "loop" | "bounce";
}

export const SYNC_INPUT_FIELDS = ["video", "audio", "sync_mode"] as const;

export function buildSyncLabsInput(req: { videoUrl: string; audioUrl: string; syncMode: "silence" | "loop" | "bounce" }): SyncLabsInput {
  if (!/^https:\/\//.test(req.videoUrl) || !/^https:\/\//.test(req.audioUrl)) throw new Error("provider inputs must be https urls");
  const mode = req.syncMode === "loop" || req.syncMode === "bounce" ? req.syncMode : "silence";
  return { video: req.videoUrl, audio: req.audioUrl, sync_mode: mode };
}

export function replicateSyncLabsProvider(model: string): LipSyncProvider {
  const version = (model === "sync/lipsync-2-pro" ? process.env.REPLICATE_LIPSYNC_PRO_VERSION?.trim() : process.env.REPLICATE_LIPSYNC_VERSION?.trim()) || SYNC_VERSIONS[model] || "";
  return {
    id: "replicate",
    model,
    version,
    isConfigured() {
      return !!process.env.REPLICATE_API_TOKEN?.trim() && !!version;
    },
    buildInput(req) {
      return buildSyncLabsInput(req) as unknown as Record<string, unknown>;
    },
    async createPrediction(req) {
      if (!this.isConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", `lip-sync model ${model} is not configured`);
      const input = this.buildInput(req);
      const body = await createReplicatePrediction({ jobId: req.jobId, version, input, webhookUrl: req.webhookUrl, label: "lipsync" });
      const state = toState(body, body.id);
      return { reference: state.reference, status: state.status, model, modelVersion: state.modelVersion ?? version, settings: { sync_mode: input.sync_mode } };
    },
  };
}

/** The provider for the model an operator configured on a tier. An unknown model is unconfigured — refused, never guessed. */
export function lipSyncProviderFor(model: string): LipSyncProvider {
  if (/^sync\/lipsync-2(-pro)?$/.test(model)) return replicateSyncLabsProvider(model);
  return {
    id: "replicate",
    model,
    version: "",
    isConfigured: () => false,
    buildInput: () => {
      throw new AiJobError("FEATURE_UNAVAILABLE", `no lip-sync adapter for ${model}`);
    },
    createPrediction: async () => {
      throw new AiJobError("FEATURE_UNAVAILABLE", `no lip-sync adapter for ${model}`);
    },
  };
}
