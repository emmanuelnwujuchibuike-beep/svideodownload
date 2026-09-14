import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { readCharacterReplaceMeta } from "@/lib/ai/character-replace/job-meta";
import { settleCharacterReplaceCharge } from "@/lib/ai/character-replace/wallet";
import { releaseJobFunding } from "@/lib/ai/funding";
import { aiFeature, type AiJobRow } from "@/lib/ai/jobs";
import { getJobAsService, noteJobDiagnostic, transitionJob } from "@/lib/ai/job-store";
import { notifyAiJobFailed, notifyAiJobFinished } from "@/lib/ai/notify";
import { subjectFromRow, subjectOwnerId } from "@/lib/ai/subject";
import { aiErrorMessage } from "@/lib/ai/errors";
import {
  cleanupFinalizationFiles,
  downloadToFile,
  makeResultPoster,
  probeMedia,
  uploadFinalResult,
  type FinalizeErrorCode,
  type FinalizeOutcome,
} from "@/server/services/ai-finalize-service";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FINALIZE A CHARACTER REPLACE JOB — the provider's file becomes OURS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 4, §18–§20): retrieve the output, validate that
 * it exists and is a video, copy it into FrenzSave's own private storage
 * (a Replicate URL is a temporary provider resource, never the member's
 * asset), record the metadata, mark the job complete — and serve it only
 * through the existing signed-URL result route with its ownership check.
 *
 * Unlike AI Clean, nothing is muxed: Wan returns the picture WITH the
 * original audio when `merge_audio` was set, so the worker's job is to
 * verify and keep, not to repair. The claim `processing → finalizing` is a
 * compare-and-set (the same lock every finalizer here uses); two
 * deliveries of the webhook, or the webhook and the reconciler, cannot
 * both run this.
 *
 * ── The money ───────────────────────────────────────────────────────────────
 *
 * Success SETTLES the reservation (`settle_product_charge`: reserved →
 * settled, the balance already moved at /start). Failure REFUNDS it, once,
 * through `releaseJobFunding`. The webhook never decides an amount (§17);
 * the ledger row written at /start is the only record of what was charged.
 */
