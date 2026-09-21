import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildPrepareArgs, isKnownPrepareArg, klingFrameRate, type PreparePlan } from "@/lib/ai/character-replace/ffmpeg";
import { readProviderPlan } from "@/lib/ai/character-replace/job-meta";
import { applyProviderRoutes } from "@/lib/ai/providers/resolve";
import { validateKlingElementImage, validateKlingInputFacts } from "@/lib/ai/character-replace/providers/kling-input";
import { durationWithinTolerance, readCharacterReplaceMeta, referencePaths, selectedRangeOf, type CharacterReplaceJobMeta } from "@/lib/ai/character-replace/job-meta";
import { buildReferenceImageArgs, isKnownReferenceImageArg, type ReferenceImagePlan } from "@/lib/ai/character-replace/ffmpeg";
import { modeConfig, publicCharacterReplaceConfig } from "@/lib/ai/character-replace/config";
import { characterReplaceLimits, validatePhotoFraming } from "@/lib/ai/character-replace/validate";
import { prepareReplacementAudio } from "@/server/services/ai-audio-prepare";
import { ElevenLabsError } from "@/lib/ai/voice/elevenlabs";
import { textToSpeechProviderFor } from "@/lib/ai/voice/tts-provider";
import { voiceChangeProviderFor } from "@/lib/ai/voice/voice-change-provider";
import { aiErrorMessage } from "@/lib/ai/errors";
import { releaseJobFunding } from "@/lib/ai/funding";
import { recordJobEvent } from "@/lib/ai/job-events";
import { probeColor } from "@/server/services/ai-color-probe";
import { aiFeature, type AiJobRow } from "@/lib/ai/jobs";
import { getJobAsService, noteJobDiagnostic, transitionJob } from "@/lib/ai/job-store";
import { AI_IMAGE_MAX_BYTES } from "@/lib/ai/media";
import { notifyAiJobFailed } from "@/lib/ai/notify";
import { AI_SOURCE_BUCKET, aiPreparedKey, aiPreparedReferenceKey, pathBelongsTo } from "@/lib/ai/storage";
import { signSourceUrl } from "@/lib/ai/storage-server";
import { subjectFromRow } from "@/lib/ai/subject";
import { dispatchProviderSubmit } from "@/lib/ai/submit-dispatch";
import { aiCurrencySymbol, getLandingSettings } from "@/lib/landing/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanupFinalizationFiles, downloadToFile, probeMedia } from "@/server/services/ai-finalize-service";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PREPARE A CHARACTER REPLACE JOB — the trim happens HERE, on the worker
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 4, §5): "The backend must actually produce/use the
 * trimmed video before sending it to Replicate. Do NOT merely change the
 * displayed duration. The billed duration and actual processing duration
 * must match. The authoritative duration should come from the server-side
 * processed media."
 *
 * Runs on the Docker worker (ffmpeg, a real filesystem, minutes of runtime)
 * after /start has reserved the charge and moved the job to `acquiring` —
 * the status that already means "our worker is producing the bytes the
 * provider will receive". The same seam the link path uses; nothing new.
 *
 *   1. read the row; refuse anything not `acquiring` (the claim IS /start's
 *      compare-and-set — a duplicate dispatch finds nothing to do);
 *   2. download BOTH inputs from the private bucket (size ceilings enforced
 *      while the bytes arrive, never trusted from headers);
 *   3. ffprobe both. The video's real duration, size and audio; the image's
 *      decodability and dimensions. What the browser said is replaced by
 *      what is measured (§4);
 *   4. cut and normalise with ffmpeg (a fixed argument array —
 *      lib/ai/character-replace/ffmpeg.ts — proven element by element before
 *      it is spawned);
 *   5. probe the RESULT, and refuse the job if its duration is not the
 *      duration that was priced — a refund, not a silent re-price;
 *   6. upload `prepared.mp4` beside the inputs, record the facts on the row,
 *      and ask the frontend to create the prediction
 *      (dispatchProviderSubmit → /api/internal/ai/submit → the provider).
 *
 * Every failure ends the job with a code and REFUNDS the reservation through
 * `releaseJobFunding`, which is idempotent per job — so a retry of this
 * service after a crash can never refund twice, and a job never sits in
 * `acquiring` holding a member's money.
 */

