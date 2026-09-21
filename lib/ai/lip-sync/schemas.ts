import { z } from "zod";

/**
 * The bodies of the Lip Sync Pro routes — strict, pure zod (§3, §16).
 *
 * ── 🔴 EXACTLY ONE SPEECH SOURCE ────────────────────────────────────────────
 * The create body is a discriminated union on `speech.source`: a body that
 * names text AND an audio file does not parse (the union's `.strict()`
 * objects refuse the foreign key), and a body that names neither does not
 * parse either. The server never has to "pick one" — there is nothing to
 * pick from. Every fact here is re-measured on the worker; here it only
 * bounds the upload tickets and refuses the obviously wrong.
 */
const name = z.string().trim().min(1).max(200);
const mime = z.string().trim().min(1).max(120);

export const lipSyncVideoFacts = z
  .object({
    name,
    mimeType: mime,
    size: z.number().int().positive().max(2 * 1024 * 1024 * 1024),
    durationMs: z.number().int().positive().max(6 * 60 * 60 * 1000),
    width: z.number().int().positive().max(20_000),
    height: z.number().int().positive().max(20_000),
    hasAudio: z.boolean().nullable().optional(),
  })
  .strict();

export const lipSyncSpeechText = z
  .object({
    source: z.literal("text"),
    text: z.string().min(1).max(5_000),
    voiceId: z.string().max(80).nullable().optional(),
    languageCode: z.string().max(16).nullable().optional(),
    speed: z.number().min(0.5).max(3).optional(),
  })
  .strict();

export const lipSyncSpeechAudio = z
  .object({
    source: z.literal("audio"),
    audio: z
      .object({
        name,
        mimeType: mime,
        size: z.number().int().positive().max(200 * 1024 * 1024),
        durationMs: z.number().int().positive().max(6 * 60 * 60 * 1000).nullable(),
      })
      .strict(),
  })
  .strict();

export const lipSyncSpeechInput = z.discriminatedUnion("source", [lipSyncSpeechText, lipSyncSpeechAudio]);

export const createLipSyncJobSchema = z
  .object({
    clientRequestId: z.string().min(8).max(100),
    retryOf: z.string().uuid().optional(),
    video: lipSyncVideoFacts,
    speech: lipSyncSpeechInput,
    settings: z
      .object({
        expression: z.enum(["natural", "balanced", "expressive"]).nullable().optional(),
        activeSpeaker: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CreateLipSyncJobRequest = z.infer<typeof createLipSyncJobSchema>;

export const lipSyncQuoteRequestSchema = z
  .object({
    selectedDurationMs: z.number().int().positive().max(6 * 60 * 60 * 1000),
    speechSource: z.enum(["text", "audio"]),
    textCharacters: z.number().int().nonnegative().max(5_000).optional(),
    speed: z.number().min(0.5).max(3).optional(),
  })
  .strict();

export const startLipSyncJobSchema = z
  .object({
    quote: z
      .object({
        id: z.string().min(16).max(200),
        durationMs: z.number().int().positive(),
        speechSource: z.enum(["text", "audio"]),
        speechPath: z.enum(["native", "tts", "audio"]),
        textCharacters: z.number().int().nonnegative(),
        routeKey: z.string().min(8).max(32),
        totalCents: z.number().int().nonnegative(),
        currency: z.string().min(3).max(3),
        pricingConfigVersion: z.number().int().positive(),
        expiresAt: z.string().min(10).max(40),
      })
      .strict(),
    trim: z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).strict().nullable(),
    consent: z.literal(true),
    /** 0167: "wallet" when the member chose the balance although credits exist and the policy offers it. */
    funding: z.enum(["credits", "wallet"]).optional(),
  })
  .strict();
export type StartLipSyncJobRequest = z.infer<typeof startLipSyncJobSchema>;
