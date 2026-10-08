import { z } from "zod";

import type { VoiceCloneQuote } from "@/lib/ai/voice-clone/pricing";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VOICE CLONING — the row's contract (`ai_jobs.metadata`, tool `voice_clone`)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One job = one voice. The job row carries what was asked for and what it cost;
 * the VOICE itself lives in `ai_voice_clones`, because a voice outlives the job
 * that made it — a member keeps it, uses it in two other tools and deletes it
 * on their own schedule, and none of that belongs in a job's history tile.
 *
 *   tool           "voice_clone"
 *   name           what the member called the voice
 *   description    their own note, or ""
 *   samples        [{ path, mime, size, durationMs, name }] — in OUR bucket,
 *                  under this job's folder, so `pathBelongsTo` and the
 *                  retention sweep already cover them
 *   quote          the priced facts (lib/ai/voice-clone/pricing.ts)
 *   billing        FREE_ALLOWANCE | CREDITS | PAID, the normal price, credits
 *   free_clones    { monthKey, covered, released } — the month's allowance
 *                  taken at Start; `released` once, when a failure gave it
 *                  back (the idempotency mark)
 *   consent        { at, name, statement } — WHO said they hold the rights,
 *                  WHEN, and in exactly which words. Written at Start, before
 *                  the provider is asked for anything.
 *   clone_id       the `ai_voice_clones` row, once the voice exists
 *   provider       { id, model } — never the provider's voice id, which lives
 *                  on the clone row and never leaves the server
 */
export const voiceCloneSampleSchema = z
  .object({
    path: z.string().min(1),
    mime: z.string().min(1).max(120),
    size: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative().nullable(),
    name: z.string().min(1).max(200),
    fromVideo: z.boolean().optional(),
  })
  .passthrough();

export const voiceCloneMetaSchema = z
  .object({
    tool: z.literal("voice_clone"),
    name: z.string().min(1).max(60),
    description: z.string().max(300),
    samples: z.array(voiceCloneSampleSchema).min(1),
    /** 2026-09-27: what the member said the voice IS — language, accent, gender, age. */
    labels: z
      .object({
        language: z.string().nullable(),
        accent: z.string().nullable(),
        gender: z.string().nullable(),
        age: z.string().nullable(),
      })
      .passthrough()
      .nullable()
      .optional(),
    quote: z.custom<VoiceCloneQuote>((v) => !!v && typeof v === "object" && typeof (v as { totalCents?: unknown }).totalCents === "number").nullable(),
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
    free_clones: z.object({ monthKey: z.string().min(7).max(7), covered: z.number().int().nonnegative(), released: z.boolean().optional() }).passthrough().nullable(),
    consent: z.object({ at: z.string().min(10), name: z.string().max(120), statement: z.string().min(1).max(600) }).passthrough().nullable(),
    clone_id: z.string().uuid().nullable(),
    provider: z.object({ id: z.string().min(1).max(40), model: z.string().min(1).max(120) }).passthrough().nullable(),
  })
  .passthrough();
export type VoiceCloneMeta = z.infer<typeof voiceCloneMetaSchema>;

export function readVoiceCloneMeta(metadata: unknown): VoiceCloneMeta | null {
  const parsed = voiceCloneMetaSchema.safeParse(metadata);
  return parsed.success ? parsed.data : null;
}

/**
 * The draft's contract, before Start — the samples are named but nothing is
 * priced, funded or consented to yet. Read by Start, which is the only caller
 * that sees a row in this state.
 */
export function readVoiceCloneDraft(metadata: unknown): { name: string; description: string; samples: z.infer<typeof voiceCloneSampleSchema>[] } | null {
  const m = metadata as Record<string, unknown> | null | undefined;
  if (!m || m.tool !== "voice_clone") return null;
  const samples = z.array(voiceCloneSampleSchema).safeParse(m.samples);
  if (!samples.success || samples.data.length === 0) return null;
  return { name: typeof m.name === "string" ? m.name : "Voice", description: typeof m.description === "string" ? m.description : "", samples: samples.data };
}

/** A default name, when a member gives none. Never empty, never a date alone if we can help it. */
export function defaultVoiceName(now: Date = new Date()): string {
  return `My voice ${now.toISOString().slice(0, 10)}`;
}