export type PrepareErrorCode =
  | "PREPARATION_FAILED"
  | "UNSUPPORTED_SOURCE"
  | "FILE_TOO_LARGE"
  | "DURATION_MISMATCH"
  | "INVALID_INPUT"
  | "SUBMIT_FAILED"
  /* Part 6: the member's replacement audio did not pass (server/services/ai-audio-prepare.ts) */
  | "AUDIO_INVALID"
  | "AUDIO_TOO_LONG"
  | "AUDIO_TOO_SHORT";

export type PrepareOutcome =
  | { ok: true; jobId: string; durationMs: number; trimmed: boolean; bytes: number }
  | { ok: true; jobId: string; skipped: string }
  | { ok: false; jobId: string; code: PrepareErrorCode; detail: string };

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFMPEG_IDLE_TIMEOUT_MS = Number(process.env.AI_FFMPEG_IDLE_TIMEOUT_MS || 120_000);
const FFMPEG_HARD_TIMEOUT_MS = Number(process.env.AI_FFMPEG_HARD_TIMEOUT_MS || 20 * 60_000);
/** A source may be long — the member keeps a slice of it — but not without limit. */
const MAX_SOURCE_DURATION_MS = 30 * 60 * 1000;
/** The prepared file: a 60 s 1080p h264 at CRF 20 is tens of MB; this is a ceiling, not a target. */
const MAX_PREPARED_BYTES = 400 * 1024 * 1024;

class PrepareFailure extends Error {
  constructor(
    readonly code: PrepareErrorCode,
    readonly detail: string,
    readonly category: "user" | "system" = "user",
  ) {
    super(detail);
    this.name = "PrepareFailure";
  }
}

