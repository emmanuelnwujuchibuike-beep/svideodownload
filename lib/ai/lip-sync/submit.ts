import "server-only";

import { withCircuit } from "@/lib/ai/character-replace/circuit";
import { readProviderPlan } from "@/lib/ai/character-replace/job-meta";
import { markSubmitted, type PipelineMeta } from "@/lib/ai/character-replace/pipeline";
import { AiJobError } from "@/lib/ai/errors";
import { recordJobEvent } from "@/lib/ai/job-events";
import { getJobAsService, transitionJob } from "@/lib/ai/job-store";
import type { AiJobRow, AiJobStatus } from "@/lib/ai/jobs";
import { readLipSyncMeta, readLipSyncPipeline } from "@/lib/ai/lip-sync/job-meta";
import { lipSyncAdapterFor } from "@/lib/ai/lip-sync/providers/router";
import type { LipSyncSpeech } from "@/lib/ai/lip-sync/providers/types";
import { providerFor } from "@/lib/ai/providers";
import { openProviderRun } from "@/lib/ai/providers/runs";
import { pathBelongsTo } from "@/lib/ai/storage";
import { signSourceUrl } from "@/lib/ai/storage-server";
import { getLandingSettings } from "@/lib/landing/settings";
import { SITE_URL } from "@/lib/site";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SUBMIT THE LIP SYNC STAGE — after the worker prepared the video (and the audio)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Called by /api/internal/ai/submit once the worker has produced the
 * prepared video and — for an uploaded or a voice-provider-made speech —
 * the prepared WAV. Everything sent is the ROW's: the paths (ownership
 * re-checked before they become signed URLs), the settings the quote was
 * made for, the plan the router wrote at Start. A text-native job sends the
 * text itself; every other job sends the audio. The compare-and-set
 * `acquiring → processing` records the request id, exactly as the Character
 * Replace submit does (lib/ai/character-replace/submit.ts).
 */
export interface LipSyncSubmission {
  reference: string;
  model: string;
  modelVersion: string | null;
  settings: Record<string, unknown>;
}

