import { z } from "zod";

/**
 * The body POST /api/ai/character-replace/quote accepts — and nothing else.
 *
 * ── 🔴 A CONFIGURATION, NEVER A PRICE (Part 3, §5) ───────────────────────────
 *
 * `.strict()`: a body carrying `price`, `totalCents`, `amount`, `balance`,
 * `quoteId` or any field this schema does not name is REFUSED, not stripped —
 * so a client that tries to hand the server a number is told no, and nobody
 * reading the response can wonder whether the number did anything. The four
 * fields that are accepted are each checked again against the operator's
 * CURRENT configuration by `validateQuoteInput` before anything is priced.
 *
 * Pure zod, its own module, so the strictness is tested without the route's
 * server imports (quote-schema.test.ts).
 */
export const quoteRequestSchema = z
  .object({
    selectedDurationMs: z.number().int().positive().max(24 * 60 * 60 * 1000),
    quality: z.enum(["480p", "720p", "1080p"]),
    voiceMode: z.enum(["original", "new_voice"]),
    lipSyncMode: z.enum(["standard", "studio"]).nullable(),
  })
  .strict();

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
