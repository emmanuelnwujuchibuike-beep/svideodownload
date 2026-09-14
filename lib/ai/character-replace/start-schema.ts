import { z } from "zod";

/**
 * The bodies of POST /api/ai/character-replace/jobs (create) and
 * POST /api/ai/character-replace/jobs/[id]/start — strict, and pure zod so
 * the shapes are tested without the routes' server imports.
 *
 * ── 🔴 WHAT A CLIENT MAY SAY, AND WHAT IT MAY NOT ───────────────────────────
 *
 * Create carries the two files' FACTS as the browser read them (sizes,
 * types, dimensions, duration). Every one of them is re-measured on the
 * worker before the provider sees a byte (§4); here they only bound the
 * upload tickets and refuse the obviously wrong.
 *
 * Start carries the SIGNED quote (only the fields its signature covers), the
 * trim and the consent. There is no price field a client could set that the
 * signature does not cover: `totalCents` is signed, and the server recomputes
 * it from the CURRENT configuration and refuses on any difference.
 */
const name = z.string().trim().min(1).max(200);
const mime = z.string().trim().min(1).max(120);

export const createCharacterReplaceJobSchema = z
  .object({
    clientRequestId: z.string().min(8).max(100),
    photo: z
      .object({
        name,
        mimeType: mime,
        size: z.number().int().positive().max(200 * 1024 * 1024),
        width: z.number().int().positive().max(20_000),
        height: z.number().int().positive().max(20_000),
      })
      .strict(),
    video: z
      .object({
        name,
        mimeType: mime,
        size: z.number().int().positive().max(2 * 1024 * 1024 * 1024),
        durationMs: z.number().int().positive().max(6 * 60 * 60 * 1000),
        width: z.number().int().positive().max(20_000),
        height: z.number().int().positive().max(20_000),
        hasAudio: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type CreateCharacterReplaceJobRequest = z.infer<typeof createCharacterReplaceJobSchema>;

export const startCharacterReplaceJobSchema = z
  .object({
    quote: z
      .object({
        id: z.string().min(16).max(200),
        product: z.literal("character_replace"),
        currency: z.string().min(3).max(3),
        pricingConfigVersion: z.number().int().positive(),
        durationMs: z.number().int().positive(),
        quality: z.enum(["480p", "720p", "1080p"]),
        voiceMode: z.enum(["original", "new_voice"]),
        lipSyncMode: z.enum(["standard", "studio"]).nullable(),
        totalCents: z.number().int().nonnegative(),
        expiresAt: z.string().min(10).max(40),
      })
      .strict(),
    trim: z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).strict().nullable(),
    consent: z.literal(true),
  })
  .strict();

export type StartCharacterReplaceJobRequest = z.infer<typeof startCharacterReplaceJobSchema>;
