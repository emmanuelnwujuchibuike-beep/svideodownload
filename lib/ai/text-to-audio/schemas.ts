import { z } from "zod";

/**
 * The bodies the Text to Audio and Audio Library routes accept. Strict:
 * an unknown field does not parse, so nothing a client invents reaches a
 * handler. The ceilings here are the SCHEMA's (a body cannot be absurd);
 * the operator's ceilings (config.maximumCharacters) are applied after.
 */
const audioName = z.string().trim().min(1).max(120);

export const textToAudioQuoteRequestSchema = z
  .object({
    /** The text itself, or just its length — the estimate needs the count only. */
    text: z.string().max(40_000).optional(),
    characters: z.number().int().nonnegative().max(40_000).optional(),
  })
  .strict()
  .refine((v) => v.text !== undefined || v.characters !== undefined, { message: "text or characters" });
export type TextToAudioQuoteRequest = z.infer<typeof textToAudioQuoteRequestSchema>;

export const createTextToAudioJobSchema = z
  .object({
    clientRequestId: z.string().min(8).max(100),
    text: z.string().min(1).max(40_000),
    name: audioName.optional(),
    voiceId: z.string().max(80).nullable().optional(),
    languageCode: z.string().max(16).nullable().optional(),
    /**
     * 2026-09-27: how it should be delivered. A NAME, never the numbers —
     * stability and style are the operator's, resolved server-side
     * (lib/ai/voice/voice-settings.ts). An unknown name does not parse.
     */
    delivery: z.enum(["natural", "expressive", "calm"]).nullable().optional(),
    /** What the member was shown; Generate recomputes and refuses a difference (PRICE_CHANGED). */
    quote: z.object({ totalCents: z.number().int().nonnegative(), pricingConfigVersion: z.number().int().positive() }).strict().optional(),
    funding: z.enum(["credits", "wallet"]).optional(),
    /** Whether to keep the result in the Audio Library (default true — "save to library with a name"). */
    save: z.boolean().optional(),
  })
  .strict();
export type CreateTextToAudioJobRequest = z.infer<typeof createTextToAudioJobSchema>;

export const renameAudioAssetSchema = z.object({ name: audioName }).strict();
