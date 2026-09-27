import { z } from "zod";

import type { TextToAudioQuote } from "@/lib/ai/text-to-audio/pricing";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TEXT TO AUDIO — the row's contract (`ai_jobs.metadata`, tool `text_to_audio`)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One job = one generation. The text stays on the row (the operator's record,
 * the retry's input) and never leaves through a view — `jobToView` reports its
 * LENGTH. The billing facts are written at Generate, before any provider is
 * asked; the output facts by the finalizer, after the MP3 is in our bucket.
 *
 *   tool              "text_to_audio"
 *   text              what was spoken (trimmed)
 *   characters        its length — the priced count
 *   name              the member's name for the saved audio (or the default)
 *   voiceId           catalogue id (null = the provider's default voice)
 *   providerVoiceId   the provider's own id/name for it (server-resolved)
 *   languageCode      BCP-47 primary subtag
 *   delivery          natural | expressive | calm — the member's choice
 *   voice_settings    what that resolved to, as the provider was told it
 *   route             replicate | elevenlabs — decided ONCE at Generate
 *   model             the model id under that route
 *   quote             the priced facts (lib/ai/text-to-audio/pricing.ts)
 *   billing           FREE_ALLOWANCE | CREDITS | PAID, the normal price, credits
 *   free_characters   { monthKey, covered, released } — the month's allowance
 *                     taken at Generate; `released` once, when a failure gave
 *                     it back (the idempotency mark)
 *   output            { durationMs, bytes, mime } — measured on the stored file
 *   asset_id          the Audio Library row made from the result
 */
export const textToAudioMetaSchema = z
  .object({
    tool: z.literal("text_to_audio"),
    text: z.string().min(1),
    characters: z.number().int().nonnegative(),
    name: z.string().min(1).max(120),
    voiceId: z.string().max(80).nullable(),
    providerVoiceId: z.string().max(200).nullable(),
    /** 2026-09-27: the member's own voice, when that is what spoke (lib/ai/voice-clone/usable.ts). */
    clone_id: z.string().uuid().nullable().optional(),
    languageCode: z.string().max(16).nullable(),
    route: z.enum(["replicate", "elevenlabs"]),
    model: z.string().min(1).max(120),
    /*
      2026-09-27: the delivery the member chose, and the operator numbers it
      resolved to. ⚠️ These are the values BEFORE the per-model clamp — v3 takes
      stability 0/0.5/1 and ignores `style`, so a row saying `stability 0.3,
      style 0.55` was sent `stability 0.5` and no style at all
      (lib/ai/voice/voice-settings.ts `clampVoiceSettings`). Stored unclamped
      on purpose: it records what was ASKED for, which survives a model change.
    */
    delivery: z.enum(["natural", "expressive", "calm"]).nullable().optional(),
    voice_settings: z.object({ stability: z.number(), similarityBoost: z.number(), style: z.number(), speakerBoost: z.boolean(), speed: z.number() }).passthrough().nullable().optional(),
    quote: z.custom<TextToAudioQuote>((v) => !!v && typeof v === "object" && typeof (v as { totalCents?: unknown }).totalCents === "number").nullable(),
    billing: z
      .object({
        type: z.enum(["FREE_ALLOWANCE", "CREDITS", "PAID"]),
        normalPriceCents: z.number().int().nonnegative(),
        chargedCents: z.number().int().nonnegative(),
        currency: z.string().min(3).max(3),
        credits: z.number().int().nonnegative().optional(),
        plan: z.string().optional(),
        creditsConfigVersion: z.number().int().optional(),
      })
      .passthrough()
      .nullable(),
    free_characters: z.object({ monthKey: z.string().min(7).max(7), covered: z.number().int().nonnegative(), released: z.boolean().optional() }).passthrough().nullable(),
    output: z.object({ durationMs: z.number().int().nonnegative().nullable(), bytes: z.number().int().nonnegative(), mime: z.string().min(1) }).passthrough().nullable(),
    asset_id: z.string().uuid().nullable(),
  })
  .passthrough();
export type TextToAudioMeta = z.infer<typeof textToAudioMetaSchema>;

export function readTextToAudioMeta(metadata: unknown): TextToAudioMeta | null {
  const parsed = textToAudioMetaSchema.safeParse(metadata);
  return parsed.success ? parsed.data : null;
}

/** A default library name from the text — the first words, tidy, never empty. */
export function defaultAudioName(text: string, now: Date = new Date()): string {
  const words = text
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .slice(0, 6)
    .join(" ")
    .replace(/[^\p{L}\p{M}\p{N} '’,.!?-]/gu, "")
    .trim()
    .slice(0, 48)
    .replace(/[ ,.!?'’-]+$/, "");
  if (words) return words;
  return `Audio ${now.toISOString().slice(0, 10)}`;
}
