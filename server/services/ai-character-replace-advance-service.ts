import { mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { readCharacterReplaceMeta, readPipeline } from "@/lib/ai/character-replace/job-meta";
import { isTrustedProviderOutputUrl } from "@/lib/ai/character-replace/model";
import { advance, isProviderStage, nextStage, type PipelineStage } from "@/lib/ai/character-replace/pipeline";
import { aiErrorMessage, type AiErrorCode } from "@/lib/ai/errors";
import { releaseJobFunding } from "@/lib/ai/funding";
import { recordJobEvent } from "@/lib/ai/job-events";
import { aiFeature, type AiJobRow } from "@/lib/ai/jobs";
import { claimAdvance, getJobAsService, noteJobDiagnostic, releaseAdvanceLease, transitionJob, writeProcessingMetadata } from "@/lib/ai/job-store";
import { notifyAiJobFailed } from "@/lib/ai/notify";
import { AI_SOURCE_BUCKET, aiStageKey, pathBelongsTo } from "@/lib/ai/storage";
import { subjectFromRow } from "@/lib/ai/subject";
import { dispatchProviderSubmit } from "@/lib/ai/submit-dispatch";
import { getLandingSettings } from "@/lib/landing/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { prepareReplacementAudio } from "@/server/services/ai-audio-prepare";
import { cleanupFinalizationFiles, downloadToFile, probeMedia } from "@/server/services/ai-finalize-service";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ADVANCE A CHARACTER REPLACE JOB — a finished stage comes home, the next begins
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 6 §9–§10, §16–§18: between the provider stages —
 *
 *     voice (TTS)  →  replace  →  lipsync  →  finalize
 *
 * — the finished stage's output is a TEMPORARY provider URL (§18: "Do not
 * permanently depend on Replicate's temporary output URL"). This service,
 * on the Docker worker, downloads it with a ceiling, validates it for what
 * it is, stores it in OUR private bucket under the job's own folder, moves
 * the pipeline forward with the rule in pipeline.ts, and asks the frontend
 * to submit the next stage (the token lives there).
 *
 *   after `voice`    the generated WAV is validated and FITTED to the video
 *                    (server/services/ai-audio-prepare.ts — the same function
 *                    the prepare service runs for an uploaded voice), so a
 *                    dialogue that cannot fit fails HERE, before the
 *                    replacement is paid for;
 *   after `replace`  the replaced video is probed (a video stream, about the
 *                    priced length) and stored as `replaced.mp4` — the input
 *                    of the lip-sync stage (§10: lips are synced to the NEW
 *                    character, never the original).
 *
 * ── One owner, bounded, idempotent ─────────────────────────────────────────
 *
 * `claimAdvance` is a lease on the row (the finalizer's lease column, null
 * while a job is processing) conditioned on `pipeline.pending_advance` still
 * naming this stage — so two webhook deliveries, or the webhook and the
 * recovery sweep, cannot both download. The metadata write that moves the
 * pipeline is guarded by the stage's own prediction id. A transient failure
 * (our storage, our network) releases the lease and leaves `pending_advance`
 * set: the sweep re-dispatches. A permanent one (the output is not a video,
 * the voice does not fit) ends the job with a refund, once.
 */

export type AdvanceOutcome =
  | { ok: true; jobId: string; from: PipelineStage; to: PipelineStage }
  | { ok: true; jobId: string; skipped: string }
  /** `retry: true` = left for the sweep, lease released; the frontend must not read it as a decline. */
  | { ok: false; jobId: string; code: AdvanceErrorCode; detail: string; retry?: true };

export type AdvanceErrorCode = "ADVANCE_FAILED" | "INVALID_AI_OUTPUT" | "AUDIO_INVALID" | "AUDIO_TOO_LONG" | "AUDIO_TOO_SHORT" | "SUBMIT_FAILED";

const ADVANCE_LEASE_SECONDS = 10 * 60;
/** A 60 s 1080p output from p-video-replace is a few tens of MB; a TTS WAV is a few MB. */
const MAX_STAGE_OUTPUT_BYTES = 500 * 1024 * 1024;

class AdvanceFailure extends Error {
  constructor(
    readonly code: AdvanceErrorCode,
    readonly detail: string,
    /** `transient` = ours, retry; `provider` / `user` = permanent, refund. */
    readonly kind: "transient" | "provider" | "user",
  ) {
    super(detail);
    this.name = "AdvanceFailure";
  }
}

export async function advanceCharacterReplaceJob(jobId: string): Promise<AdvanceOutcome> {
  const startedAt = Date.now();
  const before = await getJobAsService(jobId);
  if (!before) return { ok: false, jobId, code: "ADVANCE_FAILED", detail: "no such job" };
  const feature = aiFeature(before.feature);
  if (!feature || feature.id !== "ai_character_replace") return { ok: true, jobId, skipped: "not a character replace job" };
  if (before.status !== "processing") return { ok: true, jobId, skipped: `status is ${before.status}` };
  const pipeline = readPipeline(before.metadata);
  const stage = pipeline?.pending_advance ?? null;
  if (!pipeline || !stage || !isProviderStage(stage)) return { ok: true, jobId, skipped: "no advance pending" };
  const to = nextStage(pipeline, stage);
  if (!to || !isProviderStage(to)) return { ok: true, jobId, skipped: "the next stage is finalization" };

  const job = await claimAdvance(jobId, stage, { leaseSeconds: ADVANCE_LEASE_SECONDS });
  if (!job) return { ok: true, jobId, skipped: "not claimable (leased, moved on, or no longer pending)" };
  await recordJobEvent(jobId, "advance.claimed", { from: stage, to, predictionId: job.replicate_prediction_id });

  const meta = readCharacterReplaceMeta(job.metadata);
  const current = readPipeline(job.metadata) ?? pipeline;
  const record = current.records[stage];
  const outputUrl = record?.outputUrl ?? (typeof job.metadata?.provider_output_url === "string" ? job.metadata.provider_output_url : null);
  const dir = path.join(tmpdir(), "frenz-ai-cr-adv", jobId.replace(/[^0-9a-fA-F-]/g, ""));
  try {
    if (!meta || !job.user_id) throw new AdvanceFailure("ADVANCE_FAILED", "job has no contract metadata or owner", "provider");
    if (!meta.prepared) throw new AdvanceFailure("ADVANCE_FAILED", "job has no prepared media", "provider");
    if (!outputUrl) throw new AdvanceFailure("INVALID_AI_OUTPUT", "no provider output recorded for this stage", "provider");
    if (!isTrustedProviderOutputUrl(outputUrl)) throw new AdvanceFailure("INVALID_AI_OUTPUT", "provider output is not on a trusted host", "provider");
    if (record?.status !== "succeeded") throw new AdvanceFailure("ADVANCE_FAILED", `stage ${stage} is ${record?.status ?? "missing"}, not succeeded`, "provider");

    await mkdir(dir, { recursive: true });
    const file = path.join(dir, stage === "voice" ? "voice.bin" : "replaced.bin");
    await downloadToFile(outputUrl, file, MAX_STAGE_OUTPUT_BYTES).catch((e) => {
      // A 4xx from the provider's host is permanent (expired, gone); anything else is worth another go.
      const detail = String(e);
      throw new AdvanceFailure("INVALID_AI_OUTPUT", `download: ${detail}`, /download failed: 4\d\d/.test(detail) ? "provider" : "transient");
    });

    let storedPath: string;
    let metadataPatch: Record<string, unknown> = {};

    if (stage === "voice") {
      /* ── the generated voice: validate and FIT it to the video (§4) ──── */
      const settings = await getLandingSettings();
      const audio = settings.frenzAiCharacterReplace.audio;
      const outcome = await prepareReplacementAudio({
        jobId,
        ownerId: job.user_id,
        feature: feature.id,
        inputFile: file,
        dir,
        videoMs: meta.prepared.durationMs,
        policy: { shorterAudio: audio.shorterAudio, minimumCoverageFraction: audio.minimumCoverageFraction, trimToFit: meta.audio?.trimToFit === true },
        limits: { maxDurationMs: Math.max(audio.maximumDurationSeconds * 1000, meta.prepared.durationMs * 2) },
        declared: null,
      });
      if (!outcome.ok) {
        await recordJobEvent(jobId, "audio.rejected", { code: outcome.code, detail: outcome.detail.slice(0, 200), source: "tts" });
        throw new AdvanceFailure(outcome.code, outcome.detail, "user");
      }
      storedPath = outcome.path;
      metadataPatch = {
        audio: {
          ...(meta.audio ?? { source: "tts", trimToFit: false, voiceConsent: false }),
          prepared: {
            path: outcome.path,
            durationMs: outcome.durationMs,
            sampleRate: outcome.sampleRate,
            channels: outcome.channels,
            codec: outcome.codec,
            bitrate: outcome.bitrate,
            bytes: outcome.bytes,
            trimmed: outcome.trimmed,
            padded: outcome.padded,
            transcoded: outcome.transcoded,
          },
        },
      };
      await recordJobEvent(jobId, "audio.prepared", { source: "tts", durationMs: outcome.durationMs, inputDurationMs: outcome.input.durationMs, trimmed: outcome.trimmed, padded: outcome.padded });
    } else {
      /* ── the replaced video: a video stream, about the priced length ─── */
      const probe = await probeMedia(file);
      if (!probe?.hasVideo || !probe.durationSeconds || probe.durationSeconds <= 0) throw new AdvanceFailure("INVALID_AI_OUTPUT", "the replacement output has no readable video stream", "provider");
      const actualMs = Math.round(probe.durationSeconds * 1000);
      const expectedMs = meta.prepared.durationMs;
      if (Math.abs(actualMs - expectedMs) > Math.max(1000, expectedMs * 0.3)) throw new AdvanceFailure("INVALID_AI_OUTPUT", `expected about ${expectedMs} ms, the output is ${actualMs} ms`, "provider");
      const key = aiStageKey(job.user_id, feature.id, jobId, "replace");
      if (!pathBelongsTo(key, job.user_id, jobId)) throw new AdvanceFailure("ADVANCE_FAILED", "refusing a stage path that failed ownership", "provider");
      const body = await readFile(file);
      const up = await createAdminClient().storage.from(AI_SOURCE_BUCKET).upload(key, body, { contentType: "video/mp4", upsert: true });
      if (up.error) throw new AdvanceFailure("ADVANCE_FAILED", `upload failed: ${up.error.message}`, "transient");
      storedPath = key;
      const size = (await stat(file).catch(() => null))?.size ?? body.byteLength;
      metadataPatch = { replaced: { width: probe.width, height: probe.height, durationMs: actualMs, bytes: size, hasAudio: probe.hasAudio } };
    }

    /* ── move the pipeline, release the lease, hand the next stage over ── */
    const fresh = await getJobAsService(jobId);
    const freshPipeline = readPipeline(fresh?.metadata) ?? current;
    const moved = advance(freshPipeline, stage, to, storedPath);
    if (!moved) throw new AdvanceFailure("ADVANCE_FAILED", `illegal advance ${stage} -> ${to} (current ${freshPipeline.current})`, "provider");
    const written = await writeProcessingMetadata(
      jobId,
      job.replicate_prediction_id,
      { ...(fresh?.metadata ?? job.metadata ?? {}), ...metadataPatch, pipeline: moved, provider_output_url: null, advance_dispatch: null, advance_detail: null },
      { finalize_lease_until: null },
    );
    if (!written) return { ok: true, jobId, skipped: "the job moved on while its stage output was being stored" };
    await recordJobEvent(jobId, "advance.completed", { from: stage, to, storedPath: storedPath.split("/").pop(), ms: Date.now() - startedAt });

    const submitted = await dispatchProviderSubmit(jobId);
    if (!submitted.submitted) {
      /*
        A throttle or an out-of-credit answer from the provider (PROVIDER_UNAVAILABLE:
        Replicate limits a low-credit account to a burst of ONE prediction a
        minute, measured 2026-09-14) is a reason to try again in a few minutes,
        not to end a job the member has already paid for. The pipeline is
        already at the next stage with its record `pending`; the recovery pass
        re-submits it. Anything else the frontend refused is permanent.
      */
      const throttled = /PROVIDER_UNAVAILABLE/.test(submitted.detail);
      throw new AdvanceFailure("SUBMIT_FAILED", submitted.detail, throttled ? "transient" : submitted.reason === "refused" ? "provider" : "transient");
    }
    console.info("[cr/advance] advanced", { jobId, userId: job.user_id, from: stage, to, ms: Date.now() - startedAt });
    return { ok: true, jobId, from: stage, to };
  } catch (e) {
    const failure = e instanceof AdvanceFailure ? e : new AdvanceFailure("ADVANCE_FAILED", String(e), "transient");
    if (failure.kind === "transient") {
      // Keep the provider's success; the sweep re-dispatches while `pending_advance` is set (or the next stage is pending).
      await releaseAdvanceLease(jobId);
      await recordJobEvent(jobId, "advance.retry_scheduled", { from: stage, code: failure.code, detail: failure.detail.slice(0, 200) });
      console.warn("[cr/advance] transient failure — left for the sweep", { jobId, from: stage, code: failure.code, detail: failure.detail.slice(0, 200) });
      // `retry: true` is what stops the frontend reading this as a refusal (lib/ai/finalize-dispatch.ts).
      return { ok: false, jobId, retry: true, code: failure.code, detail: `retry left to the sweep: ${failure.detail}` };
    }
    await failAdvance(job, stage, failure);
    return { ok: false, jobId, code: failure.code, detail: failure.detail };
  } finally {
    await cleanupFinalizationFiles(dir);
  }
}

/** End the job honestly and give the money back — once (releaseJobFunding is idempotent per job). */
async function failAdvance(job: AiJobRow, stage: PipelineStage, failure: AdvanceFailure): Promise<void> {
  const updated = await transitionJob(job.id, ["processing"], "failed", {
    error_code: failure.code,
    error_message: failure.detail.slice(0, 2000),
    completed_at: new Date().toISOString(),
    finalize_lease_until: null,
  });
  await noteJobDiagnostic(job.id, { failure_category: failure.kind === "user" ? "user" : "provider", failed_in: `advance:${stage}` });
  await recordJobEvent(job.id, "advance.failed", { from: stage, code: failure.code, kind: failure.kind, ended: !!updated });
  const subject = subjectFromRow(job);
  if (updated && subject) {
    await releaseJobFunding({ job: updated, subject, feature: "ai_character_replace", dailyLimit: 0, cause: "failure" });
    await recordJobEvent(job.id, "refund.issued", { reason: failure.code, chargedCents: updated.charged_cents, from: "advance" });
    if (subject.kind === "user") {
      const code: AiErrorCode =
        failure.code === "AUDIO_INVALID" || failure.code === "AUDIO_TOO_LONG" || failure.code === "AUDIO_TOO_SHORT"
          ? failure.code
          : failure.code === "SUBMIT_FAILED"
            ? "PROVIDER_UNAVAILABLE"
            : "PROCESSING_FAILED";
      await notifyAiJobFailed({ userId: subject.userId, jobId: job.id, feature: "ai_character_replace", message: aiErrorMessage(code), errorCode: failure.code });
    }
  }
  console.error("[cr/advance] failed", { jobId: job.id, userId: job.user_id, from: stage, code: failure.code, kind: failure.kind, detail: failure.detail.slice(0, 300), transition: "processing -> failed", refunded: !!updated });
}
