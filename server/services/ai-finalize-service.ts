import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiFeature, type AiFeature } from "@/lib/ai/jobs";
import { getJobAsService, noteJobDiagnostic, transitionJob } from "@/lib/ai/job-store";
import { AI_RESULT_BUCKET, AI_SOURCE_BUCKET, aiResultKey, pathBelongsTo } from "@/lib/ai/storage";
import { signSourceUrl, uploadResultPoster } from "@/lib/ai/storage-server";
import { notifyAiCleanFailed, notifyAiCleanFinished } from "@/lib/ai/notify";
import { subjectFromRow, subjectOwnerId } from "@/lib/ai/subject";
import { consumeAiUsage, releaseAiUsage } from "@/lib/ai/usage";
import { AI_CLEAN_LIMITS, AI_CLEAN_PROPAINTER, aiCleanEngine } from "@/lib/ai/config";
import { runProPainter } from "@/lib/ai/propainter";
import {
  buildPosterArgs,
  buildMaskedCompositeArgs,
  buildRestoreArgs,
  buildResizeToSourceArgs,
  buildMaskCoverageArgs,
  buildTextMaskArgs,
  MASK_REFINE_MIN_RATIO,
  POSTER_FRACTION,
  parseMaskCoverage,
  canStreamCopy,
  checkFinalProbe,
  expectedFinalDuration,
  parseProbeOutput,
  type FinalExpectations,
  type MediaProbe,
  type RestorePlan,
} from "@/lib/ai/ffmpeg-plan";
import { createAdminClient } from "@/lib/supabase/admin";
import { detectTextBoxes } from "@/server/services/ai-text-detect-service";

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
  /**
   * The source is outside what AI Clean takes — currently only the resolution
   * ceiling, which for an UPLOAD is first knowable here (see the check itself
   * for why). Its own code so "we would not run this" is never mistaken in the
   * logs for "we tried and it broke".
   */
  | "UNSUPPORTED_SOURCE"
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
/** No bytes for this long and the transfer is dead, not slow. */
const DOWNLOAD_IDLE_TIMEOUT_MS = Number(process.env.AI_DOWNLOAD_IDLE_TIMEOUT_MS || 60_000);
/** A ceiling regardless of progress, so one file cannot hold a job forever. */
const DOWNLOAD_HARD_TIMEOUT_MS = Number(process.env.AI_DOWNLOAD_HARD_TIMEOUT_MS || 10 * 60_000);

/**
 * Pull a provider's output onto disk.
 *
 * ── 🔴 IT HAD NO TIMEOUT AT ALL, AND THAT IS HOW A JOB HANGS FOREVER ───────
 *
 * Owner, 2026-09-09: "I tried testing the video editing again and it has been
 * loading, it glitched around 2 minutes like it finished and then continued
 * again and since then it has been loading."
 *
 * Traced on their job: the detector finished at 14:46:22, ProPainter was
 * submitted at 14:47:51 and SUCCEEDED at ~14:51 with predict_time 190.6s — and
 * the row was still `finalizing` eleven minutes later. The provider had done
 * everything asked of it. The job was stuck on OUR side, on the very next line.
 *
 * `await fetch(url)` carried no `AbortSignal`, and `pipeline()` had no idle
 * timeout. A CDN that accepts the connection and then stalls mid-body leaves
 * both waiting indefinitely: no error, no retry, no log — the stall guard's
 * 60-minute `finalizing` deadline was the only thing that could ever end it.
 *
 * This project has been bitten by exactly this before, in `proxyDownload`, and
 * the lesson is written down: a stream needs an IDLE timeout, not just a total
 * one. A slow 40 MB file on a bad connection must not be killed, and a dead
 * socket must not be waited on — only "no bytes for a while" tells them apart.
 *
 * Two clocks, therefore:
 *   · IDLE — reset on every chunk. This is the one that catches a stall.
 *   · HARD — never reset. This is the one that catches a trickle.
 */
async function downloadToFile(url: string, destination: string, limitBytes: number): Promise<number> {
  const controller = new AbortController();

  let idle: NodeJS.Timeout | undefined;
  const hard = setTimeout(() => controller.abort(), DOWNLOAD_HARD_TIMEOUT_MS);
  const bump = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_TIMEOUT_MS);
  };
  bump();

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > limitBytes) throw new Error(`declared ${declared} bytes, over the ceiling`);

    /*
      The counter is what resets the idle clock, and it also enforces the
      ceiling WHILE the bytes arrive rather than after. `content-length` is a
      claim by the other end — a server that omits or lies about it could
      otherwise fill the worker's disk before anything measured anything.
    */
    let written = 0;
    const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    source.on("data", (chunk: Buffer) => {
      written += chunk.length;
      if (written > limitBytes) controller.abort();
      bump();
    });

    await pipeline(source, createWriteStream(destination));
  } catch (e) {
    // An abort is one of ours, and the caller needs to know which clock fired
    // rather than seeing a bare "AbortError" it cannot act on.
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("the provider's download stalled or exceeded its budget");
    }
    throw e;
  } finally {
    clearTimeout(idle);
    clearTimeout(hard);
  }

  const { size } = await stat(destination);
  if (size <= 0) throw new Error("downloaded nothing");
  // Checked again after the fact: a missing or lying content-length is not
  // permission to have written an unbounded file to our disk.
  if (size > limitBytes) throw new Error(`wrote ${size} bytes, over the ceiling`);
  return size;
}

