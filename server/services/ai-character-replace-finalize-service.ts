import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { FINALIZE_LEASE_SECONDS, FINALIZE_MAX_ATTEMPTS, finalizeBackoffMs, isTransientFinalizeFailure } from "@/lib/ai/character-replace/finalize-policy";
import { readCharacterReplaceMeta, readPipeline } from "@/lib/ai/character-replace/job-meta";
import { isTrustedProviderOutputUrl } from "@/lib/ai/character-replace/model";
import { pathBelongsTo } from "@/lib/ai/storage";
import { signSourceUrl } from "@/lib/ai/storage-server";
import { settleCharacterReplaceCharge } from "@/lib/ai/character-replace/wallet";
import { releaseJobFunding } from "@/lib/ai/funding";
import { aiFeature, type AiJobRow } from "@/lib/ai/jobs";
import { recordJobEvent } from "@/lib/ai/job-events";
import { claimFinalization, getJobAsService, noteJobDiagnostic, scheduleFinalizationRetry, transitionJob } from "@/lib/ai/job-store";
import { notifyAiJobFailed, notifyAiJobFinished } from "@/lib/ai/notify";
import { subjectFromRow, subjectOwnerId } from "@/lib/ai/subject";
import { probeColor } from "@/server/services/ai-color-probe";
import { aiErrorMessage } from "@/lib/ai/errors";
import {
  cleanupFinalizationFiles,
  downloadToFile,
  makeResultPoster,
  probeMedia,
  restoreOriginalAudio,
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
 *
 * ── 🔴 A FAILURE ON OUR SIDE IS A RETRY, NOT A REFUND (Part 5, §10–§11) ─────
 *
 * Owner: "If storage upload fails after provider success: do NOT tell the
 * user the video is complete; keep provider success info; retry
 * finalization; only notify success after the result is safely stored."
 *
 * The claim is now a LEASE (`claimFinalization`, 0156): one owner at a time,
 * attempts counted on the row. A transient failure — the download stalled,
 * storage said no, the worker threw — leaves the job in `finalizing` with
 * the provider URL intact and a `finalize_next_at` in the future; the
 * reconcile sweep or the member's poll re-dispatches it. Only a PERMANENT
 * failure (the provider's file is not a video, is the wrong length, is gone)
 * or the last allowed attempt ends the job — and only then does the refund
 * go out and the "couldn't finish" push get sent. The member is never told
 * "ready" for a file that is not in our bucket.
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
  if (!isTrustedProviderOutputUrl(providerOutputUrl)) return { ok: false, jobId, code: "INVALID_AI_OUTPUT", detail: "provider output is not on a trusted host" };

  const owner = subjectFromRow(job);
  if (!owner || owner.kind !== "user") return { ok: false, jobId, code: "AI_FINALIZATION_FAILED", detail: "job row has no member owner" };
  const ownerId = subjectOwnerId(owner);
  const meta = readCharacterReplaceMeta(job.metadata);

  const claim = await claimFinalization(jobId, { leaseSeconds: FINALIZE_LEASE_SECONDS, maxAttempts: FINALIZE_MAX_ATTEMPTS });
  if (!claim.claimed) {
    if (claim.reason === "exhausted" && job.status === "finalizing") {
      // Every allowed attempt has run. End it honestly, once.
      await failFinalize(job, new CrFinalizeFailure("FINAL_UPLOAD_FAILED", job.finalize_error ?? "finalization attempts exhausted", "system"), { exhausted: true });
      return { ok: false, jobId, code: "FINAL_UPLOAD_FAILED", detail: "attempts exhausted" };
    }
    return { ok: true, jobId, skipped: `not claimable: ${claim.reason} (status ${job.status})` };
  }
  const attempt = claim.claimed.finalize_attempts;
  await recordJobEvent(jobId, "finalize.claimed", { attempt, predictionId: job.replicate_prediction_id, from: job.status });
  console.info("[cr/finalize] started", { jobId, userId: ownerId, feature: feature.id, predictionId: job.replicate_prediction_id, attempt, transition: `${job.status} -> finalizing` });

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
    /*
      ── §17 (Part 6): the container and the streams, before anything else ──
      A file exists and has bytes (the download enforced both); it must also
      be a container we can serve, hold a picture of a sane size, and carry
      the audio the plan promised. A lip-synced output without a track is a
      broken run, not a silent video.
    */
    const container = (probe.formatName ?? "").toLowerCase();
    if (container && !/mp4|mov|m4a|3gp|matroska|webm/.test(container)) throw new CrFinalizeFailure("INVALID_AI_OUTPUT", `unexpected container ${container}`);
    if (!probe.width || !probe.height || probe.width * probe.height > 3840 * 2160) throw new CrFinalizeFailure("INVALID_AI_OUTPUT", `unexpected frame size ${probe.width}x${probe.height}`);

    const pipeline = readPipeline(job.metadata);
    const lipSynced = !!pipeline?.stages.includes("lipsync");
    const newVoice = meta?.settings.voiceMode === "new_voice";
    const wavPath = meta?.audio?.prepared?.path ?? null;
    if (lipSynced && !probe.hasAudio) throw new CrFinalizeFailure("INVALID_AI_OUTPUT", "the lip-sync output has no audio track");
    /*
      What the finished file should carry:
        · a new voice WITH lip sync   — the lip-sync output already has it;
        · a new voice, NO lip sync    — the prepared WAV is muxed onto the
          replaced video below (a plain audio swap: the picture is copied,
          never re-encoded);
        · the original audio          — the model was asked to keep it
          (`mergeAudio`); Full Character (Wan) does, exactly as Part 4.
    */
    const audioExpected = lipSynced || (newVoice && !!wavPath) || meta?.provider?.mergeAudio === true;
    if (!newVoice && audioExpected && !probe.hasAudio) {
      // Not fatal — the picture is the product; say so on the row and in the result panel.
      await noteJobDiagnostic(jobId, { audio_missing_from_provider: true });
    }

    /*
      ── 🔴 THE MASTER IS THE PROVIDER'S FILE, BYTE FOR BYTE (owner, 2026-09-14:
      "The result and filter should be purely natural from replicate") ─────

      No colour-tag rewrite, no re-encode, no filter of any kind between the
      download above and the upload below. The colour probe is kept as a
      diagnostic on the row — it changes nothing. The ONE exception is the
      product the member chose: a new voice without lip sync is an audio
      swap, and the swap is a stream copy of the picture with the WAV muxed
      beside it (`-c:v copy` — lib/ai/ffmpeg-plan.ts). Not one pixel is
      touched. Two results made while the finalizer rewrote the stream's
      colour description came back wrong, and whatever the cause, the rule
      is now simple enough to pin in a test: the picture we store is the
      picture the provider returned.
    */
    let finalFile = outputFile;
    let voiceSwapped = false;
    if (newVoice && !lipSynced && wavPath && meta && ownerId) {
      if (!pathBelongsTo(wavPath, ownerId, jobId)) throw new CrFinalizeFailure("AI_FINALIZATION_FAILED", "the prepared audio path failed ownership", "system");
      const wavFile = path.join(dir, "voice.wav");
      const muxedFile = path.join(dir, "voiced.mp4");
      await downloadToFile(await signSourceUrl(wavPath), wavFile, 200 * 1024 * 1024).catch((e) => {
        throw new CrFinalizeFailure("AI_FINALIZATION_FAILED", `voice download: ${String(e)}`, "system");
      });
      const mux = await restoreOriginalAudio({ cleanedPath: outputFile, sourcePath: wavFile, outPath: muxedFile, hasAudio: true, canCopyVideo: true });
      if (!mux.ok) throw new CrFinalizeFailure("AUDIO_RESTORE_FAILED", `voice mux: ${mux.detail.slice(0, 300)}`, "system");
      const muxProbe = await probeMedia(muxedFile);
      if (!muxProbe?.hasVideo || !muxProbe.hasAudio || !muxProbe.durationSeconds || Math.abs(muxProbe.durationSeconds - probe.durationSeconds) > 1) {
        throw new CrFinalizeFailure("AUDIO_RESTORE_FAILED", "the voiced file did not verify", "system");
      }
      finalFile = muxedFile;
      voiceSwapped = true;
    }
    const colorNote: Record<string, unknown> = { output: await probeColor(outputFile), tagged: false, reencoded: false, voiceSwapped };
    const finalProbe = finalFile === outputFile ? probe : ((await probeMedia(finalFile)) ?? probe);

    let stored: { path: string; bytes: number };
    try {
      stored = await uploadFinalResult({ ownerId, feature: feature.id, jobId, filePath: finalFile });
    } catch (e) {
      throw new CrFinalizeFailure("FINAL_UPLOAD_FAILED", String(e), "system");
    }
    const posterPath = await makeResultPoster({ videoPath: finalFile, dir, ownerId, feature: feature.id, jobId, durationSeconds: finalProbe.durationSeconds });

    const completed = await transitionJob(jobId, ["finalizing"], "completed", {
      result_path: stored.path,
      poster_path: posterPath,
      result_size: stored.bytes,
      result_duration: finalProbe.durationSeconds,
      result_mime_type: "video/mp4",
      audio_restored: audioExpected ? finalProbe.hasAudio : null,
      completed_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
      finalize_lease_until: null,
      finalize_next_at: null,
      finalize_error: null,
      // Fresh metadata (a diagnostic may have landed meanwhile); the provider URL has served its purpose.
      metadata: {
        ...((await getJobAsService(jobId))?.metadata ?? job.metadata ?? {}),
        provider_output_url: null,
        output: { width: finalProbe.width, height: finalProbe.height, durationMs: actualMs, bytes: stored.bytes, hasAudio: finalProbe.hasAudio },
        color: colorNote,
        finalized_ms: Date.now() - startedAt,
      },
    });

    if (completed) {
      // Stage H — the charge is kept: reserved → settled on the product ledger.
      const settled = await settleCharacterReplaceCharge(ownerId, jobId);
      if (!settled) console.error("[cr/finalize] settle found no reserved charge", { jobId, userId: ownerId });
      await recordJobEvent(jobId, "finalize.completed", { attempt, bytes: stored.bytes, durationMs: actualMs, mode: meta?.mode ?? "full_character", stages: pipeline?.stages ?? null, voiceSwapped, settled, elapsedMs: Date.now() - startedAt });
      // 🔴 Only now — the result is in OUR bucket and the row says completed (§11).
      await notifyAiJobFinished({ userId: ownerId, jobId, feature: feature.id, audioRestored: audioExpected ? finalProbe.hasAudio : null, durationMs: Date.now() - startedAt });
    }
    console.info("[cr/finalize] completed", {
      jobId,
      userId: ownerId,
      feature: feature.id,
      predictionId: job.replicate_prediction_id,
      durationMs: actualMs,
      bytes: stored.bytes,
      hasAudio: finalProbe.hasAudio,
      mode: meta?.mode ?? "full_character",
      stages: pipeline?.stages ?? null,
      chargedCents: job.charged_cents,
      pricingVersion: meta?.quote?.pricingConfigVersion ?? null,
      elapsedMs: Date.now() - startedAt,
      transition: "finalizing -> completed",
      settled: !!completed,
      downloadedBytes: bytes,
    });
    return { ok: true, jobId, audioRestored: finalProbe.hasAudio, durationSeconds: finalProbe.durationSeconds ?? probe.durationSeconds, bytes: stored.bytes };
  } catch (e) {
    const failure = e instanceof CrFinalizeFailure ? e : new CrFinalizeFailure("AI_FINALIZATION_FAILED", String(e), "system");
    const transient = isTransientFinalizeFailure(failure.code, failure.detail);
    if (transient && attempt < FINALIZE_MAX_ATTEMPTS) {
      /*
        Keep the provider's success. Release the lease, say when to try again,
        and leave the row in `finalizing` — the sweep and the poll both know
        what a due retry looks like. Nothing is refunded and nobody is told.
      */
      const nextAt = Date.now() + finalizeBackoffMs(attempt);
      const scheduled = await scheduleFinalizationRetry(jobId, { nextAt, error: `${failure.code}: ${failure.detail}` });
      await recordJobEvent(jobId, "finalize.retry_scheduled", { attempt, code: failure.code, nextAt: new Date(nextAt).toISOString(), scheduled });
      console.warn("[cr/finalize] transient failure — retry scheduled", { jobId, attempt, code: failure.code, detail: failure.detail.slice(0, 200), nextAt: new Date(nextAt).toISOString() });
      return { ok: false, jobId, code: failure.code, detail: `retry scheduled: ${failure.detail}` };
    }
    await failFinalize(job, failure, { exhausted: transient });
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

async function failFinalize(job: AiJobRow, failure: CrFinalizeFailure, opts: { exhausted: boolean } = { exhausted: false }): Promise<void> {
  const updated = await transitionJob(job.id, ["finalizing"], "failed", {
    error_code: failure.code,
    error_message: failure.detail.slice(0, 2000),
    completed_at: new Date().toISOString(),
    finalize_lease_until: null,
    finalize_next_at: null,
  });
  await noteJobDiagnostic(job.id, { failure_category: failure.category, failed_in: "finalize" });
  await recordJobEvent(job.id, opts.exhausted ? "finalize.gave_up" : "finalize.failed", { code: failure.code, category: failure.category, attempts: job.finalize_attempts, ended: !!updated });
  const subject = subjectFromRow(job);
  if (updated && subject) {
    // Stage I — refund exactly once (idempotent per job).
    await releaseJobFunding({ job: updated, subject, feature: "ai_character_replace", dailyLimit: 0 });
    await recordJobEvent(job.id, "refund.issued", { reason: failure.code, chargedCents: updated.charged_cents, from: "finalize" });
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
