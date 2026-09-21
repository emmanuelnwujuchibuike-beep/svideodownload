import { z } from "zod";

import type { PipelineMeta } from "@/lib/ai/character-replace/pipeline";
import type { CharacterReplaceQuote } from "@/lib/ai/character-replace/pricing";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A CHARACTER REPLACE JOB'S METADATA — the one shape every stage reads
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `ai_jobs` is one row per unit of AI work for every tool (the tool is the
 * `feature` column), and the columns it has are the ones every tool shares:
 * one source, one result, one prediction id. Character Replace has TWO (or
 * more) inputs — a video and one to three reference images — a trim,
 * settings, a pricing snapshot, a prepared (trimmed) file, and since Part 6
 * a replacement audio, a text-to-speech request and a multi-stage pipeline.
 * All of it lives in the row's `metadata` jsonb, under this contract, rather
 * than in tool-specific columns nobody else would fill.
 *
 * Read with `readCharacterReplaceMeta` (zod, lenient on unknown keys so a
 * diagnostic note never breaks a parse) and written with merges only —
 * `noteJobDiagnostic` and `recordProviderOutput` already merge, and a
 * stage that spread a stale row over a fresh one once erased a note
 * (see submit.ts). Every writer here reads first.
 *
 * ── Part 6, and every row before it ────────────────────────────────────────
 *
 * `mode` defaults to `full_character` and `references` to `[]`, `audio`,
 * `tts` and `pipeline` to null — so every row written by Parts 1–5 still
 * parses, and a Full Character job with the original audio is exactly the
 * job it was.
 */

const image = z.object({
  path: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  name: z.string().max(200).optional(),
  /** The clean baseline JPEG the worker wrote beside the upload (2026-09-20); the provider reads THIS when present. */
  preparedPath: z.string().min(1).nullable().optional(),
});

const stageRecord = z
  .object({
    status: z.enum(["pending", "submitted", "processing", "succeeded", "failed"]),
    provider: z.object({ id: z.enum(["replicate", "fal"]), model: z.string(), version: z.string().nullable() }).nullable().optional(),
    predictionId: z.string().nullable().optional(),
    submittedAt: z.string().nullable().optional(),
    finishedAt: z.string().nullable().optional(),
    outputUrl: z.string().nullable().optional(),
    storedPath: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
  })
  .passthrough();

export const characterReplacePipelineSchema = z
  .object({
    stages: z.array(z.enum(["voice", "replace", "lipsync", "finalize"])).min(1),
    current: z.enum(["voice", "replace", "lipsync", "finalize"]),
    records: z.object({ voice: stageRecord.optional(), replace: stageRecord.optional(), lipsync: stageRecord.optional(), finalize: stageRecord.optional() }).passthrough(),
    stage_started_at: z.string().nullable().optional(),
    pending_advance: z.enum(["voice", "replace", "lipsync", "finalize"]).nullable().optional(),
  })
  .passthrough();

