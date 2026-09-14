import { z } from "zod";

/**
 * The body POST /api/ai/character-replace/quote accepts — and nothing else.
 *
 * ── 🔴 A CONFIGURATION, NEVER A PRICE (Part 3, §5) ───────────────────────────
 *
 * `.strict()`: a body carrying `price`, `totalCents`, `amount`, `balance`,
 * `quoteId` or any field this schema does not name is REFUSED, not stripped —
 * so a client that tries to hand the server a number is told no, and nobody
 * reading the response can wonder whether the number did anything. Every
 * field that is accepted is checked again against the operator's CURRENT
 * configuration by `validateQuoteInput` before anything is priced.
 *
 * Part 6 added `mode` (absent = Full Character, so every client from Parts
 * 1–5 still quotes), `voiceSource` and `ttsCharacters` — the count of the
 * dialogue, never the dialogue itself, which is not a pricing input.
 *
 * Pure zod, its own module, so the strictness is tested without the route's
 * server imports (quote-schema.test.ts).
 */
export const ANY_QUALITY = z.enum(["480p", "720p", "1080p", "standard", "high", "ultra"]);
export const REPLACEMENT_MODE = z.enum(["face_only", "skin_face", "full_character"]);
export const VOICE_SOURCE = z.enum(["upload", "tts"]);

export const quoteRequestSchema = z
  .object({
    selectedDurationMs: z.number().int().positive().max(24 * 60 * 60 * 1000),
    mode: REPLACEMENT_MODE.optional(),
    quality: ANY_QUALITY,
    voiceMode: z.enum(["original", "new_voice"]),
    voiceSource: VOICE_SOURCE.nullable().optional(),
    ttsCharacters: z.number().int().nonnegative().max(100_000).nullable().optional(),
    lipSyncMode: z.enum(["standard", "studio"]).nullable(),
  })
  .strict();

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
