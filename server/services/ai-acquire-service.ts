import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { AI_CLEAN_LIMITS } from "@/lib/ai/config";
import { aiFeature } from "@/lib/ai/jobs";
import { getJobAsService, noteJobDiagnostic, recordUploadedSource, transitionJob } from "@/lib/ai/job-store";
import { validateAiSourceUrl } from "@/lib/ai/source-url";
import { AI_SOURCE_BUCKET, aiSourceKey } from "@/lib/ai/storage";
import { subjectFromRow, subjectOwnerId } from "@/lib/ai/subject";
import { dispatchProviderSubmit } from "@/lib/ai/submit-dispatch";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { releaseAiUsage } from "@/lib/ai/usage";
import { createAdminClient } from "@/lib/supabase/admin";
import { probeMedia } from "@/server/services/ai-finalize-service";
import { resolveDownload } from "@/server/services/download-service";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI PART 6 — fetching the member's video from a link they pasted
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Runs on the WORKER only. It needs yt-dlp, a real filesystem and minutes of
 * runtime, none of which Vercel has — the same three reasons the finalizer
 * lives here.
 *
 * ── 🔴 IT REUSES THE DOWNLOADER, IT DOES NOT FETCH ──────────────────────────
 *
 * `resolveDownload` is the pipeline that already serves every download on this
 * site: extraction, the format ladder, codec normalisation, the disk cache.
 * Going around it with a plain `fetch` would mean a second, less careful way of
 * turning a page URL into bytes — and it is precisely the "just fetch what the
 * user gave us" shape this whole part exists to avoid.
 *
 * So the acquisition is not new capability. It is the downloader, pointed at
 * private storage instead of at the member's browser.
 *
 * ── The order, and why the ceilings are HERE ────────────────────────────────
 *
 *   claim → re-validate the url → resolve → stream to disk under a cap →
 *   probe → check duration → upload → record → hand back to the frontend
 *
 * `/api/ai/jobs` could not check the size or the duration: nothing had been
 * fetched, so there was nothing to measure and any number would have been a
 * fabrication. This is the first moment there is a real file, so this is where
 * `AI_CLEAN_LIMITS` is enforced — the same discipline `/start` follows for an
 * upload, where what storage reports replaces what the browser claimed.
 *
 * ── Every failure refunds ───────────────────────────────────────────────────
 *
 * The allowance was reserved at `/start`, before any of this. A link we could
 * not fetch, a video too long, a provider that refuses — none of them are the
 * member's fault, and every one releases the slot before failing the job.
 */

export type AcquireErrorCode =
  | "ACQUISITION_FAILED"
  | "UNSUPPORTED_SOURCE"
  | "FILE_TOO_LARGE"
  | "VIDEO_TOO_LONG"
  | "SUBMIT_FAILED";

export type AcquireOutcome =
  | { ok: true; jobId: string; bytes: number; durationSeconds: number | null }
  /** Nothing to do: another worker has it, or it has moved on. */
  | { ok: true; jobId: string; skipped: string }
  | { ok: false; jobId: string; code: AcquireErrorCode; detail: string };

/** Bytes we are willing to pull before giving up. The member's own ceiling. */
const MAX_BYTES = AI_CLEAN_LIMITS.maxFileSize;

