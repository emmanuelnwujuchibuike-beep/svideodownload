import "server-only";

import { linearCostEstimate, type ReplacementProvider, type ReplacementRequest, type ReplacementSubmission } from "@/lib/ai/character-replace/providers/types";
import { FACE_ONLY_TIER_MAP, isReplacementTierId } from "@/lib/ai/character-replace/modes";
import { AiJobError } from "@/lib/ai/errors";
import { createReplicatePrediction, toState } from "@/lib/ai/replicate/provider";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FACE ONLY → xrunda/hello (the "Face Swap Service")
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Face Only brief §1/§8: "Face Only → Face Swap Service → Replicate →
 * xrunda/hello… Replace only the person's face/identity. Preserve the
 * original body, clothing, jersey… Do NOT use Wan 2.2 for Face Only."
 *
 * Read from the live schema on 2026-09-14 (version 104b4a39…, 2023-09-30):
 *
 *   source   string (uri)   "video Source"   — the video whose face is replaced
 *   target   string (uri)   "face image"     — the face to put in
 *   output   array of uri   (an iterator; the finished file is the last)
 *
 * That is the whole schema. No resolution, no fps, no strength, no seed.
 * The quality tier is therefore recorded as `single` (modes.ts) and changes
 * nothing here — and the tiers that would change nothing are refused before
 * this adapter is reached. `buildInput` sends exactly the two fields.
 *
 * The pin is in code, overridable by env for a rollback without a deploy,
 * the same rule as the AI Clean and Wan pins.
 */
export const XRUNDA_HELLO = {
  model: "xrunda/hello",
  version: process.env.REPLICATE_FACE_ONLY_VERSION?.trim() || "104b4a39315349db50880757bc8c1c996c5309e3aa11286b0a3c84dab81fd440",
} as const;

export interface FaceOnlyInput {
  source: string;
  target: string;
}

export const FACE_ONLY_INPUT_FIELDS = ["source", "target"] as const;

export function buildFaceOnlyInput(opts: { videoUrl: string; faceImageUrl: string }): FaceOnlyInput {
  if (!/^https:\/\//.test(opts.videoUrl) || !/^https:\/\//.test(opts.faceImageUrl)) throw new Error("provider inputs must be https urls");
  return { source: opts.videoUrl, target: opts.faceImageUrl };
}

export const faceOnlyProvider: ReplacementProvider = {
  id: "replicate",
  mode: "face_only",
  model: XRUNDA_HELLO.model,
  version: XRUNDA_HELLO.version,
  // A face swap: one face in, the face out; the body, hair and skin of the video stay. Only Face Only.
  capabilities: {
    modes: ["face_only"],
    supportsTier: (_mode, quality) => isReplacementTierId(quality) && FACE_ONLY_TIER_MAP[quality].support === "supported",
    keepsAudio: true,
    maxReferenceImages: 1,
    referenceFraming: "portrait",
  },
  supportsMode(mode) {
    return this.capabilities.modes.includes(mode);
  },
  estimateProcessingCostUsdCents: linearCostEstimate,

  isConfigured() {
    return !!process.env.REPLICATE_API_TOKEN?.trim() && !!XRUNDA_HELLO.version;
  },

  buildInput(req) {
    return buildFaceOnlyInput({ videoUrl: req.videoUrl, faceImageUrl: req.referenceImageUrls[0] ?? "" }) as unknown as Record<string, unknown>;
  },

  settingsFor(quality) {
    if (!isReplacementTierId(quality)) return null;
    const map = FACE_ONLY_TIER_MAP[quality];
    return map.support === "supported" && map.settings ? { ...map.settings } : null;
  },

  async createPrediction(req: ReplacementRequest): Promise<ReplacementSubmission> {
    if (!this.isConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", "REPLICATE_API_TOKEN is not set");
    if (!req.referenceImageUrls.length) throw new AiJobError("INVALID_INPUT", "face only needs one reference image");
    const settings = this.settingsFor(req.quality);
    if (!settings) throw new AiJobError("QUALITY_UNAVAILABLE", `${req.quality} is not a tier xrunda/hello can honour`);
    const input = this.buildInput(req);
    const body = await createReplicatePrediction({ jobId: req.jobId, version: XRUNDA_HELLO.version, input, webhookUrl: req.webhookUrl, label: "face-only" });
    const state = toState(body, body.id);
    return {
      reference: state.reference,
      status: state.status,
      model: XRUNDA_HELLO.model,
      modelVersion: state.modelVersion ?? XRUNDA_HELLO.version,
      settings,
      // The model writes its own output; whether the source audio survives is not documented, so the finalizer checks and restores it if not.
      mergeAudio: req.keepOriginalAudio,
    };
  },
};
