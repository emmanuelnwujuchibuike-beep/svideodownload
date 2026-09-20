import "server-only";

import { linearCostEstimate, type ReplacementProvider, type ReplacementRequest, type ReplacementSubmission } from "@/lib/ai/character-replace/providers/types";
import { SKIN_FACE_PRESERVATION_PROMPT, SKIN_FACE_TIER_MAP, isReplacementTierId, type SkinFaceProviderSettings } from "@/lib/ai/character-replace/modes";
import { AiJobError } from "@/lib/ai/errors";
import { createReplicatePrediction, toState } from "@/lib/ai/replicate/provider";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SKIN + FACE → prunaai/p-video-replace
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Skin + Face brief §1: "Transfer the reference person's identity/face and
 * exposed skin appearance while attempting to preserve the original video's
 * clothing, body, pose, movement, environment and camera."
 *
 * Read from the live schema on 2026-09-14 (version 4638788b…, 2026-09-11):
 *
 *   video                    string (uri)   "Source RGB video (.mp4): motion + audio source."   required
 *   images                   uri[] (1–3)    "Identity reference image(s) (1-3) to place into the video."   required
 *   instruction_prompt       string         "Further instruction on how to place the people…"   default ""
 *   resolution               "720p" | "1080p"   default "720p"
 *   target_fps               "original" | "24" | "48"   default "original"
 *   save_audio               boolean   default true    "Save the video with audio."
 *   ignore_audio             boolean   default false   "Ignore source audio during generation."
 *   turbo                    boolean   default false   "faster generation for slightly lower quality"
 *   disable_safety_checker   boolean   default false
 *   seed                     integer   optional
 *   no_op                    boolean   default false
 *   output                   string (uri)
 *
 * `buildInput` sends video, images, the preservation instruction (§4,
 * verbatim from the owner), the tier's resolution / turbo / target_fps
 * (modes.ts — three real configurations), and `save_audio` for the audio
 * decision. Never `seed`, `no_op` or `disable_safety_checker`: determinism
 * is not offered, the last two are not ours to flip.
 */
export const P_VIDEO_REPLACE = {
  model: "prunaai/p-video-replace",
  version: process.env.REPLICATE_SKIN_FACE_VERSION?.trim() || "4638788bce26cc4f769dd20e7c8eaded9f33286e2b06c7f8fb00d50e6ddd250f",
} as const;

export interface SkinFaceInput {
  video: string;
  images: string[];
  instruction_prompt: string;
  resolution: "720p" | "1080p";
  target_fps: "original" | "24" | "48";
  turbo: boolean;
  save_audio: boolean;
}

export const SKIN_FACE_INPUT_FIELDS = ["video", "images", "instruction_prompt", "resolution", "target_fps", "turbo", "save_audio"] as const;

export function buildSkinFaceInput(opts: { videoUrl: string; imageUrls: readonly string[]; settings: SkinFaceProviderSettings; saveAudio: boolean }): SkinFaceInput {
  if (!/^https:\/\//.test(opts.videoUrl)) throw new Error("provider inputs must be https urls");
  const images = opts.imageUrls.slice(0, 3);
  if (images.length < 1) throw new Error("p-video-replace needs 1 to 3 reference images");
  for (const u of images) if (!/^https:\/\//.test(u)) throw new Error("provider inputs must be https urls");
  return {
    video: opts.videoUrl,
    images,
    instruction_prompt: SKIN_FACE_PRESERVATION_PROMPT,
    resolution: opts.settings.resolution,
    target_fps: opts.settings.target_fps,
    turbo: opts.settings.turbo === true,
    save_audio: opts.saveAudio === true,
  };
}

export const skinFaceProvider: ReplacementProvider = {
  id: "replicate",
  mode: "skin_face",
  model: P_VIDEO_REPLACE.model,
  version: P_VIDEO_REPLACE.version,
  // Identity, face and skin from 1–3 references; the body and clothes of the video stay. The "Face + Head" model.
  capabilities: {
    modes: ["skin_face"],
    supportsTier: (_mode, quality) => isReplacementTierId(quality) && SKIN_FACE_TIER_MAP[quality].support === "supported",
    keepsAudio: true,
    maxReferenceImages: 3,
    referenceFraming: "head_shoulders",
  },
  supportsMode(mode) {
    return this.capabilities.modes.includes(mode);
  },
  estimateProcessingCostUsdCents: linearCostEstimate,

  isConfigured() {
    return !!process.env.REPLICATE_API_TOKEN?.trim() && !!P_VIDEO_REPLACE.version;
  },

  settingsFor(quality) {
    if (!isReplacementTierId(quality)) return null;
    const map = SKIN_FACE_TIER_MAP[quality];
    return map.support === "supported" && map.settings ? { ...map.settings } : null;
  },

  buildInput(req) {
    const settings = this.settingsFor(req.quality) as SkinFaceProviderSettings | null;
    if (!settings) throw new AiJobError("QUALITY_UNAVAILABLE", `${req.quality} is not a tier p-video-replace can honour`);
    return buildSkinFaceInput({ videoUrl: req.videoUrl, imageUrls: req.referenceImageUrls, settings, saveAudio: req.keepOriginalAudio }) as unknown as Record<string, unknown>;
  },

  async createPrediction(req: ReplacementRequest): Promise<ReplacementSubmission> {
    if (!this.isConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", "REPLICATE_API_TOKEN is not set");
    const settings = this.settingsFor(req.quality);
    if (!settings) throw new AiJobError("QUALITY_UNAVAILABLE", `${req.quality} is not a tier p-video-replace can honour`);
    const input = this.buildInput(req);
    const body = await createReplicatePrediction({ jobId: req.jobId, version: P_VIDEO_REPLACE.version, input, webhookUrl: req.webhookUrl, label: "skin-face" });
    const state = toState(body, body.id);
    return {
      reference: state.reference,
      status: state.status,
      model: P_VIDEO_REPLACE.model,
      modelVersion: state.modelVersion ?? P_VIDEO_REPLACE.version,
      settings,
      mergeAudio: req.keepOriginalAudio,
    };
  },
};