export async function acquireAiJobSource(jobId: string): Promise<AcquireOutcome> {
  const startedAt = Date.now();
  const dir = path.join(tmpdir(), `frenz-ai-acquire-${jobId}`);
  let claimed = false;
  let subject: ReturnType<typeof subjectFromRow> = null;
  let dailyLimit = 0;
  let featureId: ReturnType<typeof aiFeature> = null;

  try {
    const job = await getJobAsService(jobId);
    if (!job) return { ok: false, jobId, code: "ACQUISITION_FAILED", detail: "job not found" };

    const feature = aiFeature(job.feature);
    if (!feature) return { ok: false, jobId, code: "ACQUISITION_FAILED", detail: "unknown feature" };
    featureId = feature;

    if (job.source_kind !== "url" || !job.source_url) {
      return { ok: true, jobId, skipped: "not a link job" };
    }
    if (job.status !== "acquiring") {
      // /start already claimed it into `acquiring`; anything else means it has
      // been cancelled, swept, or another delivery got here first.
      return { ok: true, jobId, skipped: `status is ${job.status}` };
    }
    claimed = true;

    /*
      ── 🔴 THE OWNER AND THE ALLOWANCE ARE RESOLVED FIRST ────────────────────

      Before any check that can fail, because every one of those checks refunds
      — and a refund needs both the subject and the day's limit. Resolving them
      afterwards meant `dailyLimit` was still 0 on the earliest failure paths,
      so `refund()` returned silently and the member lost a slot to a video we
      never even fetched.

      Same reasoning as Part 4's rule that the owner is resolved BEFORE the
      `finalizing` claim: work out who this belongs to while failing is still
      free.
    */
    subject = subjectFromRow(job);
    if (!subject) {
      await fail(jobId, "ACQUISITION_FAILED", "job has no resolvable owner");
      return { ok: false, jobId, code: "ACQUISITION_FAILED", detail: "no owner" };
    }
    const ownerId = subjectOwnerId(subject);
    dailyLimit = (await getAiEntitlement(subject, feature)).dailyLimit;

    /*
      🔴 THE ALLOW-LIST, AGAIN, ON THE MACHINE THAT WILL ACTUALLY FETCH.

      The create route already ran this. Running it here is not redundancy for
      its own sake: this is the process that makes the outbound request, the row
      could have been written by an older build, and the allow-list could have
      narrowed since. A check that lives only at the front door is one deploy
      away from being bypassed.
    */
    const link = validateAiSourceUrl(job.source_url);
    if (!link.ok) {
      await fail(jobId, "UNSUPPORTED_SOURCE", `stored url refused: ${link.reason}`);
      await refund(job, feature.id);
      return { ok: false, jobId, code: "UNSUPPORTED_SOURCE", detail: link.reason };
    }

    await mkdir(dir, { recursive: true });

    /*
      ── The download ────────────────────────────────────────────────────────

      No format id: `resolveDownload` falls back to the first format of the
      requested kind, and the ladder is already ordered best-first (and
      H.264-first on TikTok, which is what makes it fast AND playable). Asking
      for a specific tier here would be this feature second-guessing the
      downloader's own quality logic.
    */
    let resolved;
    try {
      resolved = await resolveDownload(link.url, "", "video", "video", {});
    } catch (e) {
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      await fail(jobId, "ACQUISITION_FAILED", detail);
      await refund(job, feature.id);
      return { ok: false, jobId, code: "ACQUISITION_FAILED", detail };
    }

    const ext = (resolved.ext || "mp4").toLowerCase();
    const localFile = path.join(dir, `source.${ext}`);
    const bytes = await streamToFile(resolved.stream, localFile, MAX_BYTES);
    if (bytes === null) {
      await fail(jobId, "FILE_TOO_LARGE", `source exceeded ${MAX_BYTES} bytes`);
      await refund(job, feature.id);
      return { ok: false, jobId, code: "FILE_TOO_LARGE", detail: "too large" };
    }
    if (bytes <= 0) {
      await fail(jobId, "ACQUISITION_FAILED", "the source produced no bytes");
      await refund(job, feature.id);
      return { ok: false, jobId, code: "ACQUISITION_FAILED", detail: "empty" };
    }

    /*
      What we actually got. The ceilings apply to THIS, not to anything the
      browser or the platform claimed — a page that says "0:12" and delivers
      four minutes is ordinary, and the provider bills by the second.
    */
    const probe = await probeMedia(localFile);
    if (!probe?.hasVideo) {
      await fail(jobId, "UNSUPPORTED_SOURCE", "the fetched file has no video stream");
      await refund(job, feature.id);
      return { ok: false, jobId, code: "UNSUPPORTED_SOURCE", detail: "no video stream" };
    }
    const durationSeconds = probe.durationSeconds ?? null;
    if (durationSeconds !== null && durationSeconds > feature.maxDurationSeconds) {
      await fail(jobId, "VIDEO_TOO_LONG", `${Math.round(durationSeconds)}s exceeds ${feature.maxDurationSeconds}s`);
      await refund(job, feature.id);
      return { ok: false, jobId, code: "VIDEO_TOO_LONG", detail: "too long" };
    }

    /*
      ── 🔴 THE RESOLUTION CEILING, APPLIED BEFORE A PROVIDER SECOND IS BILLED ─

      This is the ONE point in the whole flow where a resolution is known before
      anything has been submitted: the worker has the file on local disk and
      ffprobe in its hand, and the detector has not been called yet. An upload
      cannot be checked here at all — it goes browser-to-storage and is
      dispatched from Vercel, which has no ffprobe — so a link job is where the
      cheap version of this check lives, and it is worth taking.

      Refused as UNSUPPORTED_SOURCE rather than a new code: from the member's
      side a video this large is a file the tool does not take, which is exactly
      what that sentence already says. The allowance is refunded either way.
    */
    const pixels = (probe.width ?? 0) * (probe.height ?? 0);
    if (pixels > AI_CLEAN_LIMITS.maxPixels) {
      await fail(
        jobId,
        "UNSUPPORTED_SOURCE",
        `${probe.width}x${probe.height} exceeds ${AI_CLEAN_LIMITS.maxPixels}px`,
      );
      await refund(job, feature.id);
      return { ok: false, jobId, code: "UNSUPPORTED_SOURCE", detail: "resolution over ceiling" };
    }

    /*
      🔴 THE KEY IS BUILT THE SAME WAY THE UPLOAD PATH BUILDS IT.

      `aiSourceKey(ownerId, feature, jobId, ext)` — the same function, from the
      same owner resolution. `/api/ai/jobs/[id]/result` checks
      `pathBelongsTo(path, subjectOwnerId(subject), id)`, so a writer that
      invented its own layout would hand a member a video they are then refused.
      That is exactly how every guest job died once already.
    */
    const key = aiSourceKey(ownerId, feature.id, jobId, ext);
    const admin = createAdminClient();
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(localFile);
    const up = await admin.storage.from(AI_SOURCE_BUCKET).upload(key, body, {
      contentType: probe.formatName?.includes("mp4") ? "video/mp4" : `video/${ext}`,
      upsert: true,
    });
    if (up.error) {
      await fail(jobId, "ACQUISITION_FAILED", `upload failed: ${up.error.message}`);
      await refund(job, feature.id);
      return { ok: false, jobId, code: "ACQUISITION_FAILED", detail: "upload failed" };
    }

    await recordUploadedSource(jobId, {
      path: key,
      size: bytes,
      mimeType: "video/mp4",
      durationSeconds,
      // 🔴 `acquiring`, not the default `queued`. /start already moved the row,
      // and an update filtered on the wrong status writes nothing and says
      // nothing — see the note on recordUploadedSource.
      expectStatus: "acquiring",
    });

    await noteJobDiagnostic(jobId, {
      acquired_from: link.platform,
      acquired_bytes: bytes,
      acquired_ms: Date.now() - startedAt,
      // The member's history should read as the video, not as a uuid. yt-dlp's
      // title is the closest thing to what they would call it.
      ...(resolved.title ? { source_name: `${resolved.title}.${ext}` } : {}),
    });

    console.info("[ai/acquire] fetched", {
      jobId,
      platform: link.platform,
      bytes,
      durationSeconds,
      elapsedMs: Date.now() - startedAt,
      owner: subject.kind,
    });

    /*
      ── Hand it back to the frontend to submit ──────────────────────────────

      The provider credentials live there and only there. See submit-dispatch.ts
      for why that is worth one HTTP hop.
    */
    const submitted = await dispatchProviderSubmit(jobId);
    if (!submitted.submitted) {
      await fail(jobId, "SUBMIT_FAILED", submitted.detail);
      await refund(job, feature.id);
      console.error("[ai/acquire] submit failed", { jobId, reason: submitted.reason, detail: submitted.detail });
      return { ok: false, jobId, code: "SUBMIT_FAILED", detail: submitted.detail };
    }

    return { ok: true, jobId, bytes, durationSeconds };
  } catch (e) {
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    if (claimed) {
      await fail(jobId, "ACQUISITION_FAILED", detail);
      const row = await getJobAsService(jobId);
      if (row && featureId) await refund(row, featureId.id);
    }
    console.error("[ai/acquire] threw", { jobId, detail });
    return { ok: false, jobId, code: "ACQUISITION_FAILED", detail };
  } finally {
    // Always. Two videos per failed job on disk fills a worker within a day and
    // then fails everything for an unrelated-looking reason.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  async function refund(row: Parameters<typeof subjectFromRow>[0], feature: Parameters<typeof releaseAiUsage>[1]) {
    const who = subjectFromRow(row);
    if (!who || !dailyLimit) return;
    await releaseAiUsage(who, feature, dailyLimit).catch(() => {});
  }
}

