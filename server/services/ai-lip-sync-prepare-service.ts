import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildPrepareArgs, isKnownPrepareArg, type PreparePlan, type PrepareProfile } from "@/lib/ai/character-replace/ffmpeg";
import { durationWithinTolerance, readProviderPlan } from "@/lib/ai/character-replace/job-meta";
import { aiErrorMessage } from "@/lib/ai/errors";
import { releaseJobFunding } from "@/lib/ai/funding";
import { recordJobEvent } from "@/lib/ai/job-events";
import { getJobAsService, noteJobDiagnostic, transitionJob } from "@/lib/ai/job-store";
import { aiFeature, type AiJobRow } from "@/lib/ai/jobs";
import { readLipSyncMeta, type LipSyncJobMeta } from "@/lib/ai/lip-sync/job-meta";
import { KLING_LIP_SYNC_MODEL } from "@/lib/ai/lip-sync/providers/kling-lipsync";
import { lipSyncAdapterFor } from "@/lib/ai/lip-sync/providers/router";
import { notifyAiJobFailed } from "@/lib/ai/notify";
import { AI_SOURCE_BUCKET, aiPreparedKey, pathBelongsTo } from "@/lib/ai/storage";
import { signSourceUrl } from "@/lib/ai/storage-server";
import { subjectFromRow } from "@/lib/ai/subject";
import { dispatchProviderSubmit } from "@/lib/ai/submit-dispatch";
import { buildTempoArgs, isKnownTempoArg, type TempoPlan } from "@/lib/ai/voice/audio-tempo";
import type { AudioFitPolicy } from "@/lib/ai/voice/audio-validate";
import { ElevenLabsError } from "@/lib/ai/voice/elevenlabs";
import { textToSpeechProviderFor } from "@/lib/ai/voice/tts-provider";
import { getLandingSettings } from "@/lib/landing/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { prepareReplacementAudio, probeAudio } from "@/server/services/ai-audio-prepare";
import { PrepareFailure, runPrepare, type PrepareErrorCode, type PrepareOutcome } from "@/server/services/ai-character-replace-prepare-service";
import { cleanupFinalizationFiles, downloadToFile, probeMedia } from "@/server/services/ai-finalize-service";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PREPARE A LIP SYNC PRO JOB (the worker) — the video, the speech, the fit
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Runs on the ffmpeg worker after /start reserved the funding and claimed the
 * row. The Character Replace prepare service's discipline, for this tool:
 *
 *   1. read the row's contract; the paths must belong to the member
 *   2. download the video (and the audio upload) with their ceilings enforced
 *   3. ffprobe everything — the browser's numbers are never trusted
 *   4. THE SPEECH (§5, §6, §7):
 *        text · native   nothing to make — the model speaks it (Kling)
 *        text · tts      ElevenLabs makes the speech here, at the chosen
 *                        speed (ffmpeg atempo, pitch kept), then the fit
 *        audio           the upload is the authoritative track (§6): never
 *                        re-voiced, converted to WAV only when the provider
 *                        needs it, then the fit
 *      THE FIT is the operator's duration policy, applied to MEASURED
 *      lengths: trim the video to the audio, trim the audio to the video,
 *      loop (a provider sync mode), reject a significant mismatch, or leave
 *      the residual to the provider's sync mode. Never a silent surprise —
 *      what was decided is written on the row (`duration_note`).
 *   5. cut and normalise the video (the Kling profile for Kling Lip Sync:
 *      720–1920 px), probe the result, refuse a length that is not what was
 *      priced (a refund, never a silent re-price)
 *   6. store beside the inputs, record the facts, ask the frontend to submit
 *
 * Every failure ends the job with a code and REFUNDS through
 * `releaseJobFunding` (idempotent per job).
 */
const MAX_PREPARED_BYTES = 400 * 1024 * 1024;
const MAX_SOURCE_DURATION_MS = 30 * 60 * 1000;