export async function prepareCharacterReplaceJob(jobId: string): Promise<PrepareOutcome> {
  const startedAt = Date.now();
  const dir = path.join(tmpdir(), "frenz-ai-cr", jobId.replace(/[^0-9a-fA-F-]/g, ""));
  let job: AiJobRow | null = null;
  let meta: CharacterReplaceJobMeta | null = null;
  try {
    job = await getJobAsService(jobId);
    if (!job) return { ok: false, jobId, code: "PREPARATION_FAILED", detail: "job not found" };
    const feature = aiFeature(job.feature);
    if (!feature || feature.id !== "ai_character_replace") return { ok: true, jobId, skipped: "not a character replace job" };
    if (job.status !== "acquiring") return { ok: true, jobId, skipped: `status is ${job.status}` };
    meta = readCharacterReplaceMeta(job.metadata);
    if (!meta) throw new PrepareFailure("PREPARATION_FAILED", "job metadata is not a character replace contract", "system");
    if (!job.user_id) throw new PrepareFailure("PREPARATION_FAILED", "job has no owner", "system");
    if (!meta.quote) throw new PrepareFailure("PREPARATION_FAILED", "job has no pricing snapshot", "system");

    // 🔴 Ownership of EVERY input path, from the ROW, before any becomes a URL (Part 6: up to three references, and the audio).
    const refPaths = referencePaths(meta);
    const audioPath = meta.audio?.source === "upload" ? (meta.audio.upload?.path ?? null) : null;
    for (const p of [meta.video.path, ...refPaths, ...(audioPath ? [audioPath] : [])]) {
      if (!pathBelongsTo(p, job.user_id, job.id)) throw new PrepareFailure("PREPARATION_FAILED", "an input path failed ownership", "system");
    }
    if (meta.audio?.source === "upload" && !audioPath) throw new PrepareFailure("PREPARATION_FAILED", "an uploaded voice was chosen but no audio was recorded", "system");

    const settings = await getLandingSettings();
    const crConfig = settings.frenzAiCharacterReplace;
    // The same ceilings the browser and /start applied, from the same source — the MODE's own (Part 6).
    const mode = modeConfig(crConfig, meta.mode);
    const limits = characterReplaceLimits(
      applyProviderRoutes(publicCharacterReplaceConfig(crConfig, { code: settings.frenzAiCurrency, symbol: aiCurrencySymbol(settings.frenzAiCurrency) }, true), crConfig, settings.frenzAiProviders),
      meta.mode,
    );

    await mkdir(dir, { recursive: true });
    const videoFile = path.join(dir, "source.bin");
    const imageFiles = refPaths.map((_, i) => path.join(dir, `character-${i + 1}.bin`));
    const audioFile = path.join(dir, "voice.bin");
    const preparedFile = path.join(dir, "prepared.mp4");

    const [videoUrl, ...imageUrls] = await Promise.all([signSourceUrl(meta.video.path), ...refPaths.map((p) => signSourceUrl(p))]);
    const [videoBytes, ...imageByteCounts] = await Promise.all([
      downloadToFile(videoUrl, videoFile, Math.min(feature.maxBytes, mode.maximumUploadBytes)).catch((e) => {
        throw new PrepareFailure("FILE_TOO_LARGE", `video: ${String(e)}`);
      }),
      ...imageUrls.map((u, i) =>
        downloadToFile(u, imageFiles[i]!, AI_IMAGE_MAX_BYTES).catch((e) => {
          throw new PrepareFailure("FILE_TOO_LARGE", `image ${i + 1}: ${String(e)}`);
        }),
      ),
    ]);
    const imageBytes = imageByteCounts[0] ?? 0;

    /* ── 3. measure, never trust ─────────────────────────────────────────── */
    const [videoProbe, ...imageProbes] = await Promise.all([probeMedia(videoFile), ...imageFiles.map((f) => probeMedia(f))]);
    const imageProbe = imageProbes[0] ?? null;
    if (!videoProbe?.hasVideo || !videoProbe.durationSeconds || videoProbe.durationSeconds <= 0) {
      throw new PrepareFailure("UNSUPPORTED_SOURCE", "the video has no readable video stream");
    }
    const sourceMs = Math.round(videoProbe.durationSeconds * 1000);
    if (sourceMs > MAX_SOURCE_DURATION_MS) throw new PrepareFailure("UNSUPPORTED_SOURCE", `source is ${sourceMs} ms long`);
    const pixels = (videoProbe.width ?? 0) * (videoProbe.height ?? 0);
    if (pixels > limits.video.maxPixels) throw new PrepareFailure("UNSUPPORTED_SOURCE", `${videoProbe.width}x${videoProbe.height} exceeds the pixel ceiling`);
    if (Math.min(videoProbe.width ?? 0, videoProbe.height ?? 0) < limits.video.minEdge) {
      throw new PrepareFailure("UNSUPPORTED_SOURCE", `${videoProbe.width}x${videoProbe.height} is below the minimum edge`);
    }
    imageProbes.forEach((probe, i) => {
      if (!probe || !probe.width || !probe.height) throw new PrepareFailure("INVALID_INPUT", `reference image ${i + 1} could not be decoded`);
      if (Math.min(probe.width, probe.height) < limits.photo.minEdge) throw new PrepareFailure("INVALID_INPUT", `reference image ${i + 1} is ${probe.width}x${probe.height}, too small`);
      // 2026-09-20 (brief §3, §14): the DECODED shape against the scope — a landscape photo cannot hold a standing person; refused before any provider call, refunded
      const framing = validatePhotoFraming({ width: probe.width, height: probe.height }, mode.mode);
      if (!framing.ok) throw new PrepareFailure("INVALID_INPUT", `reference image ${i + 1} is ${probe.width}x${probe.height}: ${framing.code} for ${mode.mode}`);
    });
    if (!imageProbe || !imageProbe.width || !imageProbe.height) throw new PrepareFailure("INVALID_INPUT", "the character image could not be decoded");

    /* ── the kept range, against the REAL duration ───────────────────────── */
    const range = selectedRangeOf({ video: { ...meta.video, durationMs: sourceMs }, trim: meta.trim });
    if (range.durationMs < limits.video.minDurationMs) throw new PrepareFailure("INVALID_INPUT", `kept range ${range.durationMs} ms is below the minimum`);
    if (range.durationMs > limits.video.maxDurationMs) throw new PrepareFailure("INVALID_INPUT", `kept range ${range.durationMs} ms is over the ceiling`);
    if (!durationWithinTolerance(meta.quote.durationMs, range.durationMs)) {
      throw new PrepareFailure("DURATION_MISMATCH", `priced ${meta.quote.durationMs} ms, the file holds ${range.durationMs} ms`);
    }

    /* ── 4. cut and normalise ────────────────────────────────────────────── */
    const trimmed = range.startMs > 0 || range.endMs < sourceMs;
    /*
      🔴 THE TRIM AND THE SIZE, NOTHING ELSE (owner, 2026-09-14: "the result
      and filter should be purely natural from replicate"). The colour probe
      is recorded on the row as a diagnostic and changes nothing about the
      file the model receives — see lib/ai/character-replace/ffmpeg.ts.
    */
    const color = await probeColor(videoFile);
    /*
      2026-09-21: the geometry the ROW's provider needs. A job the router sent
      to fal.ai (Kling O1 Video Edit) gets the Kling profile — both edges ≥
      720, long edge ≤ 2160, 24–60 fps; everything else is the plan Part 4
      shipped. Decided by the plan written at Start, never by today's switch.
    */
    const providerPlan = readProviderPlan(job.metadata);
    const profile: NonNullable<PreparePlan["profile"]> = providerPlan?.id === "fal" ? "kling" : "default";
    const plan: PreparePlan = { input: videoFile, output: preparedFile, startMs: range.startMs, endMs: trimmed ? range.endMs : null, profile, ...(profile === "kling" ? { frameRate: klingFrameRate(videoProbe.frameRate) } : {}) };
    const args = buildPrepareArgs(plan);
    for (const arg of args) {
      if (!isKnownPrepareArg(arg, plan)) throw new PrepareFailure("PREPARATION_FAILED", `refusing an unknown ffmpeg argument`, "system");
    }
    const cut = await runPrepare(args);
    if (!cut.ok) throw new PrepareFailure("PREPARATION_FAILED", cut.detail || "ffmpeg failed", "system");

    /* ── 5. the result is what was priced, or nothing ────────────────────── */
    const preparedStat = await stat(preparedFile).catch(() => null);
    if (!preparedStat || preparedStat.size <= 0) throw new PrepareFailure("PREPARATION_FAILED", "ffmpeg wrote nothing", "system");
    if (preparedStat.size > MAX_PREPARED_BYTES) throw new PrepareFailure("FILE_TOO_LARGE", `prepared file is ${preparedStat.size} bytes`);
    const preparedProbe = await probeMedia(preparedFile);
    if (!preparedProbe?.hasVideo || !preparedProbe.durationSeconds) throw new PrepareFailure("PREPARATION_FAILED", "the prepared file has no video stream", "system");
    const preparedMs = Math.round(preparedProbe.durationSeconds * 1000);
    if (!durationWithinTolerance(meta.quote.durationMs, preparedMs)) {
      throw new PrepareFailure("DURATION_MISMATCH", `priced ${meta.quote.durationMs} ms, prepared ${preparedMs} ms`);
    }
    if (profile === "kling") {
      // §5: the file the model will receive, against every documented limit — a violation ends the job here (refunded), nothing is submitted.
      const verdict = validateKlingInputFacts({ durationMs: preparedMs, width: preparedProbe.width ?? 0, height: preparedProbe.height ?? 0, bytes: preparedStat.size, fps: preparedProbe.frameRate ?? null });
      if (!verdict.ok) throw new PrepareFailure("UNSUPPORTED_SOURCE", `the prepared video is outside the model's limits: ${verdict.reason}`);
    }

    /*
      ── 5a. THE REFERENCE IMAGES, MADE PLAIN (2026-09-20) ───────────────────

      Two Skin + Face jobs died inside the provider on 09-15 with
      `ffmpeg … -i image-0.bin -vf scale=880:1168 … returned non-zero` — the
      provider's own resize of OUR reference image. The file was a valid
      1080×1440 JPEG straight from an iPhone: progressive, with an 8.7 kB
      EXIF block (thumbnail inside), XMP, an ICC profile and two Photoshop
      segments. Reproduced three times against the model with that exact
      file; the same pixels re-encoded as a plain baseline JPEG with the
      metadata stripped went through first time. A phone's photo is the
      ordinary case here, not the exception, so every reference is
      normalised on this side before a provider ever sees it: baseline JPEG,
      no metadata, the long edge capped at 2048 (the models resize to about
      a megapixel anyway), quality 2. The upload itself is left untouched.
      A re-encode that fails is not fatal — the upload is sent as before and
      the event says so — because a refused image is what the member would
      get either way.
    */
    const preparedReferencePaths: (string | null)[] = [];
    for (const [i, imageFile] of imageFiles.entries()) {
      const out = path.join(dir, `character-${i + 1}-prepared.jpg`);
      const imagePlan: ReferenceImagePlan = { input: imageFile, output: out, maxEdge: 2048 };
      const imageArgs = buildReferenceImageArgs(imagePlan);
      let preparedPath: string | null = null;
      try {
        for (const arg of imageArgs) if (!isKnownReferenceImageArg(arg, imagePlan)) throw new Error("refusing an unknown ffmpeg argument");
        const enc = await runPrepare(imageArgs);
        if (!enc.ok) throw new Error(enc.detail || "ffmpeg failed");
        const encStat = await stat(out).catch(() => null);
        if (!encStat || encStat.size <= 0) throw new Error("ffmpeg wrote nothing");
        const encProbe = await probeMedia(out);
        if (!encProbe?.width || !encProbe.height) throw new Error("the re-encoded image could not be decoded");
        if (profile === "kling") {
          // Kling's element limits (≥ 300 px, aspect 0.40–2.50, ≤ 10 MB): a photo outside them ends the job here, refunded — never a paid-for refusal at the provider.
          const element = validateKlingElementImage({ width: encProbe.width, height: encProbe.height, bytes: encStat.size });
          if (!element.ok) throw new PrepareFailure("INVALID_INPUT", `reference image ${i + 1} is outside the model's element limits: ${element.reason}`);
        }
        const key = aiPreparedReferenceKey(job.user_id, feature.id, job.id, i + 1);
        if (!pathBelongsTo(key, job.user_id, job.id)) throw new Error("refusing a prepared path that failed ownership");
        const upImg = await createAdminClient().storage.from(AI_SOURCE_BUCKET).upload(key, await readFile(out), { contentType: "image/jpeg", upsert: true });
        if (upImg.error) throw new Error(`upload failed: ${upImg.error.message}`);
        preparedPath = key;
        await recordJobEvent(job.id, "reference.prepared", { index: i + 1, width: encProbe.width, height: encProbe.height, bytes: encStat.size, inputBytes: imageByteCounts[i] ?? null });
      } catch (e) {
        if (e instanceof PrepareFailure) throw e;
        console.warn("[cr/prepare] reference image not normalised — sending the upload as-is", { jobId: job.id, index: i + 1, error: String(e).slice(0, 200) });
        await recordJobEvent(job.id, "reference.prepare_failed", { index: i + 1, detail: String(e).slice(0, 200) });
      }
      preparedReferencePaths.push(preparedPath);
    }

    /* ── 5b. the member's own voice, if they uploaded one (Part 6 §3–§4) ── */
    let audioPrepared: NonNullable<CharacterReplaceJobMeta["audio"]>["prepared"] | null = null;
    if (meta.audio?.source === "upload" && audioPath && meta.audio.upload) {
      const audioUrl = await signSourceUrl(audioPath);
      await downloadToFile(audioUrl, audioFile, crConfig.audio.maximumUploadBytes).catch((e) => {
        throw new PrepareFailure("AUDIO_INVALID", `audio: ${String(e)}`);
      });
      const outcome = await prepareReplacementAudio({
        jobId: job.id,
        ownerId: job.user_id,
        feature: feature.id,
        inputFile: audioFile,
        dir,
        videoMs: preparedMs,
        policy: { shorterAudio: crConfig.audio.shorterAudio, minimumCoverageFraction: crConfig.audio.minimumCoverageFraction, trimToFit: meta.audio.trimToFit },
        limits: { maxDurationMs: crConfig.audio.maximumDurationSeconds * 1000 },
        declared: { name: meta.audio.upload.name ?? "", type: meta.audio.upload.mime },
      });
      if (!outcome.ok) {
        await recordJobEvent(job.id, "audio.rejected", { code: outcome.code, detail: outcome.detail.slice(0, 200), source: "upload" });
        throw new PrepareFailure(outcome.code, outcome.detail);
      }
      audioPrepared = {
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
      };
      await recordJobEvent(job.id, "audio.prepared", { source: "upload", durationMs: outcome.durationMs, inputDurationMs: outcome.input.durationMs, trimmed: outcome.trimmed, padded: outcome.padded, transcoded: outcome.transcoded, codec: outcome.input.codec });
    }

    /*
      ── 5c. the voice, made HERE (2026-09-20, ElevenLabs) ───────────────────
      A synchronous text-to-speech provider answers with the audio, so the
      worker makes the voice during prepare and the pipeline has no `voice`
      stage (start/route.ts planned it that way from the same model name).
      The MP3 is then fitted to the video exactly as the advance service fits
      a MiniMax WAV. What the provider said is logged for the operator; the
      member sees a code and is refunded — the provider's sentence never
      reaches them.
    */
    let synthesized: NonNullable<CharacterReplaceJobMeta["audio"]>["synthesized"] = null;
    if (meta.audio?.source === "tts" && meta.audio.tts) {
      const ttsModel = meta.audio.tts.model ?? crConfig.tts.model;
      const provider = textToSpeechProviderFor(ttsModel);
      if (provider.runsIn === "worker") {
        if (!provider.isConfigured()) throw new PrepareFailure("PREPARATION_FAILED", `text-to-speech model ${ttsModel} is not configured on the worker`, "system");
        const ttsFile = path.join(dir, "voice-tts.bin");
        let made: { bytes: Buffer; mime: string };
        try {
          made = await provider.synthesize({ jobId: job.id, text: meta.audio.tts.text, languageCode: meta.audio.tts.languageCode, providerVoiceId: meta.audio.tts.providerVoiceId });
        } catch (e) {
          await recordJobEvent(job.id, "audio.rejected", { code: "TTS_FAILED", detail: String(e).slice(0, 200), source: "tts", provider: provider.id });
          // the provider refused the request itself (too long, an unknown voice) → the member's input; anything else is ours or the provider's
          const userSide = e instanceof ElevenLabsError && e.kind === "input";
          throw new PrepareFailure(userSide ? "AUDIO_INVALID" : "PREPARATION_FAILED", `text-to-speech: ${String(e)}`, userSide ? "user" : "system");
        }
        await writeFile(ttsFile, made.bytes);
        const outcome = await prepareReplacementAudio({
          jobId: job.id,
          ownerId: job.user_id,
          feature: feature.id,
          inputFile: ttsFile,
          dir,
          videoMs: preparedMs,
          policy: { shorterAudio: crConfig.audio.shorterAudio, minimumCoverageFraction: crConfig.audio.minimumCoverageFraction, trimToFit: meta.audio.trimToFit === true },
          limits: { maxDurationMs: Math.max(crConfig.audio.maximumDurationSeconds * 1000, preparedMs * 2) },
          declared: null,
        });
        if (!outcome.ok) {
          await recordJobEvent(job.id, "audio.rejected", { code: outcome.code, detail: outcome.detail.slice(0, 200), source: "tts" });
          throw new PrepareFailure(outcome.code, outcome.detail);
        }
        audioPrepared = {
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
        };
        synthesized = { provider: provider.id, model: ttsModel, kind: "tts", bytes: made.bytes.byteLength, durationMs: outcome.input.durationMs };
        await recordJobEvent(job.id, "audio.prepared", { source: "tts", provider: provider.id, model: ttsModel, durationMs: outcome.durationMs, inputDurationMs: outcome.input.durationMs, trimmed: outcome.trimmed, padded: outcome.padded });
      }
    }

    /*
      ── 5d. the voice change (2026-09-20) ────────────────────────────────────
      The member's fitted recording, re-voiced in the catalogue voice they
      chose (gender and age are theirs to pick; the voice id is the
      catalogue's, written at /start after the price was verified). The
      changer keeps the timing, so the answer is fitted again only to
      re-measure it and to become `audio.prepared`.
    */
    if (meta.audio?.source === "upload" && meta.audio.convert && audioPrepared) {
      const convert = meta.audio.convert;
      const changer = voiceChangeProviderFor(convert.model);
      if (!changer.isConfigured()) throw new PrepareFailure("PREPARATION_FAILED", `voice-change model ${convert.model} is not configured on the worker`, "system");
      const fitted = await readFile(path.join(dir, "voice-prepared.wav"));
      const changedFile = path.join(dir, "voice-changed.bin");
      let made: { bytes: Buffer; mime: string };
      try {
        made = await changer.convert({ jobId: job.id, audio: fitted, audioMime: "audio/wav", providerVoiceId: convert.providerVoiceId });
      } catch (e) {
        await recordJobEvent(job.id, "audio.rejected", { code: "VOICE_CHANGE_FAILED", detail: String(e).slice(0, 200), source: "upload", provider: changer.id });
        const userSide = e instanceof ElevenLabsError && e.kind === "input";
        throw new PrepareFailure(userSide ? "AUDIO_INVALID" : "PREPARATION_FAILED", `voice change: ${String(e)}`, userSide ? "user" : "system");
      }
      await writeFile(changedFile, made.bytes);
      const outcome = await prepareReplacementAudio({
        jobId: job.id,
        ownerId: job.user_id,
        feature: feature.id,
        inputFile: changedFile,
        dir,
        videoMs: preparedMs,
        // the input was already fitted; a provider that returns a hair more or less is trimmed/padded, never refused
        policy: { shorterAudio: "silence", minimumCoverageFraction: 0, trimToFit: true },
        limits: { maxDurationMs: Math.max(crConfig.audio.maximumDurationSeconds * 1000, preparedMs * 2) },
        declared: null,
      });
      if (!outcome.ok) {
        await recordJobEvent(job.id, "audio.rejected", { code: outcome.code, detail: outcome.detail.slice(0, 200), source: "upload", stage: "voice_change" });
        throw new PrepareFailure(outcome.code, outcome.detail);
      }
      audioPrepared = {
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
      };
      synthesized = { provider: changer.id, model: convert.model, kind: "voice_change", bytes: made.bytes.byteLength, durationMs: outcome.input.durationMs };
      await recordJobEvent(job.id, "audio.prepared", { source: "upload", stage: "voice_change", provider: changer.id, model: convert.model, voiceId: convert.voiceId, durationMs: outcome.durationMs, inputDurationMs: outcome.input.durationMs });
    }

    /* ── 6. store beside the inputs, record, hand to the provider ────────── */
    const key = aiPreparedKey(job.user_id, feature.id, job.id);
    if (!pathBelongsTo(key, job.user_id, job.id)) throw new PrepareFailure("PREPARATION_FAILED", "refusing a prepared path that failed ownership", "system");
    const body = await readFile(preparedFile);
    const up = await createAdminClient().storage.from(AI_SOURCE_BUCKET).upload(key, body, { contentType: "video/mp4", upsert: true });
    if (up.error) throw new PrepareFailure("PREPARATION_FAILED", `upload failed: ${up.error.message}`, "system");

    const fresh = await getJobAsService(job.id);
    const freshMeta = readCharacterReplaceMeta(fresh?.metadata);
    await createAdminClient()
      .from("ai_jobs")
      .update({
        source_duration: preparedMs / 1000,
        source_size: videoBytes,
        metadata: {
          ...(fresh?.metadata ?? job.metadata ?? {}),
          video: {
            ...meta.video,
            size: videoBytes,
            durationMs: sourceMs,
            width: videoProbe.width ?? meta.video.width,
            height: videoProbe.height ?? meta.video.height,
            hasAudio: videoProbe.hasAudio,
          },
          character: { ...meta.character, size: imageBytes, width: imageProbe.width, height: imageProbe.height, preparedPath: preparedReferencePaths[0] ?? null },
          references: meta.references.map((r, i) => ({ ...r, size: imageByteCounts[i + 1] ?? r.size, width: imageProbes[i + 1]?.width ?? r.width, height: imageProbes[i + 1]?.height ?? r.height, preparedPath: preparedReferencePaths[i + 1] ?? null })),
          ...(audioPrepared ? { audio: { ...(freshMeta?.audio ?? meta.audio), prepared: audioPrepared, ...(synthesized ? { synthesized } : {}) } } : {}),
          color: { source: color },
          prepared: {
            path: key,
            durationMs: preparedMs,
            width: preparedProbe.width ?? videoProbe.width ?? meta.video.width,
            height: preparedProbe.height ?? videoProbe.height ?? meta.video.height,
            hasAudio: preparedProbe.hasAudio,
            bytes: preparedStat.size,
            trimmed,
            fps: preparedProbe.frameRate ?? null,
            profile,
          },
          prepared_ms: Date.now() - startedAt,
        },
      })
      .eq("id", job.id)
      .eq("status", "acquiring");

    console.info("[cr/prepare] prepared", {
      jobId: job.id,
      userId: job.user_id,
      feature: feature.id,
      sourceMs,
      preparedMs,
      trimmed,
      bytes: preparedStat.size,
      hasAudio: preparedProbe.hasAudio,
      mode: meta.mode,
      references: refPaths.length,
      voice: meta.audio?.source ?? null,
      quality: meta.settings.quality,
      pricingVersion: meta.quote.pricingConfigVersion,
      ms: Date.now() - startedAt,
    });

    const submitted = await dispatchProviderSubmit(job.id);
    if (!submitted.submitted) {
      // The frontend declined or could not be reached. Nothing has been sent to the provider.
      throw new PrepareFailure("SUBMIT_FAILED", submitted.detail, "system");
    }
    return { ok: true, jobId: job.id, durationMs: preparedMs, trimmed, bytes: preparedStat.size };
  } catch (e) {
    const failure = e instanceof PrepareFailure ? e : new PrepareFailure("PREPARATION_FAILED", String(e), "system");
    if (job) await failPrepare(job, failure);
    return { ok: false, jobId, code: failure.code, detail: failure.detail };
  } finally {
    await cleanupFinalizationFiles(dir);
  }
}