/** Mark the job failed, from `acquiring` only. Compare-and-set, like everything else. */
async function fail(jobId: string, code: AcquireErrorCode, detail: string): Promise<void> {
  await transitionJob(jobId, ["acquiring"], "failed", {
    error_code: code,
    error_message: detail.slice(0, 2000),
    completed_at: new Date().toISOString(),
  }).catch(() => {});
}

/**
 * Stream to disk, stopping the moment the cap is passed.
 *
 * 🔴 Counted while it arrives, not checked afterwards. A `Content-Length` is a
 * claim by the other end, and a server that lies about it — or omits it, which
 * is normal for a chunked CDN response — would otherwise fill the worker's disk
 * before anybody measured anything. Returns null when the cap is exceeded.
 */
async function streamToFile(
  stream: ReadableStream<Uint8Array>,
  dest: string,
  maxBytes: number,
): Promise<number | null> {
  let written = 0;
  let tooLarge = false;

  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      written += chunk.byteLength;
      if (written > maxBytes) {
        tooLarge = true;
        controller.error(new Error("too large"));
        return;
      }
      controller.enqueue(chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(stream.pipeThrough(counter) as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(dest),
    );
  } catch {
    if (tooLarge) return null;
    throw new Error("the download did not complete");
  }

  const info = await stat(dest).catch(() => null);
  return info?.size ?? written;
}