export const characterReplaceJobMetaSchema = z
  .object({
    tool: z.literal("character_replace"),
    /** The processing attempt this row is — a retry is a NEW row, attempt + 1. */
    attempt: z.number().int().positive(),
    source_name: z.string().max(200).optional(),
    /** Part 6: which replacement. Absent on every row before it = Full Character. */
    mode: z.enum(["face_only", "skin_face", "upper_body", "full_character"]).default("full_character"),
    /** The primary reference — the face, the first identity photo, or the photo. */
    character: image,
    /** Extra identity photos (Skin + Face), in the order the member added them. */
    references: z.array(image).max(2).default([]),
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
      quality: z.enum(["480p", "720p", "1080p", "standard", "high", "ultra"]),
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
        /** 2026-09-21: the prepared file's frame rate, for adapters with a documented fps window (Kling: 24–60). Absent on older rows. */
        fps: z.number().positive().nullable().optional(),
        /** 2026-09-21: which prepare profile made the file — "kling" = both edges ≥ 720, fps clamped. */
        profile: z.enum(["default", "kling", "kling_lipsync"]).optional(),
      })
      .nullable(),
    /**
     * Part 6 §3–§5: the replacement voice. `upload` is the member's own file
     * (facts as claimed, then measured); `tts` is the dialogue and the voice.
     * `prepared` is the worker's validated WAV — what the lip-sync provider
     * receives — and is written by prepare (an upload) or by the advance
     * after the TTS stage. The dialogue is the member's private text: it is
     * never selected into a view (`jobToView` is an allow-list).
     */
    audio: z
      .object({
        source: z.enum(["upload", "tts"]),
        upload: z
          .object({
            path: z.string().min(1),
            mime: z.string().min(1),
            size: z.number().int().positive(),
            durationMs: z.number().int().positive().nullable(),
            name: z.string().max(200).optional(),
          })
          .nullable()
          .optional(),
        tts: z
          .object({
            text: z.string().max(10_000),
            languageCode: z.string().max(40),
            voiceId: z.string().max(40),
            providerVoiceId: z.string().max(80).nullable(),
            model: z.string().max(160).nullable().optional(),
          })
          .nullable()
          .optional(),
        /** 2026-09-20: an uploaded recording re-voiced in a catalogue voice (the worker's voice changer). */
        convert: z
          .object({
            voiceId: z.string().max(40),
            providerVoiceId: z.string().max(80),
            model: z.string().max(160),
          })
          .nullable()
          .optional(),
        /** 2026-09-20: the worker made the voice itself (a synchronous provider) — what it used, for the operator. */
        synthesized: z
          .object({
            provider: z.string().max(40),
            model: z.string().max(160),
            kind: z.enum(["tts", "voice_change"]),
            bytes: z.number().int().nonnegative(),
            durationMs: z.number().int().nonnegative(),
          })
          .nullable()
          .optional(),
        trimToFit: z.boolean().default(false),
        voiceConsent: z.boolean().default(false),
        prepared: z
          .object({
            path: z.string().min(1),
            durationMs: z.number().int().positive(),
            sampleRate: z.number().int().positive().nullable(),
            channels: z.number().int().positive().nullable(),
            codec: z.string().nullable(),
            bitrate: z.number().int().positive().nullable(),
            bytes: z.number().int().positive(),
            /** True when the audio was cut to the video's length (the member asked for it). */
            trimmed: z.boolean(),
            /** True when the audio was shorter than the video and silence was added to the end. */
            padded: z.boolean(),
            /** True when the file was re-encoded to WAV; false when the upload was already compatible and copied. */
            transcoded: z.boolean(),
          })
          .nullable()
          .optional(),
      })
      .nullable()
      .default(null),
    /** Part 6 §9/§15: the stages this job runs and where it is. Null before /start, and on every row before Part 6. */
    pipeline: characterReplacePipelineSchema.nullable().default(null),
    /**
     * What was sent to the provider for the REPLACEMENT stage, for the
     * operator. Never the URLs. `settings` is the tier's provider mapping
     * (modes.ts); Full Character rows carry `resolution`, `goFast` and
     * `mergeAudio` exactly as Part 4 wrote them.
     */
    provider: z
      .object({
        model: z.string(),
        version: z.string(),
        resolution: z.enum(["480", "720"]).optional(),
        goFast: z.boolean().optional(),
        mergeAudio: z.boolean(),
        settings: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough()
      .nullable(),
    /**
     * Skin + Face brief §7: the operator's estimate of the provider's cost, in
     * US cents, recorded at /start beside the customer charge. Admin-only;
     * `jobToView` never selects it.
     */
    provider_cost_estimate: z
      .object({ replaceUsdCents: z.number(), lipSyncUsdCents: z.number(), totalUsdCents: z.number(), perSecondUsdCents: z.number() })
      .nullable()
      .optional(),
    provider_output_url: z.string().nullable().optional(),
    failure_category: z.enum(["user", "provider", "system"]).optional(),
  })
  .passthrough();

export type CharacterReplaceJobMeta = z.infer<typeof characterReplaceJobMetaSchema>;
export type CharacterReplaceAudioMeta = NonNullable<CharacterReplaceJobMeta["audio"]>;

