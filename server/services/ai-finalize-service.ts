import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { getUserAIEntitlement } from "@/lib/ai/entitlement";
import { aiFeature, type AiFeature } from "@/lib/ai/jobs";
import { getJobAsService, transitionJob } from "@/lib/ai/job-store";
import { AI_RESULT_BUCKET, aiResultKey, pathBelongsTo } from "@/lib/ai/storage";
import { signSourceUrl } from "@/lib/ai/storage-server";
import { notifyAiCleanFailed, notifyAiCleanFinished } from "@/lib/ai/notify";
import { consumeAiUsage, releaseAiUsage } from "@/lib/ai/usage";
import { AI_CLEAN_LIMITS } from "@/lib/ai/config";
import {
  buildRestoreArgs,
  canStreamCopy,
  checkFinalProbe,
  expectedFinalDuration,
  parseProbeOutput,
  type FinalExpectations,
  type MediaProbe,
  type RestorePlan,
} from "@/lib/ai/ffmpeg-plan";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI CLEAN — putting the sound back on (Part 4)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The AI model returns video with NO AUDIO. Everything in this file exists to
 * fix that: take the cleaned picture, take the original sound, and mux them
 * into one MP4 that is what the member actually wanted.
 *
 * ── 🔴 WHY THIS RUNS ON THE WORKER, NOT ON VERCEL ────────────────────────────
 *
 * This project already runs in two roles from one image (lib/worker.ts): a
 * serverless FRONTEND on Vercel, and a Docker WORKER on Fly/Railway whose image
 * installs ffmpeg and yt-dlp. The worker is the only place that has:
 *
 *   • ffmpeg and ffprobe binaries at all — Vercel's runtime has neither;
 *   • a writable filesystem big enough for two videos and their output;
 *   • minutes of execution time without a platform ceiling;
 *   • memory that is not billed per millisecond while a mux runs.
 *
 * So no new service was introduced. The finalizer is a route on the machine
 * that was already doing exactly this kind of work for downloads.
 *
 * ── 🔴 NO USER INPUT REACHES FFMPEG. NONE. ───────────────────────────────────
 *
 * `spawn` with a fixed ARGUMENT ARRAY — never a shell string, never string
 * concatenation, never a template literal. Every argument is a constant chosen
 * here; the only variables are three temp paths this file builds itself from
 * `tmpdir()` and a job id it read out of the database. A member cannot supply a
 * codec, a filter, a flag, a URL or a filename that ends up in that array.
 * There is no code path where they could, which is stronger than sanitising one.
 *
 * ── The order protects the member's file ─────────────────────────────────────
 *
 * Download → probe → mux → validate → upload → mark completed → only then would
 * anything be cleaned up. The source is never removed before a verified result
 * exists, so a failed mux costs a retry and never the original.
 */

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

/** Reset on every byte of ffmpeg output — a mux making progress is never killed. */
const FFMPEG_IDLE_TIMEOUT_MS = Number(process.env.AI_FFMPEG_IDLE_TIMEOUT_MS || 120_000);
/** A hard ceiling regardless of progress, so nothing can run forever. */
const FFMPEG_HARD_TIMEOUT_MS = Number(process.env.AI_FFMPEG_HARD_TIMEOUT_MS || 20 * 60_000);
const FFPROBE_TIMEOUT_MS = Number(process.env.AI_FFPROBE_TIMEOUT_MS || 30_000);

export type FinalizeOutcome =
  | { ok: true; jobId: string; audioRestored: boolean; durationSeconds: number; bytes: number }
  /** Nothing to do: another worker has it, or it is already finished. */
  | { ok: true; jobId: string; skipped: string }
  | { ok: false; jobId: string; code: FinalizeErrorCode; detail: string };

export type FinalizeErrorCode =
  | "AI_FINALIZATION_FAILED"
  | "AUDIO_RESTORE_FAILED"
  | "INVALID_AI_OUTPUT"
  | "INVALID_FINAL_VIDEO"
  | "FINAL_UPLOAD_FAILED"
  | "RESULT_NOT_FOUND";

/* ────────────────────────────── ffprobe ──────────────────────────────────── */

/**
 * What is actually in a file.
 *
 * JSON output rather than scraping ffmpeg's stderr (which the download service
 * does, because it is probing a URL mid-stream): here there is a real file on
 * disk, and a parsed answer beats a regex over human-readable log lines.
 */
export async function probeMedia(filePath: string): Promise<MediaProbe | null> {
  const raw = await runProbe(filePath);
  return raw ? parseProbeOutput(raw) : null;
}