/** End the job honestly and give the money back — once (releaseJobFunding is idempotent per job). */
async function failPrepare(job: AiJobRow, failure: PrepareFailure): Promise<void> {
  const updated = await transitionJob(job.id, ["acquiring"], "failed", {
    error_code: failure.code,
    error_message: failure.detail.slice(0, 2000),
    completed_at: new Date().toISOString(),
  });
  await noteJobDiagnostic(job.id, { failure_category: failure.category, failed_in: "prepare" });
  await recordJobEvent(job.id, "prepare.failed", { code: failure.code, category: failure.category, ended: !!updated });
  const subject = subjectFromRow(job);
  if (updated && subject) {
    await releaseJobFunding({ job: updated, subject, feature: "ai_character_replace", dailyLimit: 0, cause: "failure" });
    await recordJobEvent(job.id, "refund.issued", { reason: failure.code, chargedCents: updated.charged_cents, from: "prepare" });
    if (subject.kind === "user") {
      await notifyAiJobFailed({
        userId: subject.userId,
        jobId: job.id,
        feature: "ai_character_replace",
        message: aiErrorMessage(
          failure.code === "DURATION_MISMATCH"
            ? "DURATION_MISMATCH"
            : failure.code === "SUBMIT_FAILED"
              ? "PROVIDER_UNAVAILABLE"
              : failure.code === "AUDIO_INVALID" || failure.code === "AUDIO_TOO_LONG" || failure.code === "AUDIO_TOO_SHORT"
                ? failure.code
                : "PREPARATION_FAILED",
        ),
        errorCode: failure.code,
      });
    }
  }
  console.error("[cr/prepare] failed", {
    jobId: job.id,
    userId: job.user_id,
    code: failure.code,
    category: failure.category,
    detail: failure.detail.slice(0, 300),
    transition: "acquiring -> failed",
    refunded: !!updated,
  });
}

function runPrepare(args: string[]): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(FFMPEG, args, { windowsHide: true });
    } catch (e) {
      resolve({ ok: false, detail: `spawn failed: ${String(e)}` });
      return;
    }
    let err = "";
    let settled = false;
    const finish = (value: { ok: boolean; detail: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      clearTimeout(hard);
      resolve(value);
    };
    let idle = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, detail: "ffmpeg stalled" });
    }, FFMPEG_IDLE_TIMEOUT_MS);
    const bump = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        child.kill("SIGKILL");
        finish({ ok: false, detail: "ffmpeg stalled" });
      }, FFMPEG_IDLE_TIMEOUT_MS);
    };
    const hard = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, detail: "ffmpeg exceeded its hard timeout" });
    }, FFMPEG_HARD_TIMEOUT_MS);
    child.stderr?.on("data", (c: Buffer) => {
      if (err.length < 8_000) err += c.toString();
      bump();
    });
    child.on("error", (e) => finish({ ok: false, detail: String(e) }));
    child.on("close", (code) => finish(code === 0 ? { ok: true, detail: "" } : { ok: false, detail: err.slice(0, 2000) || `exit ${code}` }));
  });
}