/** Null for a row that is not a Character Replace job, or whose metadata is not (yet) whole. */
export function readCharacterReplaceMeta(metadata: unknown): CharacterReplaceJobMeta | null {
  const parsed = characterReplaceJobMetaSchema.safeParse(metadata);
  return parsed.success ? parsed.data : null;
}

/** The pipeline alone, typed for the pure stage functions. Null when the row has none. */
export function readPipeline(metadata: unknown): PipelineMeta | null {
  const m = metadata && typeof metadata === "object" ? (metadata as { pipeline?: unknown }).pipeline : null;
  const parsed = characterReplacePipelineSchema.safeParse(m);
  return parsed.success ? (parsed.data as PipelineMeta) : null;
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

/** Every reference image path on the row as UPLOADED, primary first — what /start stats and the worker downloads. */
export function referencePaths(meta: Pick<CharacterReplaceJobMeta, "character" | "references">): string[] {
  return [meta.character.path, ...meta.references.map((r) => r.path)];
}

/**
 * Every reference image path as the PROVIDER should read it, primary first:
 * the worker's clean re-encode when it exists, the upload otherwise (a row
 * prepared before 2026-09-20, or a re-encode that could not be written).
 */
export function providerReferencePaths(meta: Pick<CharacterReplaceJobMeta, "character" | "references">): string[] {
  return [meta.character.preparedPath ?? meta.character.path, ...meta.references.map((r) => r.preparedPath ?? r.path)];
}

/* ───────────────────────── 2026-09-21: the provider plan ─────────────────── */

/** The router's decision written at Start (start-job.ts `provider_plan`), read by every later step. */
export interface ProviderPlan {
  id: "replicate" | "fal";
  model: string;
  version: string | null;
  lipSync: { id: "replicate" | "fal"; model: string; version: string | null } | null;
  providersVersion: number | null;
  test: boolean;
}

const providerPlanSchema = z
  .object({
    id: z.enum(["replicate", "fal"]).default("replicate"),
    model: z.string().default(""),
    version: z.string().nullable().optional(),
    lipSync: z.object({ id: z.enum(["replicate", "fal"]), model: z.string(), version: z.string().nullable().optional() }).nullable().optional(),
    providersVersion: z.number().int().nullable().optional(),
    test: z.boolean().optional(),
  })
  .passthrough();

/**
 * The plan on a row, or null for a row started before the router existed —
 * such a row ran on Replicate (its `provider` column says so), and the
 * callers treat null exactly that way. A job never re-asks the router.
 */
export function readProviderPlan(metadata: unknown): ProviderPlan | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).provider_plan;
  const parsed = providerPlanSchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  return {
    id: p.id,
    model: p.model,
    version: p.version ?? null,
    lipSync: p.lipSync ? { id: p.lipSync.id, model: p.lipSync.model, version: p.lipSync.version ?? null } : null,
    providersVersion: p.providersVersion ?? null,
    test: p.test === true,
  };
}

/** The vendor a stage of THIS job runs on — the plan first, the row's column second, Replicate last (a row from before the router). */
export function stageVendor(row: { provider?: string | null; metadata?: unknown }, stage: "replace" | "lipsync" | "voice"): "replicate" | "fal" {
  const plan = readProviderPlan(row.metadata);
  if (stage === "lipsync") return plan?.lipSync?.id ?? "replicate";
  if (stage === "voice") return "replicate";
  if (plan) return plan.id;
  return row.provider === "fal" ? "fal" : "replicate";
}

/**
 * The vendor holding the request CURRENTLY on the row — for the reconciler,
 * the cancel route and the stall sweep. The pipeline's current stage record
 * (written at submission, the record of what actually ran) first; the plan
 * second; the row's column last. A row from before the router is Replicate.
 */
export function jobVendor(row: { provider?: string | null; metadata?: unknown }): "replicate" | "fal" {
  const pipeline = readPipeline(row.metadata);
  const stage = pipeline?.current;
  if (pipeline && stage && stage !== "finalize") {
    const recorded = pipeline.records[stage]?.provider?.id;
    if (recorded === "fal" || recorded === "replicate") return recorded;
    return stageVendor(row, stage);
  }
  return row.provider === "fal" ? "fal" : "replicate";
}
