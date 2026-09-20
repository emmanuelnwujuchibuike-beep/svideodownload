import { z } from "zod";

import { ANY_QUALITY, REPLACEMENT_MODE, VOICE_SOURCE } from "@/lib/ai/character-replace/quote-schema";

/**
 * The bodies of POST /api/ai/character-replace/jobs (create) and
 * POST /api/ai/character-replace/jobs/[id]/start — strict, and pure zod so
 * the shapes are tested without the routes' server imports.
 *
 * ── 🔴 WHAT A CLIENT MAY SAY, AND WHAT IT MAY NOT ───────────────────────────
 *
 * Create carries the files' FACTS as the browser read them (sizes, types,
 * dimensions, duration) and, since Part 6, WHICH replacement it is, any
 * extra identity photos, and an optional replacement audio file. Every one
 * of them is re-measured on the worker before the provider sees a byte
 * (§4); here they only bound the upload tickets and refuse the obviously
 * wrong.
 *
 * Start carries the SIGNED quote (only the fields its signature covers), the
 * trim, the consent, and — Part 6 — the voice details the quote does not
 * price by value: the dialogue text, the language and the voice, the
 * "trim my audio to fit" choice, and the voice-rights confirmation. There is
 * no price field a client could set that the signature does not cover:
 * `totalCents` is signed, and the server recomputes it from the CURRENT
 * configuration and refuses on any difference.
 */
const name = z.string().trim().min(1).max(200);
const mime = z.string().trim().min(1).max(120);

const photoFacts = z
  .object({
    name,
    mimeType: mime,
    size: z.number().int().positive().max(200 * 1024 * 1024),
    width: z.number().int().positive().max(20_000),
    height: z.number().int().positive().max(20_000),
  })
  .strict();

export const createCharacterReplaceJobSchema = z
  .object({
    clientRequestId: z.string().min(8).max(100),
    /**
     * Part 5 (§7): "Try again" opens a NEW attempt — a new job row, a new
     * prediction, a new ledger row — linked to the one it retries. The server
     * verifies the link is the member's own finished job; it grants nothing.
     */
    retryOf: z.string().uuid().optional(),
    /** Part 6: absent = Full Character, so every client from Parts 1–5 still creates. */
    mode: REPLACEMENT_MODE.optional(),
    photo: photoFacts,
    /** Extra identity photos (Skin + Face). The primary is `photo`; these are the 2nd and 3rd. */
    references: z.array(photoFacts).max(2).optional(),
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
    /** A replacement audio file the member will upload (Part 6 §3). Facts only; measured again on the worker. */
    audio: z
      .object({
        name,
        mimeType: mime,
        size: z.number().int().positive().max(200 * 1024 * 1024),
        /** Null when the browser could not decode it; the worker measures either way. */
        durationMs: z.number().int().positive().max(6 * 60 * 60 * 1000).nullable(),
      })
      .strict()
      .optional(),
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
        mode: REPLACEMENT_MODE.optional(),
        quality: ANY_QUALITY,
        voiceMode: z.enum(["original", "new_voice"]),
        voiceSource: VOICE_SOURCE.nullable().optional(),
        ttsCharacters: z.number().int().nonnegative().max(100_000).optional(),
        voiceChange: z.boolean().optional(),
        lipSyncMode: z.enum(["standard", "studio"]).nullable(),
        totalCents: z.number().int().nonnegative(),
        expiresAt: z.string().min(10).max(40),
      })
      .strict(),
    trim: z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).strict().nullable(),
    consent: z.literal(true),
    /**
     * 2026-09-20: the preflight pass for exactly these files and this mode
     * (lib/ai/preflight/token.ts). Start verifies it AND the record the
     * worker stored on the job before anything is reserved; without a pass
     * nothing is charged and nothing reaches a provider.
     */
    preflightToken: z.string().min(16).max(2000).optional(),
    /**
     * Part 6: the voice, in full. Only read when the quote says `new_voice`;
     * refused when it contradicts the quote (a TTS quote with no text, an
     * upload quote with text). The dialogue's LENGTH must equal the signed
     * `ttsCharacters`, or the price was for a different dialogue.
     */
    voice: z
      .object({
        source: VOICE_SOURCE,
        text: z.string().max(10_000).optional(),
        languageCode: z.string().trim().min(2).max(40).optional(),
        voiceId: z.string().trim().min(1).max(40).optional(),
        /** 2026-09-20: with a voice change on an upload, the catalogue voice it is re-voiced in. */
        changeVoiceId: z.string().trim().min(1).max(40).optional(),
        /** §4: the member's explicit choice to cut audio that is longer than the video. */
        trimToFit: z.boolean().optional(),
        /** §6: "I confirm that I own this voice or have permission to use it." Required for an upload. */
        voiceConsent: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type StartCharacterReplaceJobRequest = z.infer<typeof startCharacterReplaceJobSchema>;