export async function prepareLipSyncJob(jobId: string): Promise<PrepareOutcome> {
  const startedAt = Date.now();
  const feature = aiFeature("ai_lip_sync")!;
  const dir = path.join(tmpdir(), "frenz-ai-lipsync", jobId.replace(/[^0-9a-fA-F-]/g, ""));
  let job: AiJobRow | null = null;
  try {
    job = await getJobAsService(jobId);
    if (!job) return { ok: false, jobId, code: "PREPARATION_FAILED", detail: "job not found" };
    if (job.feature !== feature.id) return { ok: false, jobId, code: "PREPARATION_FAILED", detail: "not a lip sync job" };
    if (job.status !== "acquiring") return { ok: true, jobId, skipped: `status is ${job.status}` };
    const meta = readLipSyncMeta(job.metadata);
    if (!meta) throw new PrepareFailure("PREPARATION_FAILED", "job metadata is not a lip sync contract", "system");
    if (!job.user_id) throw new PrepareFailure("PREPARATION_FAILED", "job has no owner", "system");
    if (!meta.quote) throw new PrepareFailure("PREPARATION_FAILED", "job has no pricing snapshot", "system");
    const quotedMs = Number((meta.quote as { durationMs?: unknown }).durationMs);
    if (!Number.isFinite(quotedMs) || quotedMs <= 0) throw new PrepareFailure("PREPARATION_FAILED", "the quote has no length", "system");
    await recordJobEvent(job.id, "prepare.started", { source: meta.speech.source });

    const audioUploadPath = meta.speech.source === "audio" ? meta.speech.upload.path : null;
    for (const p of [meta.video.path, ...(audioUploadPath ? [audioUploadPath] : [])]) {
      if (!pathBelongsTo(p, job.user_id, job.id)) throw new PrepareFailure("PREPARATION_FAILED", "an input path failed ownership", "system");
    }

    const settings = await getLandingSettings();
    const config = settings.frenzAiLipSync;
    const plan = readProviderPlan(job.metadata);
    const vendor = plan?.id ?? "replicate";
    const model = plan?.model || config.models[vendor].model;
    const adapter = lipSyncAdapterFor(vendor, model, settings.frenzAiProviders);
    if (!adapter) throw new PrepareFailure("PREPARATION_FAILED", `no adapter for ${model} on ${vendor}`, "system");
    const speechPath: "native" | "tts" | "audio" = meta.speech.source === "audio" ? "audio" : (plan as { speechPath?: unknown } | null)?.speechPath === "native" || meta.speech.path === "native" ? "native" : "tts";
    const caps = adapter.capabilities;

    /* ── 2. the bytes ─────────────────────────────────────────────────────── */
    await mkdir(dir, { recursive: true });
    const videoFile = path.join(dir, "source.bin");
    const audioFile = path.join(dir, "voice.bin");
    const preparedFile = path.join(dir, "prepared.mp4");
    const videoUrl = await signSourceUrl(meta.video.path);
    const videoBytes = await downloadToFile(videoUrl, videoFile, Math.min(feature.maxBytes, config.video.maximumUploadBytes)).catch((e) => {
      throw new PrepareFailure("FILE_TOO_LARGE", `video: ${String(e)}`);
    });

    /* ── 3. measure ───────────────────────────────────────────────────────── */
    const videoProbe = await probeMedia(videoFile);
    if (!videoProbe?.hasVideo || !videoProbe.durationSeconds || videoProbe.durationSeconds <= 0) throw new PrepareFailure("UNSUPPORTED_SOURCE", "the source has no readable video stream");
    const sourceMs = Math.round(videoProbe.durationSeconds * 1000);
    if (sourceMs > MAX_SOURCE_DURATION_MS) throw new PrepareFailure("UNSUPPORTED_SOURCE", `${sourceMs} ms is longer than the platform takes`);
    if ((videoProbe.width ?? 0) * (videoProbe.height ?? 0) > config.video.maximumPixels) throw new PrepareFailure("UNSUPPORTED_SOURCE", `${videoProbe.width}x${videoProbe.height} exceeds the pixel ceiling`);
    const range = {
      startMs: meta.trim ? Math.max(0, Math.min(sourceMs, meta.trim.startMs)) : 0,
      endMs: meta.trim ? Math.max(0, Math.min(sourceMs, meta.trim.endMs)) : sourceMs,
    };
    let keptMs = range.endMs - range.startMs;
    if (keptMs <= 0) throw new PrepareFailure("INVALID_INPUT", "the kept range is empty");
    if (!durationWithinTolerance(quotedMs, keptMs)) throw new PrepareFailure("DURATION_MISMATCH", `priced ${quotedMs} ms, the file holds ${keptMs} ms`);

    /* ── 4. the speech, and the fit (§5–§7) ───────────────────────────────── */
    let audioPrepared: NonNullable<LipSyncJobMeta["audio"]>["prepared"] = null;
    let synthesized: NonNullable<LipSyncJobMeta["audio"]>["synthesized"] = null;
    let durationNote: string | null = null;
    let videoEndMs = range.endMs;
    const policy = meta.settings.durationPolicy;
    const canSyncMode = caps.supports_duration_control;
    if (speechPath !== "native") {
      // the audio on disk: the member's upload, or the voice provider's speech
      let inputFile = audioFile;
      let declared: { name: string; type: string } | null = null;
      if (speechPath === "audio" && meta.speech.source === "audio") {
        await downloadToFile(await signSourceUrl(meta.speech.upload.path), audioFile, config.audioMode.maximumUploadBytes).catch((e) => {
          throw new PrepareFailure("AUDIO_INVALID", `audio: ${String(e)}`);
        });
        declared = { name: meta.speech.upload.name, type: meta.speech.upload.mime };
      } else if (meta.speech.source === "text") {
        const tts = textToSpeechProviderFor(config.tts.model);
        if (tts.runsIn !== "worker") throw new PrepareFailure("PREPARATION_FAILED", `text-to-speech model ${config.tts.model} does not run on the worker`, "system");
        if (!tts.isConfigured()) throw new PrepareFailure("PREPARATION_FAILED", `text-to-speech model ${config.tts.model} is not configured on the worker`, "system");
        const ttsFile = path.join(dir, "voice-tts.bin");
        let made: { bytes: Buffer; mime: string };
        try {
          made = await tts.synthesize({ jobId: job.id, text: meta.speech.text, languageCode: meta.speech.languageCode ?? "en", providerVoiceId: meta.speech.providerVoiceId });
        } catch (e) {
          await recordJobEvent(job.id, "audio.rejected", { code: "TTS_FAILED", detail: String(e).slice(0, 200), source: "tts", provider: tts.id });
          const userSide = e instanceof ElevenLabsError && e.kind === "input";
          throw new PrepareFailure(userSide ? "AUDIO_INVALID" : "PREPARATION_FAILED", `text-to-speech: ${String(e)}`, userSide ? "user" : "system");
        }
        await writeFile(ttsFile, made.bytes);
        synthesized = { provider: tts.id, model: config.tts.model, bytes: made.bytes.byteLength, durationMs: 0 };
        inputFile = ttsFile;
        // the speaking speed (§1): the provider's natural pace re-timed, pitch kept
        const speed = Math.round(meta.speech.speed * 100) / 100;
        if (Math.abs(speed - 1) >= 0.01) {
          const tempoOut = path.join(dir, "voice-tempo.wav");
          const tempo: TempoPlan = { input: ttsFile, output: tempoOut, speed };
          const args = buildTempoArgs(tempo);
          for (const arg of args) if (!isKnownTempoArg(arg, tempo)) throw new PrepareFailure("PREPARATION_FAILED", "refusing an unknown ffmpeg argument", "system");
          const ran = await runPrepare(args);
          if (!ran.ok) throw new PrepareFailure("PREPARATION_FAILED", `tempo: ${ran.detail.slice(0, 300)}`, "system");
          inputFile = tempoOut;
        }
      }
      // the measured lengths decide (§7)
      const probe = await probeAudio(inputFile);
      const audioMs = Math.round((probe?.durationSeconds ?? 0) * 1000);
      if (!probe?.hasAudio || audioMs <= 0) throw new PrepareFailure("AUDIO_INVALID", "the audio has no readable stream");
      if (audioMs > config.audioMode.maximumDurationSeconds * 1000) throw new PrepareFailure("AUDIO_TOO_LONG", `${audioMs} ms is over the audio ceiling`);
      const mismatch = Math.abs(audioMs - keptMs) / keptMs;
      const significant = mismatch > config.duration.significantMismatchFraction;
      let fit: AudioFitPolicy;
      if (policy === "reject" && significant) {
        throw new PrepareFailure(audioMs > keptMs ? "AUDIO_TOO_LONG" : "AUDIO_TOO_SHORT", `audio ${audioMs} ms vs video ${keptMs} ms — the operator's policy refuses a mismatch over ${Math.round(config.duration.significantMismatchFraction * 100)}%`);
      } else if (policy === "trim_video_to_audio" && audioMs < keptMs - 500) {
        // the video is cut to the speech; the audio stays whole
        videoEndMs = range.startMs + audioMs;
        keptMs = audioMs;
        durationNote = `The video was shortened to the ${(audioMs / 1000).toFixed(1)} s of speech.`;
        fit = { shorterAudio: "silence", minimumCoverageFraction: 0, trimToFit: true };
      } else if (policy === "loop_audio" && canSyncMode && audioMs < keptMs) {
        durationNote = `The speech (${(audioMs / 1000).toFixed(1)} s) is looped over the ${(keptMs / 1000).toFixed(1)} s video.`;
        fit = { shorterAudio: "keep", minimumCoverageFraction: 0, trimToFit: true };
      } else if (policy === "provider_sync_mode" && canSyncMode && audioMs < keptMs) {
        durationNote = `The speech (${(audioMs / 1000).toFixed(1)} s) is shorter than the video; the rest ${config.duration.providerSyncMode === "silence" ? "stays silent" : config.duration.providerSyncMode === "loop" ? "loops the speech" : "bounces the speech"}.`;
        fit = { shorterAudio: "keep", minimumCoverageFraction: 0, trimToFit: true };
      } else {
        // trim_audio_to_video, and every case a provider without sync modes needs: longer audio is cut, shorter is padded with silence
        if (audioMs > keptMs + 500) durationNote = `The audio (${(audioMs / 1000).toFixed(1)} s) was cut to the ${(keptMs / 1000).toFixed(1)} s video.`;
        else if (audioMs < keptMs - 500) durationNote = `The speech (${(audioMs / 1000).toFixed(1)} s) is shorter than the video; the rest stays silent.`;
        fit = { shorterAudio: "silence", minimumCoverageFraction: 0, trimToFit: true };
      }
      if (significant && !durationNote) durationNote = `The audio (${(audioMs / 1000).toFixed(1)} s) and the video (${(keptMs / 1000).toFixed(1)} s) differ in length.`;
      const outcome = await prepareReplacementAudio({
        jobId: job.id,
        ownerId: job.user_id,
        feature: feature.id,
        inputFile,
        dir,
        videoMs: keptMs,
        policy: fit,
        limits: { maxDurationMs: Math.max(config.audioMode.maximumDurationSeconds * 1000, keptMs * 2) },
        declared,
      });
      if (!outcome.ok) {
        await recordJobEvent(job.id, "audio.rejected", { code: outcome.code, detail: outcome.detail.slice(0, 200), source: speechPath });
        throw new PrepareFailure(outcome.code as PrepareErrorCode, outcome.detail);
      }
      if (caps.audio.maxBytes && outcome.bytes > caps.audio.maxBytes) throw new PrepareFailure("AUDIO_TOO_LONG", `the prepared audio is ${outcome.bytes} bytes; the model takes up to ${caps.audio.maxBytes}`);
      audioPrepared = { path: outcome.path, durationMs: outcome.durationMs, bytes: outcome.bytes, mime: "audio/wav", sampleRate: outcome.sampleRate, channels: outcome.channels, trimmed: outcome.trimmed, padded: outcome.padded, transcoded: outcome.transcoded, origin: speechPath === "audio" ? "upload" : "tts", speedApplied: speechPath === "tts" && meta.speech.source === "text" ? meta.speech.speed : null };
      if (synthesized) synthesized = { ...synthesized, durationMs: outcome.input.durationMs };
      await recordJobEvent(job.id, "audio.prepared", { source: speechPath, durationMs: outcome.durationMs, inputDurationMs: outcome.input.durationMs, trimmed: outcome.trimmed, padded: outcome.padded, policy, note: durationNote });
    }

    /* ── 5. cut and normalise the video ───────────────────────────────────── */
    const profile: PrepareProfile = adapter.model === KLING_LIP_SYNC_MODEL ? "kling_lipsync" : "default";
    const trimmed = range.startMs > 0 || videoEndMs < sourceMs;
    const vplan: PreparePlan = { input: videoFile, output: preparedFile, startMs: range.startMs, endMs: trimmed ? videoEndMs : null, profile };
    const args = buildPrepareArgs(vplan);
    for (const arg of args) if (!isKnownPrepareArg(arg, vplan)) throw new PrepareFailure("PREPARATION_FAILED", "refusing an unknown ffmpeg argument", "system");
    const cut = await runPrepare(args);
    if (!cut.ok) throw new PrepareFailure("PREPARATION_FAILED", cut.detail || "ffmpeg failed", "system");
    const preparedStat = await stat(preparedFile).catch(() => null);
    if (!preparedStat || preparedStat.size <= 0) throw new PrepareFailure("PREPARATION_FAILED", "ffmpeg wrote nothing", "system");
    if (preparedStat.size > MAX_PREPARED_BYTES) throw new PrepareFailure("FILE_TOO_LARGE", `prepared file is ${preparedStat.size} bytes`);
    if (caps.video.maxBytes && preparedStat.size > caps.video.maxBytes) throw new PrepareFailure("FILE_TOO_LARGE", `the prepared video is ${preparedStat.size} bytes; the model takes up to ${caps.video.maxBytes}`);
    const preparedProbe = await probeMedia(preparedFile);
    if (!preparedProbe?.hasVideo || !preparedProbe.durationSeconds) throw new PrepareFailure("PREPARATION_FAILED", "the prepared file has no video stream", "system");
    const preparedMs = Math.round(preparedProbe.durationSeconds * 1000);
    if (!durationWithinTolerance(keptMs, preparedMs)) throw new PrepareFailure("DURATION_MISMATCH", `kept ${keptMs} ms, prepared ${preparedMs} ms`);
    const pw = preparedProbe.width ?? 0;
    const ph = preparedProbe.height ?? 0;
    if (caps.video.minDurationMs && preparedMs < caps.video.minDurationMs) throw new PrepareFailure("INVALID_INPUT", `${preparedMs} ms is under the model's ${caps.video.minDurationMs} ms minimum`);
    if (caps.video.maxDurationMs && preparedMs > caps.video.maxDurationMs) throw new PrepareFailure("INVALID_INPUT", `${preparedMs} ms is over the model's ${caps.video.maxDurationMs} ms maximum`);
    if (caps.video.minEdgePx && Math.min(pw, ph) < caps.video.minEdgePx) throw new PrepareFailure("UNSUPPORTED_SOURCE", `${pw}x${ph} is under the model's ${caps.video.minEdgePx} px minimum edge`);
    if (caps.video.maxEdgePx && Math.max(pw, ph) > caps.video.maxEdgePx) throw new PrepareFailure("UNSUPPORTED_SOURCE", `${pw}x${ph} is over the model's ${caps.video.maxEdgePx} px maximum edge`);

    /* ── 6. store, record, hand to the provider ───────────────────────────── */
    const key = aiPreparedKey(job.user_id, feature.id, job.id);
    if (!pathBelongsTo(key, job.user_id, job.id)) throw new PrepareFailure("PREPARATION_FAILED", "refusing a prepared path that failed ownership", "system");
    const up = await createAdminClient().storage.from(AI_SOURCE_BUCKET).upload(key, await readFile(preparedFile), { contentType: "video/mp4", upsert: true });
    if (up.error) throw new PrepareFailure("PREPARATION_FAILED", `upload failed: ${up.error.message}`, "system");
    const fresh = await getJobAsService(job.id);
    await createAdminClient()
      .from("ai_jobs")
      .update({
        source_duration: preparedMs / 1000,
        source_size: videoBytes,
        metadata: {
          ...(fresh?.metadata ?? job.metadata ?? {}),
          video: { ...meta.video, size: videoBytes, durationMs: sourceMs, width: videoProbe.width ?? meta.video.width, height: videoProbe.height ?? meta.video.height, hasAudio: videoProbe.hasAudio },
          audio: speechPath === "native" ? null : { prepared: audioPrepared, synthesized },
          prepared: { path: key, durationMs: preparedMs, width: pw || meta.video.width, height: ph || meta.video.height, hasAudio: preparedProbe.hasAudio, bytes: preparedStat.size, trimmed, fps: preparedProbe.frameRate ?? null, profile },
          duration_note: durationNote,
          prepared_ms: Date.now() - startedAt,
        },
      })
      .eq("id", job.id)
      .eq("status", "acquiring");
    console.info("[lipsync/prepare] prepared", { jobId: job.id, userId: job.user_id, sourceMs, preparedMs, trimmed, bytes: preparedStat.size, speech: speechPath, audioMs: audioPrepared?.durationMs ?? null, policy, note: durationNote, ms: Date.now() - startedAt });

    const submitted = await dispatchProviderSubmit(job.id);
    if (!submitted.submitted) throw new PrepareFailure("SUBMIT_FAILED", submitted.detail, "system");
    return { ok: true, jobId: job.id, durationMs: preparedMs, trimmed, bytes: preparedStat.size };
  } catch (e) {
    const failure = e instanceof PrepareFailure ? e : new PrepareFailure("PREPARATION_FAILED", String(e), "system");
    if (job) await failLipSyncPrepare(job, failure);
    return { ok: false, jobId, code: failure.code, detail: failure.detail };
  } finally {
    await cleanupFinalizationFiles(dir);
  }
}