export async function submitLipSyncJob(job: AiJobRow, opts: { from: readonly AiJobStatus[]; origin?: string }): Promise<{ submission: LipSyncSubmission; row: AiJobRow | null }> {
  const fresh = (await getJobAsService(job.id)) ?? job;
  const meta = readLipSyncMeta(fresh.metadata);
  if (!meta) throw new AiJobError("INTERNAL_ERROR", "job has no lip sync metadata");
  if (!meta.prepared) throw new AiJobError("INTERNAL_ERROR", "job has no prepared media");
  if (!fresh.user_id) throw new AiJobError("INTERNAL_ERROR", "lip sync jobs belong to a member");
  const pipeline: PipelineMeta = readLipSyncPipeline(fresh.metadata) ?? { stages: ["lipsync", "finalize"], current: "lipsync", records: { lipsync: { status: "pending" } }, stage_started_at: null, pending_advance: null };
  const record = pipeline.records.lipsync;
  if (record && (record.status === "submitted" || record.status === "processing") && record.predictionId) {
    return { submission: { reference: record.predictionId, model: record.provider?.model ?? "", modelVersion: record.provider?.version ?? null, settings: {} }, row: null };
  }

  const settings = await getLandingSettings();
  const config = settings.frenzAiLipSync;
  const plan = readProviderPlan(fresh.metadata);
  const vendor = plan?.id ?? (fresh.provider === "fal" ? "fal" : "replicate");
  const model = plan?.model || config.models[vendor].model;
  const adapter = lipSyncAdapterFor(vendor, model, settings.frenzAiProviders);
  if (!adapter) throw new AiJobError("FEATURE_UNAVAILABLE", `no lip-sync adapter for ${model} on ${vendor}`);
  if (!adapter.isConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", `${model} is not configured on this deployment`);
  const generic = providerFor(vendor);
  const origin = (opts.origin ?? process.env.NEXT_PUBLIC_SITE_URL ?? SITE_URL).replace(/\/$/, "");
  const webhookUrl = vendor === "fal" ? `${origin}/api/webhooks/fal` : `${origin}/api/ai/replicate/webhook`;

  // the speech, as the model takes it
  const speechPath = (plan as { speechPath?: unknown } | null)?.speechPath === "native" ? "native" : meta.speech.source === "text" ? (meta.speech.path ?? "tts") : "audio";
  let speech: LipSyncSpeech;
  let audioFacts: { durationMs: number; bytes: number; mime: string } | null = null;
  if (meta.speech.source === "text" && speechPath === "native") {
    if (!adapter.capabilities.supports_text) throw new AiJobError("INTERNAL_ERROR", "a native-text plan on a model without text");
    speech = { kind: "text", text: meta.speech.text, providerVoiceId: meta.speech.providerVoiceId, languageCode: meta.speech.languageCode, speed: meta.speech.speed };
  } else {
    const wav = meta.audio?.prepared ?? null;
    if (!wav) throw new AiJobError("INTERNAL_ERROR", "the lip-sync stage needs the prepared audio");
    if (!pathBelongsTo(wav.path, fresh.user_id, fresh.id)) throw new AiJobError("INTERNAL_ERROR", "the audio path failed ownership");
    speech = { kind: "audio", audioUrl: await signSourceUrl(wav.path) };
    audioFacts = { durationMs: wav.durationMs, bytes: wav.bytes, mime: wav.mime };
  }
  if (!pathBelongsTo(meta.prepared.path, fresh.user_id, fresh.id)) throw new AiJobError("INTERNAL_ERROR", "the video path failed ownership");
  const videoUrl = await signSourceUrl(meta.prepared.path);
  const temperature = meta.settings.expression && adapter.capabilities.supports_temperature ? config.expression.temperature[meta.settings.expression] : null;
  const activeSpeaker = adapter.capabilities.supports_active_speaker ? meta.settings.activeSpeaker : null;
  const prepared = meta.prepared;
  const submitStarted = Date.now();
  const sub = await withCircuit(adapter.model, settings.frenzAiCharacterReplace.ops.circuitBreaker, () =>
    adapter.createPrediction({
      jobId: fresh.id,
      videoUrl,
      speech,
      syncMode: config.duration.providerSyncMode,
      temperature,
      activeSpeaker,
      webhookUrl,
      facts: { durationMs: prepared.durationMs, width: prepared.width, height: prepared.height, bytes: prepared.bytes, fps: prepared.fps ?? null },
      audioFacts,
    }),
  );
  const now = new Date().toISOString();
  const nextPipeline = markSubmitted(pipeline, "lipsync", { predictionId: sub.reference, provider: { id: vendor, model: sub.model, version: sub.modelVersion }, at: now });
  const row = await transitionJob(
    fresh.id,
    opts.from,
    "processing",
    {
      replicate_prediction_id: sub.reference,
      model: sub.model,
      model_version: sub.modelVersion,
      started_at: fresh.started_at ?? now,
      metadata: { ...(fresh.metadata ?? {}), pipeline: nextPipeline, provider_output_url: null },
    },
    { predictionId: null },
  );
  await recordJobEvent(job.id, "provider.submitted", { stage: "lipsync", provider: vendor, predictionId: sub.reference, model: sub.model, version: sub.modelVersion, speech: speechPath });
  const estimate = (meta.quote as { providerCostEstimate?: { lipSyncUsdCents?: number | null } } | null)?.providerCostEstimate?.lipSyncUsdCents ?? null;
  await openProviderRun({
    jobId: fresh.id,
    userId: fresh.user_id,
    feature: "ai_lip_sync",
    mode: speechPath,
    stage: "lipsync",
    provider: vendor,
    model: sub.model,
    modelVersion: sub.modelVersion,
    providerJobId: sub.reference,
    test: plan?.test === true,
    latencyMs: Date.now() - submitStarted,
    inputDurationMs: prepared.durationMs,
    inputResolution: `${prepared.width}x${prepared.height}`,
    costEstimateUsdCents: typeof estimate === "number" ? estimate : null,
    metadata: { settings: sub.settings, providersVersion: plan?.providersVersion ?? null },
  });
  console.info("[lipsync/submit] prediction created", { jobId: fresh.id, userId: fresh.user_id, provider: vendor, model: sub.model, speech: speechPath, predictionId: sub.reference, durationMs: prepared.durationMs, claimed: !!row });
  if (!row && generic) await generic.cancel(sub.reference, { model: sub.model }).catch(() => false);
  return { submission: { reference: sub.reference, model: sub.model, modelVersion: sub.modelVersion, settings: sub.settings }, row };
}
