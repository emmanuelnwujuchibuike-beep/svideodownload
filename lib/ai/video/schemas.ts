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
    // 3–15, or exactly 60 (the one-minute option, made as four 15 s segments)
    durationSeconds: z
      .number()
      .int()
      .refine((d) => d === 60 || (d >= KLING_OMNI.duration.minSeconds && d <= KLING_OMNI.duration.maxSeconds), { message: "Choose a length from the list." })
      .optional(),
    resolution: z.enum(KLING_VIDEO_RESOLUTIONS).optional(),
    aspectRatio: z.enum(KLING_ASPECT_RATIOS).optional(),
    audio: z.enum(KLING_AUDIO_MODES).optional(),
  })
  .strict()
  .optional();

/** An https URL our own storage minted. The pipeline re-checks it; this stops obvious junk. */
const mediaUrl = z.string().url().max(2000);

/**
 * ── REFERENCE INPUTS (2026-10-04) ──────────────────────────────────────────
 *
 * The ceiling here is `KLING_OMNI.images.max` — the ABSOLUTE one (7). The
 * conditional ceiling, 4 when a reference video rides along, is deliberately
 * NOT enforced at this layer: it is a relationship between two fields, which is
 * exactly what the header above says belongs in the pipeline's own `validate`.
 * Putting it in both places would be two rules that can disagree.
 *
 * So this rejects "9 images" (nonsense at any time) and the pipeline rejects
 * "5 images AND a video" (nonsense only together).
 */
const referenceInputs = {
  referenceImageUrls: z.array(mediaUrl).max(KLING_OMNI.images.max).optional(),
  referenceVideoUrl: mediaUrl.optional(),
  /** What the reference video is for: edit it ("base") or copy its motion ("feature"). 2026-10-06. */
  referenceVideoMode: z.enum(["base", "feature"]).optional(),
  /** Its length as the browser measured it — display only; the server prices from the token's measured facts. */
  referenceVideoSeconds: z.number().positive().max(600).optional(),
  /** The worker's signed measurement of the reference video (2026-10-19), required with a video. */
  referenceVideoToken: z.string().min(10).max(16_000).optional(),
};

/**
 * CHARACTER REPLACE (2026-10-19). The browser sends what the member CHOSE and
 * nothing it could forge: the inspection token (the worker's signed facts and
 * people), which detected person each photo replaces, and storage PATHS — the
 * server checks their owner and signs them itself (lib/ai/video/resolve-input.ts).
 * `consent` is the permission box on the screen, required.
 */
export const personReplaceInputSchema = z
  .object({
    inspection: z.string().min(10).max(16_000),
    targets: z
      .array(
        z
          .object({
            personId: z.string().regex(/^p\d{1,2}$/),
            description: z.string().max(200).optional(),
            referencePaths: z.array(z.string().min(1).max(300)).min(1).max(KLING_OMNI.images.maxWithReferenceVideo),
          })
          .strict(),
      )
      .min(1)
      .max(2),
    instructions: z.string().max(KLING_OMNI.prompt.maxChars).optional(),
    consent: z.literal(true),
    options: z
      .object({
        resolution: z.enum(KLING_VIDEO_RESOLUTIONS).optional(),
        audio: z.enum(["original", "off"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PersonReplaceWireInput = z.infer<typeof personReplaceInputSchema>;

export const textToVideoInputSchema = z
  .object({
    prompt: z.string().min(1).max(KLING_OMNI.prompt.maxChars),
    multiShot: z.boolean().optional(),
    ...referenceInputs,
    options: omniOptions,
  })
  .strict();

export const imageToVideoInputSchema = z
  .object({
    firstFrameUrl: mediaUrl,
    lastFrameUrl: mediaUrl.optional(),
    prompt: z.string().max(KLING_OMNI.prompt.maxChars).optional(),
    ...referenceInputs,
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
  z.object({ feature: z.literal("full_character"), input: personReplaceInputSchema }).strict(),
]);

/** The body of a create request: the same, plus idempotency and what was shown. */
export const createVideoJobSchema = z.discriminatedUnion("feature", [
  z.object({ feature: z.literal("text_to_video"), input: textToVideoInputSchema, clientRequestId: z.string().min(8).max(64), shownTotalCents: z.number().int().nonnegative().optional(), funding: z.enum(["wallet", "credits"]).optional() }).strict(),
  z.object({ feature: z.literal("image_to_video"), input: imageToVideoInputSchema, clientRequestId: z.string().min(8).max(64), shownTotalCents: z.number().int().nonnegative().optional(), funding: z.enum(["wallet", "credits"]).optional() }).strict(),
  z.object({ feature: z.literal("lip_sync"), input: lipSyncInputSchema, clientRequestId: z.string().min(8).max(64), shownTotalCents: z.number().int().nonnegative().optional(), funding: z.enum(["wallet", "credits"]).optional() }).strict(),
  z.object({ feature: z.literal("full_character"), input: personReplaceInputSchema, clientRequestId: z.string().min(8).max(64), shownTotalCents: z.number().int().nonnegative().optional(), funding: z.enum(["wallet", "credits"]).optional() }).strict(),
]);

export type VideoQuoteRequest = z.infer<typeof videoQuoteRequestSchema>;
export type CreateVideoJobRequest = z.infer<typeof createVideoJobSchema>;

/** A guard the routes use so the union's `feature` is a runnable one. */
export function isRunnableVideoFeature(f: string): boolean {
  return (KLING_RUNNABLE_FEATURES as readonly string[]).includes(f);
}
