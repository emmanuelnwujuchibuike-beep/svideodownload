import "server-only";

import { readCharacterReplaceMeta } from "@/lib/ai/character-replace/job-meta";
import { wanResolutionFor } from "@/lib/ai/character-replace/model";
import { characterReplaceProvider } from "@/lib/ai/character-replace/provider";
import { AiJobError } from "@/lib/ai/errors";
import type { AiJobRow, AiJobStatus } from "@/lib/ai/jobs";
import { getJobAsService, transitionJob } from "@/lib/ai/job-store";
import { pathBelongsTo } from "@/lib/ai/storage";
import { signSourceUrl } from "@/lib/ai/storage-server";
import { getLandingSettings } from "@/lib/landing/settings";
import { SITE_URL } from "@/lib/site";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SUBMIT A PREPARED CHARACTER REPLACE JOB TO THE PROVIDER (Stage E + F)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Called by /api/internal/ai/submit once the worker has produced the
 * prepared (trimmed, normalised) file — never before, and never from the
 * browser's request. Everything it sends is the ROW's: the two object paths
 * (re-checked for ownership before they become signed URLs handed to a
 * third party), the settings the quote was made for, and the audio fact
 * the worker measured. Nothing from a request reaches the payload.
 *
 * The transition `acquiring → processing` is a compare-and-set that
 * records the prediction id: two deliveries of the worker's callback race,
 * one wins, the other matches no row and creates no second prediction.
 * ⚠️ The prediction is created BEFORE the transition, so a crash between
 * the two would leave a paid prediction with no id on the row — the
 * reconciler cannot find it, and the stall sweep ends and refunds the job
 * at its deadline. The window is one UPDATE; the alternative order (claim,
 * then create) would leave a job "processing" with no prediction at all,
 * which no sweep could ever complete. This way round fails toward a refund.
 */
export interface CharacterReplaceSubmission {
  reference: string;
  model: string;
  modelVersion: string | null;
  resolution: "480" | "720";
  mergeAudio: boolean;
  goFast: boolean;
}

export async function submitCharacterReplaceJob(
  job: AiJobRow,
  opts: { from: readonly AiJobStatus[]; origin?: string },
): Promise<{ submission: CharacterReplaceSubmission; row: AiJobRow | null }> {
  const provider = characterReplaceProvider();
  if (!provider.isConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", "character replace provider is not configured");

  // Re-read: the worker wrote `prepared` after the caller's copy of the row was taken.
  const fresh = (await getJobAsService(job.id)) ?? job;
  const meta = readCharacterReplaceMeta(fresh.metadata);
  if (!meta) throw new AiJobError("INTERNAL_ERROR", "job has no character replace metadata");
  if (!meta.prepared) throw new AiJobError("INTERNAL_ERROR", "job has no prepared media");
  if (!fresh.user_id) throw new AiJobError("INTERNAL_ERROR", "character replace jobs belong to a member");

  // 🔴 Ownership of BOTH paths, re-checked at the moment they become URLs.
  if (!pathBelongsTo(meta.prepared.path, fresh.user_id, fresh.id) || !pathBelongsTo(meta.character.path, fresh.user_id, fresh.id)) {
    throw new AiJobError("INTERNAL_ERROR", "a media path failed ownership");
  }

  const resolution = wanResolutionFor(meta.settings.quality);
  if (!resolution) throw new AiJobError("QUALITY_UNAVAILABLE", `${meta.settings.quality} is not a resolution this provider offers`);

  const settings = await getLandingSettings();
  const goFast = settings.frenzAiCharacterReplace.providerGoFast === true;
  /*
    §8: merge the original audio when the source HAS audio and the member
    kept their original voice. A new voice (Part 5) will replace the track
    later; asking the model to merge it now would only be undone.
  */
  const mergeAudio = meta.prepared.hasAudio && meta.settings.voiceMode === "original";

  const [videoUrl, characterImageUrl] = await Promise.all([signSourceUrl(meta.prepared.path), signSourceUrl(meta.character.path)]);
  const origin = (opts.origin ?? process.env.NEXT_PUBLIC_SITE_URL ?? SITE_URL).replace(/\/$/, "");

  const state = await provider.createPrediction({
    jobId: fresh.id,
    videoUrl,
    characterImageUrl,
    resolution,
    goFast,
    mergeAudio,
    webhookUrl: `${origin}/api/ai/replicate/webhook`,
  });

  const row = await transitionJob(fresh.id, opts.from, "processing", {
    replicate_prediction_id: state.reference,
    model: provider.model,
    model_version: state.modelVersion ?? provider.version,
    started_at: fresh.started_at ?? new Date().toISOString(),
    metadata: {
      ...(fresh.metadata ?? {}),
      provider: { model: provider.model, version: state.modelVersion ?? provider.version, resolution, goFast, mergeAudio },
    },
  });

  console.info("[cr/submit] prediction created", {
    jobId: fresh.id,
    userId: fresh.user_id,
    feature: "ai_character_replace",
    provider: provider.id,
    predictionId: state.reference,
    model: provider.model,
    modelVersion: state.modelVersion ?? provider.version,
    quality: meta.settings.quality,
    resolution,
    durationMs: meta.prepared.durationMs,
    chargedCents: fresh.charged_cents,
    pricingVersion: meta.quote?.pricingConfigVersion ?? null,
    transition: `${opts.from.join("|")} -> processing`,
    claimed: !!row,
  });

  if (!row) {
    // The claim lost (cancelled meanwhile, or a duplicate callback). Do not leave a paid run going.
    await provider.cancel(state.reference).catch(() => false);
  }

  return {
    submission: { reference: state.reference, model: provider.model, modelVersion: state.modelVersion, resolution, mergeAudio, goFast },
    row,
  };
}
