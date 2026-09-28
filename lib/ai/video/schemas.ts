import { z } from "zod";

import { KLING_ASPECT_RATIOS, KLING_AUDIO_MODES, KLING_OMNI, KLING_VIDEO_RESOLUTIONS } from "@/lib/ai/kling/features/capabilities";
import { KLING_RUNNABLE_FEATURES } from "@/lib/ai/kling/pipelines/registry";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT A BROWSER MAY SEND — one schema per feature, shaped like its pipeline
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These parse the WIRE. They are deliberately thin: their job is to reject
 * nonsense (a number where a string belongs, a value outside the vendor's
 * enum) so the pipeline's own `validate` is never handed garbage.
 *
 * 🔴 They are NOT the feature's validation, and must not grow into it. "Is this
 * prompt empty", "is this duration inside the model's window", "does a video
 * reference exclude native audio" all live in the pipeline, because that is
 * where the answer can change per feature and where Part 5 §27 puts it. A rule
 * duplicated here would be a rule that can disagree with itself.
 *
 * Every enum below is read from the VERIFIED capability table rather than
 * retyped, so a browser can never offer an option the live API refuses — and
 * `480p` in particular is absent, because the vendor lists it and then rejects
 * it at generation.
 */

/** The settings every Omni generation shares. */
const omniOptions = z
  .object({
    durationSeconds: z.number().int().min(KLING_OMNI.duration.minSeconds).max(KLING_OMNI.duration.maxSeconds).optional(),
    resolution: z.enum(KLING_VIDEO_RESOLUTIONS).optional(),
    aspectRatio: z.enum(KLING_ASPECT_RATIOS).optional(),
    audio: z.enum(KLING_AUDIO_MODES).optional(),
  })
  .strict()
  .optional();

/** An https URL our own storage minted. The pipeline re-checks it; this stops obvious junk. */
const mediaUrl = z.string().url().max(2000);

export const textToVideoInputSchema = z
  .object({
    prompt: z.string().min(1).max(KLING_OMNI.prompt.maxChars),
    multiShot: z.boolean().optional(),
    options: omniOptions,
  })
  .strict();

export const imageToVideoInputSchema = z
  .object({
    firstFrameUrl: mediaUrl,
    lastFrameUrl: mediaUrl.optional(),
    prompt: z.string().max(KLING_OMNI.prompt.maxChars).optional(),
    options: omniOptions,
  })
  .strict();

/**
 * Lip Sync's two modes are a discriminated union, exactly as the pipeline's
 * input type is — so a `text2video` body cannot smuggle an `audioUrl`, and the
 * parse fails at the edge instead of the pipeline having to unpick it.
 */
export const lipSyncInputSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("audio2video"),
      videoUrl: mediaUrl.optional(),
      videoId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
      audioUrl: mediaUrl,
      sourceSeconds: z.number().positive().max(600).optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("text2video"),
      videoUrl: mediaUrl.optional(),
      videoId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
      text: z.string().min(1).max(2000),
      voiceId: z.string().min(1).max(128),
      /** 🔴 The vendor allows exactly these two. */
      voiceLanguage: z.enum(["zh", "en"]),
      voiceSpeed: z.number().min(0.8).max(2).optional(),
      sourceSeconds: z.number().positive().max(600).optional(),
    })
    .strict(),
]);

/** The body of a quote request: which feature, and the input to price. */
export const videoQuoteRequestSchema = z.discriminatedUnion("feature", [
  z.object({ feature: z.literal("text_to_video"), input: textToVideoInputSchema }).strict(),
  z.object({ feature: z.literal("image_to_video"), input: imageToVideoInputSchema }).strict(),
  z.object({ feature: z.literal("lip_sync"), input: lipSyncInputSchema }).strict(),
]);

/** The body of a create request: the same, plus idempotency and what was shown. */
export const createVideoJobSchema = z.discriminatedUnion("feature", [
  z.object({ feature: z.literal("text_to_video"), input: textToVideoInputSchema, clientRequestId: z.string().min(8).max(64), shownTotalCents: z.number().int().nonnegative().optional(), funding: z.enum(["wallet", "credits"]).optional() }).strict(),
  z.object({ feature: z.literal("image_to_video"), input: imageToVideoInputSchema, clientRequestId: z.string().min(8).max(64), shownTotalCents: z.number().int().nonnegative().optional(), funding: z.enum(["wallet", "credits"]).optional() }).strict(),
  z.object({ feature: z.literal("lip_sync"), input: lipSyncInputSchema, clientRequestId: z.string().min(8).max(64), shownTotalCents: z.number().int().nonnegative().optional(), funding: z.enum(["wallet", "credits"]).optional() }).strict(),
]);

export type VideoQuoteRequest = z.infer<typeof videoQuoteRequestSchema>;
export type CreateVideoJobRequest = z.infer<typeof createVideoJobSchema>;

/** A guard the routes use so the union's `feature` is a runnable one. */
export function isRunnableVideoFeature(f: string): boolean {
  return (KLING_RUNNABLE_FEATURES as readonly string[]).includes(f);
}
