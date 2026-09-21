import { z } from "zod";

import { characterReplacePipelineSchema } from "@/lib/ai/character-replace/job-meta";
import type { PipelineMeta } from "@/lib/ai/character-replace/pipeline";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE LIP SYNC PRO JOB CONTRACT — what the row's metadata holds (§15)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Written by the create route, completed at /start, replaced by the worker's
 * measured facts. Exactly ONE speech source lives on a row (§3): the schema
 * is a discriminated union, so a row can never carry both a text and an
 * audio upload. The text itself stays on the row (the operator may need it
 * for a dispute) and never leaves through a view.
 */
export const lipSyncSpeechSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("text"),
    text: z.string().min(1).max(5_000),
    /** Catalogue ids — the voice provider's or the native model's — resolved server-side at /start. */
    voiceId: z.string().max(80).nullable(),
    providerVoiceId: z.string().max(120).nullable(),
    languageCode: z.string().max(16).nullable(),
    speed: z.number().min(0.5).max(3),
    /** "native" = the lip-sync model speaks the text; "tts" = the voice provider makes the audio in the worker. Decided at /start. */
    path: z.enum(["native", "tts"]).nullable(),
  }),
  z.object({
    source: z.literal("audio"),
    upload: z.object({ path: z.string().min(1), mime: z.string().min(1), size: z.number().int().positive(), durationMs: z.number().int().positive().nullable(), name: z.string().max(200) }),
  }),
]);

const preparedAudio = z
  .object({
    path: z.string().min(1),
    durationMs: z.number().int().positive(),
    bytes: z.number().int().positive(),
    mime: z.string().min(1),
    sampleRate: z.number().int().positive().nullable().optional(),
    channels: z.number().int().positive().nullable().optional(),
    trimmed: z.boolean(),
    padded: z.boolean(),
    transcoded: z.boolean(),
    /** How the audio came to be: the upload, or the voice provider's synthesis (never for a native-text job). */
    origin: z.enum(["upload", "tts"]),
    /** The worker's tempo change for a speaking speed ≠ 1 on the tts path. */
    speedApplied: z.number().nullable().optional(),
  })
  .nullable();

export const lipSyncJobMetaSchema = z
  .object({
    tool: z.literal("lip_sync"),
    attempt: z.number().int().positive(),
    project_id: z.string().optional(),
    retry_of: z.string().nullable().optional(),
    source_name: z.string().max(200).optional(),
    video: z.object({
      path: z.string().min(1),
      mime: z.string().min(1),
      size: z.number().int().positive(),
      durationMs: z.number().int().positive(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      hasAudio: z.boolean().nullable().optional(),
    }),
    speech: lipSyncSpeechSchema,
    settings: z.object({
      expression: z.enum(["natural", "balanced", "expressive"]).nullable(),
      activeSpeaker: z.boolean(),
      durationPolicy: z.enum(["trim_video_to_audio", "trim_audio_to_video", "loop_audio", "reject", "provider_sync_mode"]),
    }),
    trim: z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).nullable(),
    quote: z.record(z.unknown()).nullable(),
    prepared: z
      .object({
        path: z.string().min(1),
        durationMs: z.number().int().positive(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        hasAudio: z.boolean(),
        bytes: z.number().int().positive(),
        trimmed: z.boolean(),
        fps: z.number().positive().nullable().optional(),
        profile: z.enum(["default", "kling", "kling_lipsync"]).optional(),
      })
      .nullable(),
    audio: z.object({ prepared: preparedAudio, synthesized: z.object({ provider: z.string(), model: z.string(), bytes: z.number(), durationMs: z.number() }).nullable().optional() }).nullable(),
    pipeline: characterReplacePipelineSchema.nullable(),
    /** §7: what the worker decided about a length mismatch, in one line for the member's result and the operator's log. */
    duration_note: z.string().max(300).nullable().optional(),
  })
  .passthrough();

export type LipSyncJobMeta = z.infer<typeof lipSyncJobMetaSchema>;
export type LipSyncSpeechMeta = z.infer<typeof lipSyncSpeechSchema>;

export function readLipSyncMeta(metadata: unknown): LipSyncJobMeta | null {
  const parsed = lipSyncJobMetaSchema.safeParse(metadata);
  return parsed.success ? parsed.data : null;
}

export function readLipSyncPipeline(metadata: unknown): PipelineMeta | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).pipeline;
  const parsed = characterReplacePipelineSchema.safeParse(raw);
  return parsed.success ? (parsed.data as unknown as PipelineMeta) : null;
}