async function failLipSyncPrepare(job: AiJobRow, failure: PrepareFailure): Promise<void> {
  const updated = await transitionJob(job.id, ["acquiring"], "failed", { error_code: failure.code, error_message: failure.detail.slice(0, 2000), completed_at: new Date().toISOString() });
  await noteJobDiagnostic(job.id, { failure_category: failure.category, failed_in: "prepare" });
  await recordJobEvent(job.id, "prepare.failed", { code: failure.code, category: failure.category, ended: !!updated });
  const subject = subjectFromRow(job);
  if (updated && subject) {
    await releaseJobFunding({ job: updated, subject, feature: "ai_lip_sync", dailyLimit: 0, cause: "failure" });
    await recordJobEvent(job.id, "refund.issued", { reason: failure.code, chargedCents: updated.charged_cents, from: "prepare" });
    if (subject.kind === "user") {
      await notifyAiJobFailed({
        userId: subject.userId,
        jobId: job.id,
        feature: "ai_lip_sync",
        message: aiErrorMessage(failure.code === "DURATION_MISMATCH" ? "DURATION_MISMATCH" : failure.code === "SUBMIT_FAILED" ? "PROVIDER_UNAVAILABLE" : failure.code === "AUDIO_INVALID" || failure.code === "AUDIO_TOO_LONG" || failure.code === "AUDIO_TOO_SHORT" ? failure.code : "PREPARATION_FAILED"),
        errorCode: failure.code,
      });
    }
  }
  console.error("[lipsync/prepare] failed", { jobId: job.id, userId: job.user_id, code: failure.code, category: failure.category, detail: failure.detail.slice(0, 300), refunded: !!updated });
}
