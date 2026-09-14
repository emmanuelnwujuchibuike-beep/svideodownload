import { z } from "zod";

import type { CharacterReplaceQuote } from "@/lib/ai/character-replace/pricing";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A CHARACTER REPLACE JOB'S METADATA — the one shape every stage reads
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `ai_jobs` is one row per unit of AI work for every tool (the tool is the
 * `feature` column), and the columns it has are the ones every tool shares:
 * one source, one result, one prediction id. Character Replace has TWO inputs
 * (a video and a character image), a trim, settings, a pricing snapshot and
 * a prepared (trimmed) file — all of which live in the row's `metadata`
 * jsonb, under this contract, rather than in tool-specific columns nobody
 * else would fill.
 *
 * Read with `readCharacterReplaceMeta` (zod, lenient on unknown keys so a
 * diagnostic note never breaks a parse) and written with merges only —
 * `noteJobDiagnostic` and `recordProviderOutput` already merge, and a
 * stage that spread a stale row over a fresh one once erased a note
 * (see submit.ts). Every writer here reads first.
 */

export const characterReplaceJobMetaSchema = z
  .object({
    tool: z.literal("character_replace"),
    /** The processing attempt this row is — a retry is a NEW row, attempt + 1. */
    attempt: z.number().int().positive(),
    source_name: z.string().max(200).optional(),
    character: z.object({
      path: z.string().min(1),
      mime: z.string().min(1),
      size: z.number().int().positive(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      name: z.string().max(200).optional(),
    }),
    /** The video as the BROWSER reported it at creation; the worker's `prepared` block replaces these facts. */
    video: z.object({
      path: z.string().min(1),
      mime: z.string().min(1),
      size: z.number().int().positive(),
      durationMs: z.number().int().positive(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      hasAudio: z.boolean(),
    }),
    trim: z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).nullable(),
    settings: z.object({
      quality: z.enum(["480p", "720p", "1080p"]),
      voiceMode: z.enum(["original", "new_voice"]),
      lipSyncMode: z.enum(["standard", "studio"]).nullable(),
    }),
    /** The immutable pricing snapshot the charge was reserved under. Null until /start. */
    quote: z.custom<CharacterReplaceQuote>((v) => !!v && typeof v === "object" && typeof (v as { totalCents?: unknown }).totalCents === "number").nullable(),
    /** What the worker produced and measured — the file the provider actually receives. */
    prepared: z
      .object({
        path: z.string().min(1),
        durationMs: z.number().int().positive(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        hasAudio: z.boolean(),
        bytes: z.number().int().positive(),
        trimmed: z.boolean(),
      })
      .nullable(),
    /** What was sent to the provider, for the operator. Never the URLs. */
    provider: z
      .object({
        model: z.string(),
        version: z.string(),
        resolution: z.enum(["480", "720"]),
        goFast: z.boolean(),
        mergeAudio: z.boolean(),
      })
      .nullable(),
    provider_output_url: z.string().optional(),
    failure_category: z.enum(["user", "provider", "system"]).optional(),
  })
  .passthrough();

export type CharacterReplaceJobMeta = z.infer<typeof characterReplaceJobMetaSchema>;

/** Null for a row that is not a Character Replace job, or whose metadata is not (yet) whole. */
export function readCharacterReplaceMeta(metadata: unknown): CharacterReplaceJobMeta | null {
  const parsed = characterReplaceJobMetaSchema.safeParse(metadata);
  return parsed.success ? parsed.data : null;
}

/** The kept range in milliseconds — the trim, or the whole video. */
export function selectedRangeOf(meta: Pick<CharacterReplaceJobMeta, "video" | "trim">): { startMs: number; endMs: number; durationMs: number } {
  const startMs = meta.trim ? Math.max(0, Math.min(meta.video.durationMs, meta.trim.startMs)) : 0;
  const endMs = meta.trim ? Math.max(startMs, Math.min(meta.video.durationMs, meta.trim.endMs)) : meta.video.durationMs;
  return { startMs, endMs, durationMs: endMs - startMs };
}

/**
 * How far the file the worker produced may differ from the duration that was
 * priced (§5: "The billed duration and actual processing duration must
 * match"). A container rounds to a frame; half a second or 3% — whichever
 * is larger — is a frame boundary, not a different video.
 */
export function durationWithinTolerance(billedMs: number, actualMs: number): boolean {
  const tolerance = Math.max(500, Math.round(billedMs * 0.03));
  return Math.abs(actualMs - billedMs) <= tolerance;
}