function runProbe(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        FFPROBE,
        ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
        { windowsHide: true },
      );
    } catch {
      resolve(null);
      return;
    }
    let out = "";
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, FFPROBE_TIMEOUT_MS);

    child.stdout?.on("data", (c: Buffer) => (out += c.toString()));
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code === 0 ? out : null));
  });
}

/* ─────────────────────────────── the mux ─────────────────────────────────── */

/** Run the mux. Resolves with ffmpeg's stderr on failure, for the log only. */
export function restoreOriginalAudio(plan: RestorePlan): Promise<{ ok: boolean; detail: string }> {
  const args = buildRestoreArgs(plan);
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
      // Bounded: a failing ffmpeg can print a great deal, and this is only ever
      // read into a log line.
      if (err.length < 8_000) err += c.toString();
      bump();
    });
    child.on("error", (e) => finish({ ok: false, detail: String(e) }));
    child.on("close", (code) =>
      finish(code === 0 ? { ok: true, detail: "" } : { ok: false, detail: err.slice(0, 2000) || `exit ${code}` }),
    );
  });
}

/* ───────────────────────────── validation ────────────────────────────────── */

/**
 * The filesystem half of validation: does the file exist, is it a sane size,
 * and what does ffprobe make of it? The JUDGEMENT — audio present, duration
 * within tolerance — is `checkFinalProbe` in lib/ai/ffmpeg-plan.ts, where it
 * can be tested without writing a video first.
 */
export async function validateFinalVideo(
  filePath: string,
  expectations: FinalExpectations,
): Promise<{ ok: true; probe: MediaProbe } | { ok: false; reason: string }> {
  let bytes: number;
  try {
    bytes = (await stat(filePath)).size;
  } catch {
    return { ok: false, reason: "the final file was not written" };
  }
  if (bytes <= 0) return { ok: false, reason: "the final file is empty" };
  if (bytes > AI_CLEAN_LIMITS.maxResultSize) return { ok: false, reason: "the final file is over the size ceiling" };

  const probe = await probeMedia(filePath);
  const verdict = checkFinalProbe(probe, expectations);
  if (!verdict.ok) return verdict;
  return { ok: true, probe: probe! };
}

/* ─────────────────────────── files in and out ────────────────────────────── */

/**
 * Stream a URL to disk.
 *
 * 🔴 Streamed, never buffered. These are whole videos: `await res.arrayBuffer()`
 * on a 100 MB file is 100 MB of resident memory per concurrent job, and two of
 * them at once is how a worker gets OOM-killed mid-mux. The bytes go from the
 * socket to the filesystem and are never all in the process at one time.
 */
async function downloadToFile(url: string, destination: string, limitBytes: number): Promise<number> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > limitBytes) throw new Error(`declared ${declared} bytes, over the ceiling`);

  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(destination));

  const { size } = await stat(destination);
  if (size <= 0) throw new Error("downloaded nothing");
  // Checked again after the fact: a missing or lying content-length is not
  // permission to have written an unbounded file to our disk.
  if (size > limitBytes) throw new Error(`wrote ${size} bytes, over the ceiling`);
  return size;
}

/** Put the finished MP4 in the private results bucket, at the server's own key. */
export async function uploadFinalResult(opts: {
  userId: string;
  feature: AiFeature;
  jobId: string;
  filePath: string;
}): Promise<{ path: string; bytes: number }> {
  const key = aiResultKey(opts.userId, opts.feature, opts.jobId, "mp4");
  // Belt and braces on a key this function built itself: the value is about to
  // be written to a row that later mints signed URLs from it.
  if (!pathBelongsTo(key, opts.userId, opts.jobId)) throw new Error("refusing a result path that failed ownership");

  const { readFile } = await import("node:fs/promises");
  const body = await readFile(opts.filePath);

  const admin = createAdminClient();
  const { error } = await admin.storage.from(AI_RESULT_BUCKET).upload(key, body, {
    contentType: "video/mp4",
    // A retried finalization overwrites its own object rather than failing on a
    // duplicate key. The whole flow is idempotent; this has to be too.
    upsert: true,
  });
  if (error) throw new Error(`upload failed: ${error.message}`);

  return { path: key, bytes: body.byteLength };
}

/** Remove everything this job wrote to disk. Never throws. */
export async function cleanupFinalizationFiles(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (e) {
    // Worth a line: a worker that stops cleaning up fills its disk and then
    // fails every job with something that looks unrelated.
    console.error("[ai/finalize] temp cleanup failed", { dir, error: String(e) });
  }
}

