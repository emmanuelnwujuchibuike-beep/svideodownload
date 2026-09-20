import "server-only";

import { withCircuit } from "@/lib/ai/character-replace/circuit";
import { providerReferencePaths, readCharacterReplaceMeta, readPipeline, type CharacterReplaceJobMeta } from "@/lib/ai/character-replace/job-meta";
import { markSubmitted, planPipeline, type PipelineMeta, type PipelineStage } from "@/lib/ai/character-replace/pipeline";
import { replacementProviderFor } from "@/lib/ai/character-replace/providers/router";
import { AiJobError } from "@/lib/ai/errors";
import { recordJobEvent } from "@/lib/ai/job-events";
import type { AiJobRow, AiJobStatus } from "@/lib/ai/jobs";
import { getJobAsService, transitionJob } from "@/lib/ai/job-store";
import { pathBelongsTo } from "@/lib/ai/storage";
import { signSourceUrl } from "@/lib/ai/storage-server";
import { lipSyncProviderFor } from "@/lib/ai/voice/lipsync-provider";
import { textToSpeechProviderFor } from "@/lib/ai/voice/tts-provider";
import { getLandingSettings } from "@/lib/landing/settings";
import { SITE_URL } from "@/lib/site";
import { replicateProvider } from "@/lib/ai/replicate/provider";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SUBMIT THE CURRENT STAGE OF A CHARACTER REPLACE JOB TO ITS PROVIDER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Called by /api/internal/ai/submit — once the worker has produced the
 * prepared (trimmed, normalised) file for the FIRST provider stage, and
 * again after every "advance" (the worker brought a finished stage home and
 * the next one is due). Never before, and never from the browser's request.
 * Everything it sends is the ROW's: the object paths (re-checked for
 * ownership before they become signed URLs handed to a third party), the
 * settings the quote was made for, the facts the worker measured. Nothing
 * from a request reaches a payload.
 *
 * ── Which stage, which provider (Part 6) ────────────────────────────────────
 *
 *   voice     the text-to-speech adapter for the configured model
 *   replace   the replacement router — Face Only / Skin + Face / Full Character
 *   lipsync   the lip-sync adapter for the tier's configured model, on the
 *             REPLACED video and the prepared WAV
 *
 * A row from before Part 6 has no `pipeline`; it is planned here as
 * `replace → finalize`, which is exactly the job it always was.
 *
 * ── The compare-and-set ─────────────────────────────────────────────────────
 *
 * The transition `acquiring → processing` (first stage) or `processing →
 * processing` (a later stage, guarded by the PREVIOUS stage's prediction id)
 * records the new prediction id: two deliveries of the worker's callback
 * race, one wins, the other matches no row and its prediction is cancelled.
 * ⚠️ The prediction is created BEFORE the transition (see Part 4's note): a
 * crash between the two leaves a paid prediction with no id on the row, and
 * the stall sweep ends and refunds the job at its deadline. The alternative
 * order would leave a job "processing" with no prediction at all, which no
 * sweep could ever complete. This way round fails toward a refund.
 */
export interface CharacterReplaceSubmission {
  reference: string;
  model: string;
  modelVersion: string | null;
  stage: PipelineStage;
  settings: Record<string, unknown>;
  mergeAudio: boolean;
}

export async function submitCharacterReplaceJob(
  job: AiJobRow,
  opts: { from: readonly AiJobStatus[]; origin?: string },
): Promise<{ submission: CharacterReplaceSubmission; row: AiJobRow | null }> {
  if (!replicateProvider.isConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", "character replace provider is not configured");

  // Re-read: the worker wrote `prepared` (or a stage's stored output) after the caller's copy of the row was taken.
  const fresh = (await getJobAsService(job.id)) ?? job;
  const meta = readCharacterReplaceMeta(fresh.metadata);
  if (!meta) throw new AiJobError("INTERNAL_ERROR", "job has no character replace metadata");
  if (!meta.prepared) throw new AiJobError("INTERNAL_ERROR", "job has no prepared media");
  if (!fresh.user_id) throw new AiJobError("INTERNAL_ERROR", "character replace jobs belong to a member");

  const pipeline: PipelineMeta =
    readPipeline(fresh.metadata) ??
    planPipeline({ mode: meta.mode, voiceMode: meta.settings.voiceMode, voiceSource: meta.audio?.source ?? null, lipSyncMode: meta.settings.lipSyncMode });
  const stage = pipeline.current;
  if (stage === "finalize") throw new AiJobError("INTERNAL_ERROR", "the pipeline is at finalize; nothing to submit");
  const record = pipeline.records[stage];
  if (record && (record.status === "submitted" || record.status === "processing") && record.predictionId) {
    // Already handed to the provider (a duplicate callback). Nothing to do twice.
    return {
      submission: { reference: record.predictionId, model: record.provider?.model ?? "", modelVersion: record.provider?.version ?? null, stage, settings: {}, mergeAudio: meta.provider?.mergeAudio ?? false },
      row: null,
    };
  }
  // The previous stage's prediction id is the guard for a later stage; null for the first.
  const previousId = fresh.replicate_prediction_id ?? null;

  const settings = await getLandingSettings();
  const config = settings.frenzAiCharacterReplace;
  const origin = (opts.origin ?? process.env.NEXT_PUBLIC_SITE_URL ?? SITE_URL).replace(/\/$/, "");
  const webhookUrl = `${origin}/api/ai/replicate/webhook`;
  const now = new Date().toISOString();

  let created: { reference: string; model: string; modelVersion: string | null; settings: Record<string, unknown>; mergeAudio: boolean };
  let providerNote: CharacterReplaceJobMeta["provider"] | undefined;

  if (stage === "voice") {
    /* ── text → speech ─────────────────────────────────────────────────── */
    const tts = meta.audio?.source === "tts" ? meta.audio.tts : null;
    if (!tts) throw new AiJobError("INTERNAL_ERROR", "voice stage without a dialogue");
    const provider = textToSpeechProviderFor(config.tts.model);
    if (!provider.isConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", `text-to-speech model ${config.tts.model} is not configured`);
    if (!provider.supportedLanguages().includes(tts.languageCode)) throw new AiJobError("INVALID_INPUT", `language ${tts.languageCode} is not spoken by ${config.tts.model}`);
    // Part 8 §7: under the breaker — refused while the model's circuit is open, scored after.
    const sub = await withCircuit(provider.model, config.ops.circuitBreaker, () =>
      provider.createPrediction({ jobId: fresh.id, text: tts.text, languageCode: tts.languageCode, providerVoiceId: tts.providerVoiceId, webhookUrl }),
    );
    created = { reference: sub.reference, model: sub.model, modelVersion: sub.modelVersion, settings: sub.settings, mergeAudio: false };
  } else if (stage === "replace") {
    /* ── the replacement, routed by mode ───────────────────────────────── */
    // The worker's clean re-encodes, never the raw uploads (2026-09-20 — see the prepare service).
    const refs = providerReferencePaths(meta);
    for (const p of [meta.prepared.path, ...refs]) {
      // 🔴 Ownership of EVERY path, re-checked at the moment they become URLs.
      if (!pathBelongsTo(p, fresh.user_id, fresh.id)) throw new AiJobError("INTERNAL_ERROR", "a media path failed ownership");
    }
    const provider = replacementProviderFor(meta.mode);
    if (!provider.isConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", `${meta.mode} provider is not configured`);
    /*
      §8 (Part 4): keep the original audio in the model's output when the
      source HAS audio and the member kept their original voice. A new voice
      replaces the track later (the finalizer muxes it, or the lip-sync stage
      carries it); asking the model to keep it now would only be undone.
    */
    const keepOriginalAudio = meta.prepared.hasAudio && meta.settings.voiceMode === "original";
    const [videoUrl, ...referenceImageUrls] = await Promise.all([signSourceUrl(meta.prepared.path), ...refs.map((p) => signSourceUrl(p))]);
    const sub = await withCircuit(provider.model, config.ops.circuitBreaker, () =>
      provider.createPrediction({
        jobId: fresh.id,
        mode: meta.mode,
        videoUrl,
        referenceImageUrls,
        quality: meta.settings.quality,
        keepOriginalAudio,
        goFast: config.providerGoFast === true,
        webhookUrl,
      }),
    );
    created = { reference: sub.reference, model: sub.model, modelVersion: sub.modelVersion, settings: sub.settings, mergeAudio: sub.mergeAudio };
    providerNote = {
      model: sub.model,
      version: sub.modelVersion ?? provider.version,
      mergeAudio: sub.mergeAudio,
      settings: sub.settings,
      // Part 4's two fields, kept for every Full Character row exactly as before.
      ...(meta.mode === "full_character" ? { resolution: sub.settings.resolution as "480" | "720", goFast: config.providerGoFast === true } : {}),
    };
  } else {
    /* ── lip sync on the REPLACED video (§10) ──────────────────────────── */
    const replaced = pipeline.records.replace?.storedPath ?? null;
    const wav = meta.audio?.prepared?.path ?? null;
    if (!replaced || !wav) throw new AiJobError("INTERNAL_ERROR", "lip sync needs the replaced video and the prepared audio");
    if (!pathBelongsTo(replaced, fresh.user_id, fresh.id) || !pathBelongsTo(wav, fresh.user_id, fresh.id)) throw new AiJobError("INTERNAL_ERROR", "a media path failed ownership");
    const tierId = meta.settings.lipSyncMode;
    const tier = tierId ? config.lipSync.find((l) => l.id === tierId) : null;
    if (!tier) throw new AiJobError("INTERNAL_ERROR", "lip sync stage without a tier");
    const provider = lipSyncProviderFor(tier.model);
    if (!provider.isConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", `lip-sync model ${tier.model} is not configured`);
    const [videoUrl, audioUrl] = await Promise.all([signSourceUrl(replaced), signSourceUrl(wav)]);
    const sub = await withCircuit(provider.model, config.ops.circuitBreaker, () =>
      provider.createPrediction({ jobId: fresh.id, videoUrl, audioUrl, syncMode: config.audio.syncMode, webhookUrl }),
    );
    created = { reference: sub.reference, model: sub.model, modelVersion: sub.modelVersion, settings: sub.settings, mergeAudio: true };
  }

  const nextPipeline = markSubmitted(pipeline, stage, { predictionId: created.reference, provider: { id: "replicate", model: created.model, version: created.modelVersion }, at: now });
  const row = await transitionJob(
    fresh.id,
    opts.from,
    "processing",
    {
      replicate_prediction_id: created.reference,
      model: created.model,
      model_version: created.modelVersion,
      started_at: fresh.started_at ?? now,
      // Fresh metadata (re-read above), the pipeline moved, the replacement's provider note when this was that stage.
      metadata: {
        ...(fresh.metadata ?? {}),
        pipeline: nextPipeline,
        ...(providerNote ? { provider: providerNote } : {}),
        provider_output_url: null,
      },
    },
    { predictionId: previousId },
  );

  await recordJobEvent(job.id, "provider.submitted", { stage, predictionId: created.reference, model: created.model, version: created.modelVersion });
  console.info("[cr/submit] prediction created", {
    jobId: fresh.id,
    userId: fresh.user_id,
    feature: "ai_character_replace",
    mode: meta.mode,
    stage,
    provider: "replicate",
    predictionId: created.reference,
    model: created.model,
    modelVersion: created.modelVersion,
    quality: meta.settings.quality,
    settings: created.settings,
    durationMs: meta.prepared.durationMs,
    chargedCents: fresh.charged_cents,
    pricingVersion: meta.quote?.pricingConfigVersion ?? null,
    transition: `${opts.from.join("|")} -> processing`,
    claimed: !!row,
  });

  if (!row) {
    // The claim lost (cancelled meanwhile, or a duplicate callback). Do not leave a paid run going.
    await replicateProvider.cancel(created.reference).catch(() => false);
  }

  return {
    submission: { reference: created.reference, model: created.model, modelVersion: created.modelVersion, stage, settings: created.settings, mergeAudio: created.mergeAudio },
    row,
  };
}
