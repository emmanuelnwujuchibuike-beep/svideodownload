import { spawn, execFile } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildPrepareArgs, isKnownPrepareArg, type PreparePlan } from "@/lib/ai/character-replace/ffmpeg";
import { durationWithinTolerance, readCharacterReplaceMeta, selectedRangeOf, type CharacterReplaceJobMeta } from "@/lib/ai/character-replace/job-meta";
import { publicCharacterReplaceConfig } from "@/lib/ai/character-replace/config";
import { characterReplaceLimits } from "@/lib/ai/character-replace/validate";
import { aiErrorMessage } from "@/lib/ai/errors";
import { releaseJobFunding } from "@/lib/ai/funding";
import { aiFeature, type AiJobRow } from "@/lib/ai/jobs";
import { getJobAsService, noteJobDiagnostic, transitionJob } from "@/lib/ai/job-store";
import { AI_IMAGE_MAX_BYTES } from "@/lib/ai/media";
import { notifyAiJobFailed } from "@/lib/ai/notify";
import { AI_SOURCE_BUCKET, aiPreparedKey, pathBelongsTo } from "@/lib/ai/storage";
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
  | "SUBMIT_FAILED";

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

    // 🔴 Ownership of both input paths, from the ROW, before either becomes a URL.
    if (!pathBelongsTo(meta.video.path, job.user_id, job.id) || !pathBelongsTo(meta.character.path, job.user_id, job.id)) {
      throw new PrepareFailure("PREPARATION_FAILED", "an input path failed ownership", "system");
    }

    const settings = await getLandingSettings();
    // The same ceilings the browser and /start applied, from the same source.
    const limits = characterReplaceLimits(
      publicCharacterReplaceConfig(
        settings.frenzAiCharacterReplace,
        { code: settings.frenzAiCurrency, symbol: aiCurrencySymbol(settings.frenzAiCurrency) },
        true,
      ),
    );

    await mkdir(dir, { recursive: true });
    const videoFile = path.join(dir, "source.bin");
    const imageFile = path.join(dir, "character.bin");
    const preparedFile = path.join(dir, "prepared.mp4");

    const [videoUrl, imageUrl] = await Promise.all([signSourceUrl(meta.video.path), signSourceUrl(meta.character.path)]);
    const [videoBytes, imageBytes] = await Promise.all([
      downloadToFile(videoUrl, videoFile, feature.maxBytes).catch((e) => {
        throw new PrepareFailure("FILE_TOO_LARGE", `video: ${String(e)}`);
      }),
      downloadToFile(imageUrl, imageFile, AI_IMAGE_MAX_BYTES).catch((e) => {
        throw new PrepareFailure("FILE_TOO_LARGE", `image: ${String(e)}`);
      }),
    ]);

    /* ── 3. measure, never trust ─────────────────────────────────────────── */
    const [videoProbe, imageProbe] = await Promise.all([probeMedia(videoFile), probeMedia(imageFile)]);
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
    if (!imageProbe || !imageProbe.width || !imageProbe.height) {
      throw new PrepareFailure("INVALID_INPUT", "the character image could not be decoded");
    }
    if (Math.min(imageProbe.width, imageProbe.height) < limits.photo.minEdge) {
      throw new PrepareFailure("INVALID_INPUT", `character image ${imageProbe.width}x${imageProbe.height} is too small`);
    }

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
      HDR in → SDR out, properly (owner, 2026-09-14: "extra colour"). An HLG/PQ
      or 10-bit BT.2020 source is tone-mapped to BT.709 before the model sees
      it. If this ffmpeg build lacks zscale/tonemap the encode is retried
      without the chain — a plain conversion beats no video, and the row says
      which one ran.
    */
    const color = await probeColor(videoFile);
    const hdr = isHdrSource(color);
    let plan: PreparePlan = { input: videoFile, output: preparedFile, startMs: range.startMs, endMs: trimmed ? range.endMs : null, hdr };
    let args = buildPrepareArgs(plan);
    for (const arg of args) {
      if (!isKnownPrepareArg(arg, plan)) throw new PrepareFailure("PREPARATION_FAILED", `refusing an unknown ffmpeg argument`, "system");
    }
    let cut = await runPrepare(args);
    let toneMapped = hdr;
    if (!cut.ok && hdr) {
      console.warn("[cr/prepare] HDR tone-map failed, retrying as a plain conversion", { jobId, detail: cut.detail.slice(0, 200) });
      plan = { ...plan, hdr: false };
      args = buildPrepareArgs(plan);
      cut = await runPrepare(args);
      toneMapped = false;
    }
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

    /* ── 6. store beside the inputs, record, hand to the provider ────────── */
    const key = aiPreparedKey(job.user_id, feature.id, job.id);
    if (!pathBelongsTo(key, job.user_id, job.id)) throw new PrepareFailure("PREPARATION_FAILED", "refusing a prepared path that failed ownership", "system");
    const body = await readFile(preparedFile);
    const up = await createAdminClient().storage.from(AI_SOURCE_BUCKET).upload(key, body, { contentType: "video/mp4", upsert: true });
    if (up.error) throw new PrepareFailure("PREPARATION_FAILED", `upload failed: ${up.error.message}`, "system");

    const fresh = await getJobAsService(job.id);
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
          character: { ...meta.character, size: imageBytes, width: imageProbe.width, height: imageProbe.height },
          color: { source: color, hdr, toneMapped },
          prepared: {
            path: key,
            durationMs: preparedMs,
            width: preparedProbe.width ?? videoProbe.width ?? meta.video.width,
            height: preparedProbe.height ?? videoProbe.height ?? meta.video.height,
            hasAudio: preparedProbe.hasAudio,
            bytes: preparedStat.size,
            trimmed,
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
  const subject = subjectFromRow(job);
  if (updated && subject) {
    await releaseJobFunding({ job: updated, subject, feature: "ai_character_replace", dailyLimit: 0 });
    if (subject.kind === "user") {
      await notifyAiJobFailed({
        userId: subject.userId,
        jobId: job.id,
        feature: "ai_character_replace",
        message: aiErrorMessage(failure.code === "DURATION_MISMATCH" ? "DURATION_MISMATCH" : failure.code === "SUBMIT_FAILED" ? "PROVIDER_UNAVAILABLE" : "PREPARATION_FAILED"),
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

/** The source's colour signalling: transfer, primaries, matrix, pixel format. Unknown reads as null. */
export interface ColorSignal {
  transfer: string | null;
  primaries: string | null;
  matrix: string | null;
  pixFmt: string | null;
}

export function isHdrSource(c: ColorSignal | null): boolean {
  if (!c) return false;
  const t = (c.transfer ?? "").toLowerCase();
  const p = (c.primaries ?? "").toLowerCase();
  const f = (c.pixFmt ?? "").toLowerCase();
  return t === "arib-std-b67" || t === "smpte2084" || p === "bt2020" || /10le|10be|12le|12be/.test(f);
}

const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

function probeColor(filePath: string): Promise<ColorSignal | null> {
  return new Promise((resolve) => {
    execFile(
      FFPROBE,
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt,color_transfer,color_primaries,color_space", "-of", "json", filePath],
      { windowsHide: true, timeout: 30_000 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        try {
          const s = (JSON.parse(String(stdout)).streams?.[0] ?? {}) as Record<string, string | undefined>;
          const norm = (v: string | undefined) => (v && v !== "unknown" ? v : null);
          resolve({ transfer: norm(s.color_transfer), primaries: norm(s.color_primaries), matrix: norm(s.color_space), pixFmt: norm(s.pix_fmt) });
        } catch {
          resolve(null);
        }
      },
    );
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