/* ────────────────────────────── the whole job ────────────────────────────── */

/**
 * Finalize one AI Clean job.
 *
 * ── The claim IS the lock ────────────────────────────────────────────────────
 *
 * `transitionJob(id, ["processing"], "finalizing")` is a compare-and-set: the
 * first caller moves the row and every later one matches nothing and returns
 * null. That single statement is what makes a webhook retry, a worker retry and
 * two concurrent invocations all safe — no advisory lock, no "is it running"
 * flag that could be left set by a crash.
 */
export async function finalizeAICleanJob(jobId: string): Promise<FinalizeOutcome> {
  const startedAt = Date.now();
  const job = await getJobAsService(jobId);
  if (!job) return { ok: false, jobId, code: "RESULT_NOT_FOUND", detail: "no such job" };

  const feature = aiFeature(job.feature);
  if (!feature) return { ok: false, jobId, code: "AI_FINALIZATION_FAILED", detail: "unknown feature" };

  if (job.status === "completed" && job.result_path) {
    return { ok: true, jobId, skipped: "already finalized" };
  }

  const providerOutputUrl =
    typeof job.metadata?.provider_output_url === "string" ? job.metadata.provider_output_url : null;
  if (!providerOutputUrl) {
    return { ok: false, jobId, code: "INVALID_AI_OUTPUT", detail: "no provider output recorded" };
  }
  if (!job.source_path) {
    return { ok: false, jobId, code: "AI_FINALIZATION_FAILED", detail: "no source path recorded" };
  }

  const claimed = await transitionJob(jobId, ["processing"], "finalizing");
  if (!claimed) {
    // Somebody else has it, or it is not in a state that can be finalized.
    return { ok: true, jobId, skipped: `not claimable from ${job.status}` };
  }

  console.info("[ai/finalize] started", {
    jobId,
    userId: job.user_id,
    feature: feature.id,
    transition: "processing -> finalizing",
  });

  const dir = path.join(tmpdir(), "frenz-ai", jobId.replace(/[^0-9a-fA-F-]/g, ""));
  const sourceFile = path.join(dir, "source.bin");
  const cleanedFile = path.join(dir, "cleaned.bin");
  const finalFile = path.join(dir, "final.mp4");

  try {
    await mkdir(dir, { recursive: true });

    /* 1 · both inputs, streamed to disk */
    const sourceUrl = await signSourceUrl(job.source_path);
    const [sourceBytes, cleanedBytes] = await Promise.all([
      downloadToFile(sourceUrl, sourceFile, AI_CLEAN_LIMITS.maxFileSize),
      downloadToFile(providerOutputUrl, cleanedFile, AI_CLEAN_LIMITS.maxResultSize),
    ]);

    /* 2 · what is actually in them */
    const [sourceProbe, cleanedProbe] = await Promise.all([probeMedia(sourceFile), probeMedia(cleanedFile)]);
    if (!cleanedProbe?.hasVideo) {
      throw new FinalizeFailure("INVALID_AI_OUTPUT", "the AI output has no readable video stream");
    }

    const hasAudio = !!sourceProbe?.hasAudio;
    const canCopyVideo = canStreamCopy(cleanedProbe.videoCodec);

    console.info("[ai/finalize] probed", {
      jobId,
      audioPresent: hasAudio,
      sourceCodec: sourceProbe?.videoCodec ?? null,
      cleanedCodec: cleanedProbe.videoCodec,
      streamCopy: canCopyVideo,
      sourceBytes,
      cleanedBytes,
    });

    /* 3 · the mux */
    let run = await restoreOriginalAudio({
      cleanedPath: cleanedFile,
      sourcePath: sourceFile,
      outPath: finalFile,
      hasAudio,
      canCopyVideo,
    });

    /*
      One retry, re-encoding, and only when the copy attempt is what failed.

      A stream copy can be refused for reasons ffprobe cannot see — an exotic
      profile, a stream MP4 will not carry. Re-encoding is slower and lossy, so
      it is never the first choice, and trying it once is far better than
      failing a job that would have worked.
    */
    if (!run.ok && canCopyVideo) {
      console.warn("[ai/finalize] stream copy failed, re-encoding once", { jobId, detail: run.detail });
      run = await restoreOriginalAudio({
        cleanedPath: cleanedFile,
        sourcePath: sourceFile,
        outPath: finalFile,
        hasAudio,
        canCopyVideo: false,
      });
    }
    if (!run.ok) throw new FinalizeFailure("AUDIO_RESTORE_FAILED", run.detail);

    /* 4 · is it a real video? */
    const expectedDuration = expectedFinalDuration({
      hasAudio,
      sourceDuration: sourceProbe?.durationSeconds ?? null,
      cleanedDuration: cleanedProbe.durationSeconds,
    });

    const verdict = await validateFinalVideo(finalFile, {
      expectAudio: hasAudio,
      expectedDurationSeconds: expectedDuration,
    });
    if (!verdict.ok) throw new FinalizeFailure("INVALID_FINAL_VIDEO", verdict.reason);

    /* 5 · store it */
    let stored: { path: string; bytes: number };
    try {
      stored = await uploadFinalResult({
        userId: job.user_id,
        feature: feature.id,
        jobId,
        filePath: finalFile,
      });
    } catch (e) {
      throw new FinalizeFailure("FINAL_UPLOAD_FAILED", String(e));
    }

    /* 6 · and only now is the job finished */
    const completed = await transitionJob(jobId, ["finalizing"], "completed", {
      result_path: stored.path,
      result_size: stored.bytes,
      result_duration: verdict.probe.durationSeconds,
      result_mime_type: "video/mp4",
      audio_restored: hasAudio && verdict.probe.hasAudio,
      completed_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
      // The provider's URL has served its purpose and expires on their
      // schedule. Clearing it keeps a dead link out of the row.
      metadata: { ...(job.metadata ?? {}), provider_output_url: null },
    });

    if (completed) {
      await consumeAiUsage(job.user_id, feature.id);
      /*
        🔴 They are almost certainly not looking at this tab. The model runs for
        minutes, so by the time it lands the member has switched apps and the
        polling has stopped — see lib/ai/notify.ts. Awaited rather than fired
        and forgotten: this runs on the long-lived worker, not on a serverless
        function that freezes at the response, and the push fan-out is bounded
        so it cannot hang the finalizer.
      */
      await notifyAiCleanFinished({
        userId: job.user_id,
        jobId,
        audioRestored: hasAudio && verdict.probe.hasAudio,
      });
    }

    console.info("[ai/finalize] completed", {
      jobId,
      userId: job.user_id,
      feature: feature.id,
      audioRestored: hasAudio && verdict.probe.hasAudio,
      durationSeconds: verdict.probe.durationSeconds,
      bytes: stored.bytes,
      streamCopy: canCopyVideo,
      elapsedMs: Date.now() - startedAt,
      transition: "finalizing -> completed",
    });

    return {
      ok: true,
      jobId,
      audioRestored: hasAudio && verdict.probe.hasAudio,
      durationSeconds: verdict.probe.durationSeconds ?? 0,
      bytes: stored.bytes,
    };
  } catch (e) {
    const code = e instanceof FinalizeFailure ? e.code : "AI_FINALIZATION_FAILED";
    const detail = e instanceof FinalizeFailure ? e.detail : String(e);

    await transitionJob(jobId, ["finalizing"], "failed", {
      error_code: code,
      // Operator-facing. `jobToView` never selects this column, so ffmpeg's
      // output cannot reach a browser.
      error_message: detail.slice(0, 2000),
      completed_at: new Date().toISOString(),
    });

    // 🔴 Ours, so it is free. The member is not charged for a mux that failed.
    const entitlement = await getUserAIEntitlement(job.user_id, feature);
    await releaseAiUsage(job.user_id, feature.id, entitlement.dailyLimit);

    // …and they are told, with the refund stated. A silent failure on a job
    // somebody stopped watching is indistinguishable from one still running.
    await notifyAiCleanFailed({
      userId: job.user_id,
      jobId,
      message: "The cleanup didn't finish. Your allowance wasn't used — you can try again.",
    });

    console.error("[ai/finalize] failed", {
      jobId,
      userId: job.user_id,
      feature: feature.id,
      code,
      elapsedMs: Date.now() - startedAt,
      transition: "finalizing -> failed",
      released: true,
    });

    return { ok: false, jobId, code, detail };
  } finally {
    // Always. A worker that leaves two videos per failed job on disk fills it
    // within a day and then fails everything for an unrelated-looking reason.
    await cleanupFinalizationFiles(dir);
  }
}

/** Internal marker so a specific failure keeps its code through the catch. */
class FinalizeFailure extends Error {
  constructor(
    readonly code: FinalizeErrorCode,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "FinalizeFailure";
  }
}