export async function finalizeCharacterReplaceJob(jobId: string): Promise<FinalizeOutcome> {
  const startedAt = Date.now();
  const job = await getJobAsService(jobId);
  if (!job) return { ok: false, jobId, code: "RESULT_NOT_FOUND", detail: "no such job" };
  const feature = aiFeature(job.feature);
  if (!feature || feature.id !== "ai_character_replace") return { ok: false, jobId, code: "AI_FINALIZATION_FAILED", detail: "not a character replace job" };
  if (job.status === "completed" && job.result_path) return { ok: true, jobId, skipped: "already finalized" };

  const providerOutputUrl = typeof job.metadata?.provider_output_url === "string" ? job.metadata.provider_output_url : null;
  if (!providerOutputUrl) return { ok: false, jobId, code: "INVALID_AI_OUTPUT", detail: "no provider output recorded" };
  if (!/^https:\/\//.test(providerOutputUrl)) return { ok: false, jobId, code: "INVALID_AI_OUTPUT", detail: "provider output is not an https url" };

  const owner = subjectFromRow(job);
  if (!owner || owner.kind !== "user") return { ok: false, jobId, code: "AI_FINALIZATION_FAILED", detail: "job row has no member owner" };
  const ownerId = subjectOwnerId(owner);
  const meta = readCharacterReplaceMeta(job.metadata);

  const claimed = await transitionJob(jobId, ["processing"], "finalizing");
  if (!claimed) return { ok: true, jobId, skipped: `not claimable from ${job.status}` };
  console.info("[cr/finalize] started", { jobId, userId: ownerId, feature: feature.id, predictionId: job.replicate_prediction_id, transition: "processing -> finalizing" });

  const dir = path.join(tmpdir(), "frenz-ai-cr-out", jobId.replace(/[^0-9a-fA-F-]/g, ""));
  const outputFile = path.join(dir, "output.mp4");
  try {
    await mkdir(dir, { recursive: true });
    // The provider's file, with the ceiling enforced as the bytes arrive.
    const bytes = await downloadToFile(providerOutputUrl, outputFile, MAX_OUTPUT_BYTES).catch((e) => {
      throw new CrFinalizeFailure("INVALID_AI_OUTPUT", `download: ${String(e)}`);
    });
    const probe = await probeMedia(outputFile);
    if (!probe?.hasVideo || !probe.durationSeconds || probe.durationSeconds <= 0) {
      throw new CrFinalizeFailure("INVALID_AI_OUTPUT", "the provider's output has no readable video stream");
    }
    /*
      The output should be the length that was priced. A frame's rounding is
      fine; a file a third the length is a broken run, not a shorter video.
      Wan writes 30 fps, so a 30% tolerance also absorbs a fps resample.
    */
    const expectedMs = meta?.prepared?.durationMs ?? meta?.quote?.durationMs ?? null;
    const actualMs = Math.round(probe.durationSeconds * 1000);
    if (expectedMs !== null && Math.abs(actualMs - expectedMs) > Math.max(1000, expectedMs * 0.3)) {
      throw new CrFinalizeFailure("INVALID_AI_OUTPUT", `expected about ${expectedMs} ms, the output is ${actualMs} ms`);
    }
    const audioExpected = meta?.provider?.mergeAudio === true;
    if (audioExpected && !probe.hasAudio) {
      // Not fatal — the picture is the product; say so on the row and in the result panel.
      await noteJobDiagnostic(jobId, { audio_missing_from_provider: true });
    }

    let stored: { path: string; bytes: number };
    try {
      stored = await uploadFinalResult({ ownerId, feature: feature.id, jobId, filePath: outputFile });
    } catch (e) {
      throw new CrFinalizeFailure("FINAL_UPLOAD_FAILED", String(e), "system");
    }
    const posterPath = await makeResultPoster({ videoPath: outputFile, dir, ownerId, feature: feature.id, jobId, durationSeconds: probe.durationSeconds });

    const completed = await transitionJob(jobId, ["finalizing"], "completed", {
      result_path: stored.path,
      poster_path: posterPath,
      result_size: stored.bytes,
      result_duration: probe.durationSeconds,
      result_mime_type: "video/mp4",
      audio_restored: audioExpected ? probe.hasAudio : null,
      completed_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
      // Fresh metadata (a diagnostic may have landed meanwhile); the provider URL has served its purpose.
      metadata: {
        ...((await getJobAsService(jobId))?.metadata ?? job.metadata ?? {}),
        provider_output_url: null,
        output: { width: probe.width, height: probe.height, durationMs: actualMs, bytes: stored.bytes, hasAudio: probe.hasAudio },
        finalized_ms: Date.now() - startedAt,
      },
    });

    if (completed) {
      // Stage H — the charge is kept: reserved → settled on the product ledger.
      const settled = await settleCharacterReplaceCharge(ownerId, jobId);
      if (!settled) console.error("[cr/finalize] settle found no reserved charge", { jobId, userId: ownerId });
      await notifyAiJobFinished({ userId: ownerId, jobId, feature: feature.id, audioRestored: audioExpected ? probe.hasAudio : null, durationMs: Date.now() - startedAt });
    }
    console.info("[cr/finalize] completed", {
      jobId,
      userId: ownerId,
      feature: feature.id,
      predictionId: job.replicate_prediction_id,
      durationMs: actualMs,
      bytes: stored.bytes,
      hasAudio: probe.hasAudio,
      chargedCents: job.charged_cents,
      pricingVersion: meta?.quote?.pricingConfigVersion ?? null,
      elapsedMs: Date.now() - startedAt,
      transition: "finalizing -> completed",
      settled: !!completed,
      downloadedBytes: bytes,
    });
    return { ok: true, jobId, audioRestored: probe.hasAudio, durationSeconds: probe.durationSeconds, bytes: stored.bytes };
  } catch (e) {
    const failure = e instanceof CrFinalizeFailure ? e : new CrFinalizeFailure("AI_FINALIZATION_FAILED", String(e), "system");
    await failFinalize(job, failure);
    return { ok: false, jobId, code: failure.code, detail: failure.detail };
  } finally {
    await cleanupFinalizationFiles(dir);
  }
}

/** A 60 s 720p output from the model is a few tens of MB; a ceiling well above that. */
const MAX_OUTPUT_BYTES = 500 * 1024 * 1024;

class CrFinalizeFailure extends Error {
  constructor(
    readonly code: FinalizeErrorCode,
    readonly detail: string,
    readonly category: "provider" | "system" = "provider",
  ) {
    super(detail);
    this.name = "CrFinalizeFailure";
  }
}

async function failFinalize(job: AiJobRow, failure: CrFinalizeFailure): Promise<void> {
  const updated = await transitionJob(job.id, ["finalizing"], "failed", {
    error_code: failure.code,
    error_message: failure.detail.slice(0, 2000),
    completed_at: new Date().toISOString(),
  });
  await noteJobDiagnostic(job.id, { failure_category: failure.category, failed_in: "finalize" });
  const subject = subjectFromRow(job);
  if (updated && subject) {
    // Stage I — refund exactly once (idempotent per job).
    await releaseJobFunding({ job: updated, subject, feature: "ai_character_replace", dailyLimit: 0 });
    if (subject.kind === "user") {
      await notifyAiJobFailed({ userId: subject.userId, jobId: job.id, feature: "ai_character_replace", message: aiErrorMessage("PROCESSING_FAILED"), errorCode: failure.code });
    }
  }
  console.error("[cr/finalize] failed", {
    jobId: job.id,
    userId: job.user_id,
    predictionId: job.replicate_prediction_id,
    code: failure.code,
    category: failure.category,
    detail: failure.detail.slice(0, 300),
    transition: "finalizing -> failed",
    refunded: !!updated,
  });
}