/**
 * Put the finished MP4 in the private results bucket, at the server's own key.
 *
 * 🔴 `ownerId`, NOT `userId`. It is `subjectOwnerId(subject)` — a member's uuid
 * OR a guest's signed identifier — and the rename is the fix, not decoration.
 *
 * This took `userId: string` and was called with `job.user_id`, which is NULL
 * for an anonymous job. `AiJobRow` typed that column as non-nullable, so the
 * call compiled, and the failure landed at runtime deep inside `safeSegment`:
 *
 *     TypeError: Cannot read properties of null (reading 'toLowerCase')
 *
 * …reported as FINAL_UPLOAD_FAILED, after the download, the mux and the
 * provider bill. Every guest job died there, on the last step. The parameter is
 * named for what it actually is now so the next caller cannot reach for the
 * wrong field, and `/api/ai/jobs/[id]/result` already keys off exactly the same
 * `subjectOwnerId`, so the two halves agree by construction.
 */
export async function uploadFinalResult(opts: {
  ownerId: string;
  feature: AiFeature;
  jobId: string;
  filePath: string;
}): Promise<{ path: string; bytes: number }> {
  const key = aiResultKey(opts.ownerId, opts.feature, opts.jobId, "mp4");
  // Belt and braces on a key this function built itself: the value is about to
  // be written to a row that later mints signed URLs from it.
  if (!pathBelongsTo(key, opts.ownerId, opts.jobId)) throw new Error("refusing a result path that failed ownership");

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

  /*
    🔴 THE OWNER, RESOLVED ONCE AND BEFORE THE CLAIM.

    A member or a guest, from the row itself — the browser that started this is
    long gone. It is read here rather than just before the upload for two
    reasons: a job with no resolvable owner must fail BEFORE the claim (there is
    nowhere to put the result, so downloading and muxing it would be work spent
    to reach the same error), and the same value is needed again at the end for
    `consumeAiUsage`, which used to recompute it.

    It cannot legitimately be null — `ai_jobs_subject_chk` requires exactly one
    of the two columns — so this failing means the SELECT is missing a column
    again, which is precisely how the guest bug happened. The message says so.
  */
  const owner = subjectFromRow(job);
  if (!owner) {
    return {
      ok: false,
      jobId,
      code: "AI_FINALIZATION_FAILED",
      detail: "job row has neither user_id nor guest_id — check JOB_COLUMNS",
    };
  }
  const ownerId = subjectOwnerId(owner);

  const claimed = await transitionJob(jobId, ["processing"], "finalizing");
  if (!claimed) {
    // Somebody else has it, or it is not in a state that can be finalized.
    return { ok: true, jobId, skipped: `not claimable from ${job.status}` };
  }

  console.info("[ai/finalize] started", {
    jobId,
    // The KIND, not the identifier. Which of the two paths a job took is the
    // useful thing in a log line, and it was the unlogged half of this bug.
    owner: owner.kind,
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

    /*
      ── 🔴 THE RESOLUTION CEILING FOR AN UPLOAD, AT THE ONLY PLACE IT FITS ────

      A link job is probed by the worker before it is submitted, so
      `ai-acquire-service.ts` applies this ceiling for free. An UPLOAD never
      passes through the worker before submission — it goes browser-to-storage
      and is dispatched from Vercel, which has no ffprobe — so this is the first
      moment its resolution is knowable at all.

      That means the detector has already run and been paid for, and this check
      cannot recover that. What it does recover is the GPU stage, which is the
      expensive half, and it stops an absurd file becoming an absurd result in
      the member's storage. Applied to every job rather than only uploads,
      because a ceiling with an exception is a ceiling somebody routes around.

      ⚠️ An unreadable probe is NOT over the ceiling. A width of 0 means we
      failed to read the header, and refusing on that would fail jobs for a
      reason that has nothing to do with the video.
    */
    const sourcePixels = (sourceProbe?.width ?? 0) * (sourceProbe?.height ?? 0);
    if (sourcePixels > AI_CLEAN_LIMITS.maxPixels) {
      throw new FinalizeFailure(
        "UNSUPPORTED_SOURCE",
        `${sourceProbe?.width}x${sourceProbe?.height} exceeds ${AI_CLEAN_LIMITS.maxPixels}px`,
      );
    }

    const hasAudio = !!sourceProbe?.hasAudio;

    /*
      🔴 THE ENGINE COMES FROM THE JOB, NOT FROM THE SETTING.

      It was resolved and written when the job was submitted. Re-reading the
      admin switch here would mean an operator who flipped it during a job gets
      the two stages disagreeing: a video detected with the classical FILL —
      already smeared — and then "reconstructed" from that smear.

      Falls back to the environment default only for jobs that predate the field.
    */
    const jobEngine =
      job.metadata?.engine === "propainter" || job.metadata?.engine === "classical"
        ? job.metadata.engine
        : aiCleanEngine();

    console.info("[ai/finalize] probed", {
      jobId,
      audioPresent: hasAudio,
      sourceCodec: sourceProbe?.videoCodec ?? null,
      cleanedCodec: cleanedProbe.videoCodec,
      sourceBytes,
      cleanedBytes,
      engine: jobEngine,
    });

    /*
      ─── 2b · THE PROPAINTER STAGE ──────────────────────────────────────────

      Only when the engine is on. `cleanedFile` at this point is the DETECTOR's
      output — hjunior29 in `black` mode, i.e. the caption painted out as solid
      rectangles — not something anyone should ever see. The mask is derived
      from it, ProPainter reconstructs, and `pictureFile` moves to that result.

      🔴 IT FALLS BACK RATHER THAN FAILING. If any step here does not work the
      job continues with the detector's own output. That is a worse-looking
      video, but it is a finished one, and a member who waited three minutes
      should not be told "nothing for you" because the second provider was
      briefly unavailable. Every fallback is recorded on the job so the rate is
      measurable rather than invisible.
    */
    let pictureFile = cleanedFile;
    let picture = cleanedProbe;

    if (jobEngine === "propainter") {
      const swapped = await reconstructWithProPainter({
        jobId,
        ownerId,
        feature: feature.id,
        dir,
        sourceFile,
        detectionFile: cleanedFile,
        sourceProbe,
      });

      let reconstructed = false;
      if (swapped) {
        const reprobed = await probeMedia(swapped);
        if (reprobed?.hasVideo) {
          pictureFile = swapped;
          picture = reprobed;
          reconstructed = true;
        } else {
          console.warn("[ai/finalize] propainter output unreadable", { jobId });
          await noteJobDiagnostic(jobId, { propainter: "unreadable-output" });
        }
      }

      /*
        ═══════════════════════════════════════════════════════════════════
         🔴 THE BLACK RECTANGLE. THIS IS WHERE IT SHIPPED FROM.
        ═══════════════════════════════════════════════════════════════════

        Owner, 2026-09-09, twice: "produced a solid black rectangular region
        instead of reconstructing the background", and after a second run,
        "i ran it again and is still the same result".

        `cleanedFile` on this engine is hjunior29 in `black` mode — the caption
        painted out as solid rectangles so we can recover a mask from it. It is
        an INTERMEDIATE. The comment eight lines above already said "not
        something anyone should ever see", and then the fallback shipped it:
        every path out of `reconstructWithProPainter` that returns null left
        `pictureFile` pointing at it, and the mux happily put the member's
        audio on top and called the job completed.

        Both of the owner's jobs took that path. Neither carried a `propainter`
        diagnostic at all, which means `reconstructWithProPainter` was never
        even entered — the worker was running a build that predates it while
        the frontend was already asking the detector for `black`. A split
        deploy, and the failure mode was to hand somebody a censored video.

        ── Why FAILING is the correct behaviour, not falling back ───────────

        The fallback reasoning is sound for the CLASSICAL engine: the detector's
        own output is a finished, watchable video, so a second provider's bad
        afternoon should not cost the member their wait. On this engine that
        premise is false. There is no usable fallback here — the only other
        file on disk is the blackened one — so the honest options are to fail
        the job and refund, or to ship something nobody would call a result.

        Failing costs the member their wait. Shipping black boxes costs them
        their wait AND their allowance AND their trust in the tool, and it does
        it silently. So: fail, refund, and say so.
      */
      if (!reconstructed) {
        throw new FinalizeFailure(
          "AI_FINALIZATION_FAILED",
          "reconstruction did not run; refusing to ship the detector's blackened intermediate",
        );
      }
    }

    const canCopyVideo = canStreamCopy(picture.videoCodec);

    /* 3 · the mux */
    let run = await restoreOriginalAudio({
      cleanedPath: pictureFile,
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
        cleanedPath: pictureFile,
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
      cleanedDuration: picture.durationSeconds,
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
        ownerId,
        feature: feature.id,
        jobId,
        filePath: finalFile,
      });
    } catch (e) {
      throw new FinalizeFailure("FINAL_UPLOAD_FAILED", String(e));
    }

    /*
      5b · the poster (migration 0147)

      🔴 NEVER FATAL, AND THAT IS THE WHOLE DESIGN. The member's video is
      already in the bucket one line above this. A thumbnail failing to encode
      is a tile that falls back to a gradient plate — it is not a reason to
      throw away a video the model has already been paid to make, and a
      `throw` here would do exactly that by unwinding into the failure path.

      So it returns a path or null, and null is an ordinary answer.
    */
    const posterPath = await makeResultPoster({
      videoPath: finalFile,
      dir,
      ownerId,
      feature: feature.id,
      jobId,
      durationSeconds: verdict.probe.durationSeconds,
    });

    /* 6 · and only now is the job finished */
    const completed = await transitionJob(jobId, ["finalizing"], "completed", {
      result_path: stored.path,
      poster_path: posterPath,
      result_size: stored.bytes,
      result_duration: verdict.probe.durationSeconds,
      result_mime_type: "video/mp4",
      audio_restored: hasAudio && verdict.probe.hasAudio,
      completed_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
      /*
        ── 🔴 FRESH METADATA, NOT THE COPY READ AT THE TOP OF THIS FUNCTION ───

        This spread `job.metadata`, which was read BEFORE the reconstruction
        ran — so every diagnostic written during finalization was silently
        erased at the moment the job succeeded. `noteJobDiagnostic` merges
        correctly; this one line then threw the merge away.

        Found 2026-09-09 by the symptom it causes: two jobs completed on the
        ProPainter engine with NO `propainter` key at all, which the code makes
        impossible — every path through `reconstructWithProPainter` writes one.
        Failed jobs kept theirs because the failure path does not patch
        metadata, which is exactly why this looked like "the branch never ran"
        rather than "the record was deleted".

        The cost of the bug was not a broken job; it was that success became
        unobservable. We could not tell whether ProPainter had run, how long it
        took, or whether it had been rescaled — on precisely the jobs where
        those answers matter most.

        The provider's URL still gets cleared: it has served its purpose and
        expires on their schedule, so a dead link is kept out of the row.
      */
      metadata: { ...((await getJobAsService(jobId))?.metadata ?? job.metadata ?? {}), provider_output_url: null },
    });

    // Resolved before the claim; see the note there. Recomputing it here is
    // how the two could disagree after a future edit.
    const subject = owner;
    if (completed && subject) {
      await consumeAiUsage(subject, feature.id);
      /*
        🔴 They are almost certainly not looking at this tab. The model runs for
        minutes, so by the time it lands the member has switched apps and the
        polling has stopped — see lib/ai/notify.ts. Awaited rather than fired
        and forgotten: this runs on the long-lived worker, not on a serverless
        function that freezes at the response, and the push fan-out is bounded
        so it cannot hang the finalizer.
      */
      if (subject.kind === "user") {
        await notifyAiCleanFinished({
          userId: subject.userId,
          jobId,
          audioRestored: hasAudio && verdict.probe.hasAudio,
          // How long the member actually waited, so the copy can choose
          // between "tap to view" (they are probably still here) and "whenever
          // you are" (they left minutes ago). See lib/ai/notification-copy.ts.
          durationMs: Date.now() - startedAt,
        });
      }
    }

    console.info("[ai/finalize] completed", {
      jobId,
      owner: owner.kind,
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
    const failedSubject = subjectFromRow(job);
    if (failedSubject) {
      const entitlement = await getAiEntitlement(failedSubject, feature);
      await releaseAiUsage(failedSubject, feature.id, entitlement.dailyLimit);
    }

    // …and they are told, with the refund stated. A silent failure on a job
    // somebody stopped watching is indistinguishable from one still running.
    if (failedSubject?.kind === "user") {
      await notifyAiCleanFailed({
        userId: failedSubject.userId,
        jobId,
        message: "The cleanup didn't finish. Your allowance wasn't used — you can try again.",
        // The stable code, so a member whose FILE was the problem is told to
        // try a different one rather than to retry the identical thing.
        errorCode: code,
      });
    }

    console.error("[ai/finalize] failed", {
      jobId,
      owner: owner.kind,
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

/* ─────────────────────── the ProPainter reconstruction ────────────────────── */

/**
 * Mean coverage of a finished mask, 0-1, or null when it cannot be measured.
 *
 * 🔴 Null is "unknown", never "empty". An ffprobe that fails to start must not
 * make a good mask look like a failed one and trigger the fallback.
 */
/**
 * Coverage from the stats file the mask build wrote alongside itself.
 *
 * 🔴 Null on anything unexpected, exactly like `measureMaskCoverage` — the two
 * are interchangeable answers to the same question, and "unknown" must never
 * come back as "empty". A file that does not exist is the ordinary case on a
 * build where ffmpeg lacked the `metadata` filter, not an error.
 */
async function readMaskStats(statsPath: string): Promise<number | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    return parseMaskCoverage(await readFile(statsPath, "utf8"));
  } catch {
    return null;
  }
}

async function measureMaskCoverage(maskPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(FFPROBE, buildMaskCoverageArgs(maskPath), { windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    let out = "";
    let settled = false;
    const finish = (v: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, FFPROBE_TIMEOUT_MS * 4);
    child.stdout?.on("data", (c: Buffer) => (out += c.toString()));
    child.on("error", () => finish(null));
    child.on("close", () => finish(parseMaskCoverage(out)));
  });
}

/**
 * Cut a still from the finished video and store it. Returns null on any
 * trouble; never throws, never fails the job.
 *
 * ── 🔴 THE EMPTY-FILE CASE IS THE REAL ONE ──────────────────────────────────
 *
 * `-ss` past the end of a clip is not an error to ffmpeg: it decodes nothing,
 * writes nothing, and EXITS ZERO. So "did it work" cannot be read from the exit
 * code — it has to be read from the bytes, and the retry at zero is what makes
 * the poster survive a duration probe that was wrong or absent (a stream with
 * no duration in its header, a clip shorter than expected). A first frame is a
 * worse poster than a frame a quarter in; it is a far better one than none.
 */
async function makeResultPoster(opts: {
  videoPath: string;
  dir: string;
  ownerId: string;
  feature: AiFeature;
  jobId: string;
  durationSeconds: number | null;
}): Promise<string | null> {
  const posterFile = path.join(opts.dir, "poster.jpg");
  const at =
    opts.durationSeconds && opts.durationSeconds > 0 ? opts.durationSeconds * POSTER_FRACTION : 0;

  const attempt = async (seconds: number): Promise<Buffer | null> => {
    const ok = await runFfmpeg(
      buildPosterArgs({ videoPath: opts.videoPath, outPath: posterFile, seconds }),
      POSTER_BUDGET_MS,
    );
    if (!ok) return null;
    try {
      const { readFile } = await import("node:fs/promises");
      const body = await readFile(posterFile);
      return body.byteLength > 0 ? body : null;
    } catch {
      return null;
    }
  };

  try {
    // The retry only runs when the first attempt asked for a non-zero offset;
    // re-running the identical command would just fail identically.
    const body = (await attempt(at)) ?? (at > 0 ? await attempt(0) : null);
    if (!body) {
      console.warn("[ai/finalize] no poster frame", { jobId: opts.jobId, at });
      return null;
    }
    return await uploadResultPoster({
      ownerId: opts.ownerId,
      feature: opts.feature,
      jobId: opts.jobId,
      body,
    });
  } catch (e) {
    console.warn("[ai/finalize] poster failed", { jobId: opts.jobId, error: String(e) });
    return null;
  }
}

/** One keyframe seek and one JPEG. Ten seconds is already generous. */
const POSTER_BUDGET_MS = 10_000;

/** Run ffmpeg with a fixed argument array. Resolves false rather than throwing. */
function runFfmpeg(args: string[], budgetMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(FFMPEG, args, { windowsHide: true });
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(hard);
      resolve(v);
    };
    const hard = setTimeout(() => {
      child.kill("SIGKILL");
      finish(false);
    }, budgetMs);
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DETECTION OUTPUT ➜ MASK ➜ PROPAINTER ➜ A RECONSTRUCTED PICTURE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Returns the path to a reconstructed video, or null to mean "carry on with
 * what you already have". EVERY failure path returns null: the detector's own
 * output is a finished, watchable video, and losing a member's three-minute
 * wait to a second provider's bad afternoon is a worse outcome than a
 * worse-looking result. Each fallback is written to the job's metadata so the
 * rate is measurable instead of invisible.
 *
 * ⚠️ The mask is uploaded to the SOURCE bucket under the job's own owner prefix
 * and removed in a `finally`. It has to be reachable by URL because Replicate
 * fetches it, and it is signed and short-lived for the same reason every other
 * URL in this pipeline is.
 */
async function reconstructWithProPainter(opts: {
  jobId: string;
  ownerId: string;
  feature: AiFeature;
  dir: string;
  sourceFile: string;
  detectionFile: string;
  sourceProbe: MediaProbe | null;
}): Promise<string | null> {
  const { jobId, ownerId, feature, dir, sourceFile, detectionFile } = opts;
  const maskFile = path.join(dir, "mask.mp4");
  const outFile = path.join(dir, "reconstructed.mp4");

  /*
    ── 🔴 PREFLIGHT: THE CREDENTIAL THIS MACHINE NEEDS ─────────────────────

    The ProPainter call is the only Replicate request that runs on the WORKER,
    and the worker is not where provider credentials live — the frontend is. So
    a deployment can have a perfectly valid token and still fail every job here.

    Checked BEFORE the mask is built, because everything below it is wasted
    otherwise: an ffmpeg pass over every frame, an upload into the member's own
    storage prefix, and a delete to clean it up again — all to reach an API call
    that could never have been made.

    Reported as its own diagnostic so the row says what an operator must DO,
    rather than "failed: submit threw: Error" (which is what it said for two
    days).
  */
  if (!process.env.REPLICATE_API_TOKEN?.trim()) {
    console.error("[ai/finalize] REPLICATE_API_TOKEN is not set on the WORKER — ProPainter cannot run", { jobId });
    await noteJobDiagnostic(jobId, {
      propainter: "no-token-on-worker",
      propainter_hint: "set REPLICATE_API_TOKEN on the worker, or switch the admin engine back to classical",
    });
    return null;
  }

  /*
    The source frame rate, or 30. ProPainter's `save_fps` defaults to 24, so an
    unknown rate must not become a silent resample of the member's video.
  */
  const fps = Math.round(opts.sourceProbe?.frameRate ?? 0) || 30;

  /*
    ── 🔴 A GLYPH MASK, WITH THE RECTANGLE AS A SAFETY NET ────────────────────

    The detector paints a solid block over the whole caption; using that block
    as the mask is what produced the smear the owner reported. `refine: true`
    keeps only the high-contrast letters inside it — measured 12.70% → 8.07% of
    the frame on their video, and the difference between a stretched band and a
    clean reconstruction.

    But the refinement is a heuristic about how captions are DRAWN (bright
    glyphs, dark outline). A caption it cannot see segments to almost nothing,
    and a near-empty mask means the text survives untouched — a silent, total
    failure. So the result is MEASURED, and anything implausibly sparse falls
    back to the rectangle. Too much removal beats none.
  */
  const maskStartedAt = Date.now();
  /*
    ── 🔴 THE COVERAGE COMES OUT OF THIS SAME PASS ───────────────────────────

    Owner, 2026-09-09: "the time in my replicate dashboard of each video is
    lower than the time it actually takes."

    It was, and this was one of the reasons: the mask was written, and then the
    whole file was DECODED A SECOND TIME purely to average its luminance.
    `statsPath` forks the filter output with `split` — one branch to the
    encoder, one to `signalstats` — so every frame is decoded, thresholded and
    morphed exactly once and both answers fall out together.
  */
  /*
    ── 🔴 THE SECOND DETECTOR, BEFORE THE MASK IS BUILT ──────────────────────

    Owner, 2026-09-09: "It not accurate, some parts shows and glitches… fix the
    detector and wire it."

    hjunior29 removed a caption on their clip and left "Bus" and 'S"' standing
    at either end of it — at conf 0.25, 0.15 AND 0.08, so a capability limit
    rather than a threshold. `datalab-to/ocr` was given the same frame and
    returned both with pixel-accurate boxes in 13.4s.

    These boxes are UNIONED into the mask below rather than replacing anything.
    That keeps this a mask change instead of a pipeline change: hjunior29 is
    still the provider whose webhook drives the job, and an empty list leaves
    the filter graph byte-for-byte what it was. Off by default
    (`AI_CLEAN_TEXT_DETECT`), because every frame is a billed prediction.
  */
  const detected = await detectTextBoxes({
    jobId,
    videoPath: sourceFile,
    dir,
    width: opts.sourceProbe?.width ?? 0,
    height: opts.sourceProbe?.height ?? 0,
    durationSeconds: opts.sourceProbe?.durationSeconds ?? null,
  });
  if (detected.detail !== "disabled") {
    console.info("[ai/finalize] text detection", {
      jobId,
      detail: detected.detail,
      boxes: detected.boxes.length,
      framesSampled: detected.framesSampled,
      framesAnswered: detected.framesAnswered,
      coveragePercent: Number((detected.coverage * 100).toFixed(2)),
    });
  }

  const statsFile = path.join(dir, "mask-stats.txt");
  const built = await runFfmpeg(
    buildTextMaskArgs({
      sourcePath: sourceFile,
      blackPath: detectionFile,
      outPath: maskFile,
      fps,
      refine: true,
      statsPath: statsFile,
      extraBoxes: detected.boxes,
    }),
    FFMPEG_HARD_TIMEOUT_MS,
  );
  if (!built) {
    console.warn("[ai/finalize] mask build failed", { jobId });
    await noteJobDiagnostic(jobId, { propainter: "mask-build-failed" });
    return null;
  }

  /*
    🔴 The second pass is kept as a FALLBACK, not deleted. If the stats file is
    missing or unreadable — a filter ffmpeg declined, a build without the
    `metadata` filter — a null coverage would disable the sparse-mask guard
    entirely and ship whatever the refinement produced. Re-measuring costs a
    pass on a path nothing normally takes; not measuring costs the member their
    text.
  */
  let coverage = (await readMaskStats(statsFile)) ?? (await measureMaskCoverage(maskFile));
  let maskKind: "refined" | "rectangle" = "refined";

  /*
    The rectangle for comparison. Built to a second file so the refined one is
    never lost if this pass fails — and only when the refined mask looks thin,
    so the ordinary case pays nothing for the check.
  */
  if (coverage !== null && coverage < 0.001) {
    // Essentially empty: not worth comparing against anything, just fall back.
    maskKind = "rectangle";
  } else if (coverage !== null) {
    const rectFile = path.join(dir, "mask-rect.mp4");
    const rectStats = path.join(dir, "mask-rect-stats.txt");
    const rectBuilt = await runFfmpeg(
      buildTextMaskArgs({
        sourcePath: sourceFile,
        blackPath: detectionFile,
        outPath: rectFile,
        fps,
        refine: false,
        statsPath: rectStats,
      }),
      FFMPEG_HARD_TIMEOUT_MS,
    );
    const rectCoverage = rectBuilt
      ? ((await readMaskStats(rectStats)) ?? (await measureMaskCoverage(rectFile)))
      : null;
    if (rectCoverage && coverage / rectCoverage < MASK_REFINE_MIN_RATIO) {
      // The segmentation found almost none of what the detector marked. The
      // caption is not bright-on-dark; use the block.
      const { copyFile } = await import("node:fs/promises");
      await copyFile(rectFile, maskFile).catch(() => {});
      coverage = rectCoverage;
      maskKind = "rectangle";
    }
  }

  /*
    🔴 An abnormally large mask is FLAGGED, not silently processed. Past about a
    third of the frame there is no longer enough surrounding picture for a
    flow-based inpainter to borrow from, and the output will be invented rather
    than reconstructed. It still runs — refusing would leave the member with
    nothing — but the row records it, so "why did this one look wrong?" has an
    answer without re-deriving it.
  */
  const oversized = coverage !== null && coverage > 0.33;

  console.info("[ai/finalize] mask built", {
    jobId,
    maskKind,
    coveragePercent: coverage === null ? null : Number((coverage * 100).toFixed(2)),
    oversized,
    sourceSize: opts.sourceProbe?.width ? `${opts.sourceProbe.width}x${opts.sourceProbe.height}` : null,
    fps,
    buildMs: Date.now() - maskStartedAt,
  });

  // The mask lives beside the job's own objects, never at a guessable path.
  const maskKey = `${ownerId}/${feature.replace(/[^a-z0-9]/gi, "").toLowerCase()}/${jobId}/mask.mp4`;
  const admin = createAdminClient();
  let maskUrl: string;
  try {
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(maskFile);
    const up = await admin.storage.from(AI_SOURCE_BUCKET).upload(maskKey, body, {
      contentType: "video/mp4",
      upsert: true,
    });
    if (up.error) throw new Error(up.error.message);
    const signed = await admin.storage.from(AI_SOURCE_BUCKET).createSignedUrl(maskKey, 3600);
    if (signed.error || !signed.data?.signedUrl) throw new Error(signed.error?.message ?? "no signed url");
    maskUrl = signed.data.signedUrl;
  } catch (e) {
    console.warn("[ai/finalize] mask upload failed", { jobId, error: e instanceof Error ? e.name : "unknown" });
    await noteJobDiagnostic(jobId, { propainter: "mask-upload-failed" });
    return null;
  }

  try {
    const sourceUrl = await signSourceUrl(
      // the job's own source path, re-signed for the provider's fetch
      (await getJobAsService(jobId))?.source_path ?? "",
    );
    const startedAt = Date.now();
    /*
      🔴 The source dimensions go WITH the request. ProPainter picks a
      `resize_ratio` from them so RAFT's optical flow fits in GPU memory — three
      jobs in a row died of CUDA OOM there while this was omitted and the ratio
      was hard-coded to 1. The reconstruction is scaled back to the source's
      exact size below, so the member's video keeps its resolution either way.
    */
    const result = await runProPainter({
      videoUrl: sourceUrl,
      maskUrl,
      fps,
      width: opts.sourceProbe?.width ?? null,
      height: opts.sourceProbe?.height ?? null,
    });
    if (!result.ok) {
      console.warn("[ai/finalize] reconstruction declined", { jobId, reason: result.reason });
      await noteJobDiagnostic(jobId, { propainter: `failed: ${result.reason}` });
      return null;
    }

    /*
      🔴 A BREADCRUMB BEFORE THE DOWNLOAD, NOT AFTER IT.

      The owner's job sat in `finalizing` for eleven minutes AFTER ProPainter
      had succeeded, and nothing in the row said which step it was on. Written
      before the transfer starts, this is what turns "it has been loading" into
      a named stage next time — the download now has timeouts, but the same
      blindness would apply to any step that grows one.
    */
    await noteJobDiagnostic(jobId, { propainter: "downloading-output", propainter_predict_s: result.predictTimeSeconds });
    const downloadStartedAt = Date.now();
    const bytes = await downloadToFile(result.outputUrl, outFile, AI_CLEAN_LIMITS.maxResultSize);

    /*
      ── 🔴 PUT IT BACK TO THE SOURCE'S EXACT SIZE ──────────────────────────

      ProPainter rounds each dimension up to a multiple of 8 and returns the
      video at THAT size, even with `resize_ratio: 1, width: -1, height: -1`.
      Measured: 480x854 in, 480x864 out, and the extra rows hold real picture
      rather than black bars — the frame is stretched by 1.2%, not padded.

      Nothing further down would catch it: the mux stream-copies what it is
      given, and `checkFinalProbe` compares duration and codecs, not geometry.
      So the member would quietly receive a subtly taller video than the one
      they sent.
    */
    const reconstructedProbe = await probeMedia(outFile);
    const srcW = opts.sourceProbe?.width ?? null;
    const srcH = opts.sourceProbe?.height ?? null;
    let finalPath = outFile;
    let resized: string | null = null;

    if (
      srcW &&
      srcH &&
      reconstructedProbe?.width &&
      reconstructedProbe?.height &&
      (reconstructedProbe.width !== srcW || reconstructedProbe.height !== srcH)
    ) {
      const scaledFile = path.join(dir, "reconstructed-scaled.mp4");
      const ok = await runFfmpeg(
        buildResizeToSourceArgs({ inPath: outFile, outPath: scaledFile, width: srcW, height: srcH, fps }),
        FFMPEG_HARD_TIMEOUT_MS,
      );
      if (ok) {
        finalPath = scaledFile;
        resized = `${reconstructedProbe.width}x${reconstructedProbe.height}->${srcW}x${srcH}`;
      } else {
        /*
          The scale failed. Carry on with the model's own size rather than
          losing the whole reconstruction over ten pixels — a very slightly
          taller video that has its text removed beats no video at all — but
          record it, because a silent aspect change is exactly the class of
          bug that goes unnoticed for weeks.
        */
        console.warn("[ai/finalize] could not scale reconstruction back", { jobId });
        resized = "failed";
      }
    }

    /*
      ── 🔴 ONLY THE MASKED REGION IS TAKEN FROM THE RECONSTRUCTION ──────────

      Owner, 2026-09-09, on a 1080x1920 clip: "It not accurate, some parts shows
      and glitches… the current result is poor."

      The job's own row said why: `propainter_resized = 480x848->1080x1920` with
      `mask_coverage = 8.2`. ProPainter clamps its working resolution internally
      whatever we send — "leave it alone" produced a 480p reconstruction of a
      1080p video — and we then upscaled the WHOLE FRAME 2.25x and shipped it.

      91.8% of that frame had nothing wrong with it. There was no text there,
      nothing to repair, and we replaced every pixel of it with a 480p upscale
      because the code treated ProPainter's output as the picture rather than as
      a patch.

      `maskedmerge` takes the member's original everywhere the mask is black and
      the reconstruction only where it is white. The untouched majority keeps
      its real detail, and the repair is confined to the region that asked for
      one.

      🔴 IT ALSO CHANGES WHAT A MISS LOOKS LIKE, which is the "glitches" half of
      the report. Text the mask did not cover was being re-rendered from a 480p
      upscale, so a surviving caption came back as a soft smeared remnant. It is
      now untouched source — so a detector miss shows the original text, clearly
      and honestly, instead of a corruption of it.

      ⚠️ FALLS BACK RATHER THAN FAILING. If the composite does not run we ship
      the full reconstruction, which is what shipped before this existed. Worse
      looking, still a finished video — and the row records which one happened.
    */
    let composited: "ok" | "skipped" | "failed" = "skipped";
    if (srcW && srcH) {
      const mergedFile = path.join(dir, "composited.mp4");
      const ok = await runFfmpeg(
        buildMaskedCompositeArgs({
          sourcePath: sourceFile,
          reconstructedPath: finalPath,
          maskPath: maskFile,
          outPath: mergedFile,
          width: srcW,
          height: srcH,
          fps,
        }),
        FFMPEG_HARD_TIMEOUT_MS,
      );
      if (ok) {
        finalPath = mergedFile;
        composited = "ok";
      } else {
        console.warn("[ai/finalize] masked composite failed, shipping the full reconstruction", { jobId });
        composited = "failed";
      }
    }

    console.info("[ai/finalize] reconstructed", {
      jobId,
      model: AI_CLEAN_PROPAINTER.model,
      predictSeconds: result.predictTimeSeconds,
      elapsedMs: Date.now() - startedAt,
      bytes,
      downloadMs: Date.now() - downloadStartedAt,
      sourceSize: srcW && srcH ? `${srcW}x${srcH}` : null,
      providerSize: reconstructedProbe?.width ? `${reconstructedProbe.width}x${reconstructedProbe.height}` : null,
      resized,
      composited,
    });
    await noteJobDiagnostic(jobId, {
      propainter: "ok",
      propainter_predict_s: result.predictTimeSeconds,
      // What the reconstruction was actually asked to do, so a bad-looking
      // result can be explained without re-running anything.
      mask_kind: maskKind,
      mask_coverage: coverage === null ? null : Number((coverage * 100).toFixed(2)),
      ...(oversized ? { mask_oversized: true } : {}),
      ...(resized ? { propainter_resized: resized } : {}),
      // What the second detector contributed, so a result can be explained
      // without re-running anything.
      text_detect: detected.detail,
      text_detect_boxes: detected.boxes.length,
      // Which picture the member actually received: the original with a patched
      // region, or the whole reconstruction because the composite could not run.
      propainter_composited: composited,
    });
    return finalPath;
  } catch (e) {
    console.warn("[ai/finalize] reconstruction threw", { jobId, error: e instanceof Error ? e.name : "unknown" });
    await noteJobDiagnostic(jobId, { propainter: "threw" });
    return null;
  } finally {
    // Never leave the mask behind: it is worthless after the run and it counts
    // against the same storage ceiling the member's own files do.
    void admin.storage.from(AI_SOURCE_BUCKET).remove([maskKey]).catch(() => {});
  }
}
