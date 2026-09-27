import "server-only";

import { settleAiCredits } from "@/lib/ai/credits/store";
import { AiJobError, aiErrorMessage, isAiJobError } from "@/lib/ai/errors";
import { releaseJobFunding } from "@/lib/ai/funding";
import { recordJobEvent } from "@/lib/ai/job-events";
import { getJobAsService, transitionJob } from "@/lib/ai/job-store";
import type { AiJobRow } from "@/lib/ai/jobs";
import { notifyAiJobFailed, notifyAiJobFinished } from "@/lib/ai/notify";
import { openProviderRun } from "@/lib/ai/providers/runs";
import { AI_SOURCE_BUCKET } from "@/lib/ai/storage";
import { subjectFromRow } from "@/lib/ai/subject";
import { createVoiceClone, getVoiceCloneByJob } from "@/lib/ai/voice-clone/clones";
import { readVoiceCloneMeta } from "@/lib/ai/voice-clone/job-meta";
import { EMPTY_VOICE_CLONE_LABELS, normalizeVoiceCloneLabels, providerLabels } from "@/lib/ai/voice-clone/labels";
import { voiceCloneProviderFor, type VoiceCloneSample } from "@/lib/ai/voice-clone/provider";
import { settleAiWalletCharge } from "@/lib/ai/wallet/server";
import { getLandingSettings } from "@/lib/landing/settings";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MAKING THE VOICE — the whole provider step, in one function
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Runs in the `after()` of the request that started the job. Reads the samples
 * back out of our bucket, asks the provider for a voice, writes the row,
 * completes the job, settles the money, tells the member.
 *
 * ── 🔴 THIS IS NOT A FINALIZER, AND DELIBERATELY HAS NO LEASE ───────────────
 *
 * The video tools' finalizer is lease-claimed and retried because several
 * things can call it: a webhook, a reconciler, a recovery sweep, an operator's
 * button. This has exactly ONE caller, once, and the job is already
 * `processing` when it runs — which is itself the claim, since the first thing
 * it does is fail or complete out of that one state with a compare-and-set.
 *
 * ── 🔴 processing → finalizing → completed, NEVER processing → completed ────
 *
 * The status machine (lib/ai/jobs.ts `TRANSITIONS`) forbids the short cut, and
 * `transitionJob` THROWS on it rather than returning null. The first version of
 * this file took the short cut, and the result was the worst possible shape of
 * bug: the voice was made at the vendor, the library row was written — and then
 * the throw was caught by the handler below, which failed the job and refunded
 * it. The owner saw "we could not build that voice" next to a voice that worked
 * perfectly (2026-09-27). A tool with no file to finalize still walks the same
 * three states as every other one.
 *
 * ── 🔴 ONCE THE VOICE EXISTS, THIS JOB CAN NEVER BE REPORTED AS FAILED ──────
 *
 * That is the invariant the bug above broke, and it is now enforced by
 * structure rather than by care: everything that can fail HONESTLY happens
 * before the voice is made, and everything after it is best-effort. A
 * bookkeeping problem after the fact is loud in the log and invisible to the
 * member, because the thing they asked for is sitting in their library.
 *
 * If the library row itself cannot be written, the voice at the vendor is
 * DELETED before the job fails — otherwise it would hold a slot for ever with
 * nothing in our database pointing at it.
 *
 * ── 🔴 WHY A FAILURE HERE IS NEVER RETRIED AUTOMATICALLY ────────────────────
 *
 * A retry would need the samples, which is fine, but it would also risk a
 * SECOND voice on the account for one job — a slot leaked with nothing in our
 * database pointing at it. The unique index on `job_id` stops a second ROW, but
 * not a second provider voice. So a failure ends the job and refunds it, and
 * the member presses the button again. A clone takes seconds; asking once more
 * costs them nothing and cannot leak a slot.
 */
export type VoiceCloneRunResult = { ok: true; jobId: string; cloneId: string; skipped?: string } | { ok: true; jobId: string; skipped: string; cloneId?: undefined } | { ok: false; jobId: string; code: string; detail: string };

/** A sample is read whole to hand to a multipart form; the ceiling is the operator's own, re-applied here. */
async function readSample(path: string, maxBytes: number): Promise<Buffer> {
  const { data, error } = await createAdminClient().storage.from(AI_SOURCE_BUCKET).download(path);
  if (error || !data) throw new AiJobError("STORAGE_ERROR", `sample download failed: ${error?.message ?? "no body"}`);
  const buf = Buffer.from(await data.arrayBuffer());
  if (buf.byteLength === 0) throw new AiJobError("INVALID_INPUT", "a sample was empty");
  if (buf.byteLength > maxBytes) throw new AiJobError("FILE_TOO_LARGE", `a sample was ${buf.byteLength} bytes`);
  return buf;
}

export async function runVoiceClone(jobId: string): Promise<VoiceCloneRunResult> {
  const job = await getJobAsService(jobId);
  if (!job) return { ok: false, jobId, code: "JOB_NOT_FOUND", detail: "no row" };
  if (job.feature !== "ai_voice_clone") return { ok: false, jobId, code: "INTERNAL_ERROR", detail: `feature ${job.feature}` };
  if (job.status !== "processing") return { ok: true, jobId, skipped: `status ${job.status}` };
  const meta = readVoiceCloneMeta(job.metadata);
  const ownerId = job.user_id;
  if (!meta || !ownerId) {
    await failVoiceCloneJob(job, "INTERNAL_ERROR", "row has no voice-clone contract");
    return { ok: false, jobId, code: "INTERNAL_ERROR", detail: "no contract" };
  }
  // a second run of a job that already produced its voice is a no-op, not a second voice
  if (meta.clone_id) return { ok: true, jobId, cloneId: meta.clone_id, skipped: "already cloned" };

  const settings = await getLandingSettings();
  const config = settings.frenzAiVoiceClone;
  const provider = voiceCloneProviderFor(config);
  const startedAt = Date.now();
  const test = (job.metadata?.provider_plan as { test?: unknown } | null)?.test === true;

  try {
    /* ── the samples, back out of our own bucket ────────────────────────── */
    const samples: VoiceCloneSample[] = [];
    for (const s of meta.samples) {
      samples.push({ bytes: await readSample(s.path, config.samples.maximumBytes), filename: s.name.replace(/[^\p{L}\p{M}\p{N} ._-]/gu, "").slice(0, 100) || "sample.mp3", mime: s.mime });
    }

    /* ── the voice ──────────────────────────────────────────────────────── */
    /*
      🔴 THE LABELS THE VENDOR'S OWN FORM ASKS FOR (2026-09-27). This used to
      send `{ source, owner }` and nothing else, so a Nigerian voice arrived at
      the vendor unlabelled — the owner's "isn't accurate like the main eleven
      lab … that has full Control". The accent itself is learned from the
      audio; these describe the voice on the account and in the member's
      library (lib/ai/voice-clone/labels.ts is honest about the difference).
    */
    const labels = normalizeVoiceCloneLabels(meta.labels ?? null);
    const made = await provider.clone({
      name: meta.name,
      description: meta.description,
      samples,
      labels: providerLabels(labels, ownerId.slice(0, 8)),
    });

    await openProviderRun({
      jobId: job.id,
      userId: ownerId,
      feature: "ai_voice_clone",
      mode: "voice_clone",
      stage: "voice",
      provider: "elevenlabs",
      model: config.model,
      modelVersion: null,
      providerJobId: `clone:${job.id}`,
      test,
      latencyMs: Date.now() - startedAt,
      status: "succeeded",
      costEstimateUsdCents: (job.metadata?.provider_cost_estimate as { totalUsdCents?: number } | null)?.totalUsdCents ?? null,
      metadata: { samples: samples.length, bytes: samples.reduce((a, s) => a + s.bytes.byteLength, 0) },
    }).catch(() => null);

    /* ── the row, BEFORE the job says completed ─────────────────────────── */
    /*
      🔴 The order matters. A completed job whose voice is not in the library
      would be a member told "your voice is ready" with nothing to use — and,
      worse, a provider voice occupying a slot with no row pointing at it. The
      voice row first; the job's completion is the acknowledgement that it
      exists.
    */
    const first = meta.samples[0] ?? null;
    /*
      🔴 A VOICE WITH NO ROW IS A SLOT NOBODY CAN RECLAIM. If the insert fails,
      the vendor's voice is removed before the error is re-thrown — otherwise it
      would sit on the account for ever with nothing in our database pointing at
      it, invisible to the member and to the operator alike.
    */
    const clone = await createVoiceClone({
      userId: ownerId,
      jobId: job.id,
      name: meta.name,
      description: meta.description,
      provider: provider.id,
      providerVoiceId: made.providerVoiceId,
      sampleCount: meta.samples.length,
      sampleBytes: meta.samples.reduce((a, s) => a + s.size, 0),
      sampleSeconds: typeof job.metadata?.sample_seconds === "number" ? job.metadata.sample_seconds : null,
      previewPath: first?.path ?? null,
      previewMime: first?.mime ?? null,
      languageCode: labels.language,
      labels: labels as unknown as Record<string, unknown>,
      consent: meta.consent ?? { at: new Date().toISOString(), name: "", statement: config.consentStatement },
    }).catch(async (e) => {
      await provider.remove(made.providerVoiceId).catch((cleanup) => console.error("[vc/run] orphan voice left at the vendor", { jobId: job.id, providerVoiceId: made.providerVoiceId, error: String(cleanup).slice(0, 200) }));
      throw e;
    });

    /*
      ── the two lawful steps ────────────────────────────────────────────────
      `processing → finalizing → completed`. There is no file to finalize, so
      `finalizing` lasts microseconds — but the machine forbids the short cut
      and `transitionJob` throws on it, which is exactly how the first version
      of this ended up failing jobs whose voice had already been made.
    */
    const completed = await finishVoiceCloneJob(job.id, job.metadata ?? {}, clone.id);
    if (completed) {
      const settled = job.funding_source === "credits" ? await settleAiCredits(job.id) : job.funding_source === "balance" ? await settleAiWalletCharge(ownerId, job.id) : true;
      if (!settled) console.error("[vc/run] settle found nothing to settle", { jobId: job.id, userId: ownerId, funding: job.funding_source });
      await recordJobEvent(job.id, "clone.created", { cloneId: clone.id, samples: meta.samples.length, settled, elapsedMs: Date.now() - startedAt }).catch(() => null);
      await notifyAiJobFinished({ userId: ownerId, jobId: job.id, feature: "ai_voice_clone", audioRestored: null, durationMs: Date.now() - Date.parse(job.started_at ?? job.created_at) }).catch(() => null);
    } else {
      /*
        🔴 LOUD, AND STILL A SUCCESS. The voice is made and in their library, so
        telling the member it failed would be a lie — and refunding here would
        hand back a free voice they kept. This is an operator's problem.
      */
      console.error("[vc/run] the voice was made but the row could not be completed", { jobId: job.id, userId: ownerId, cloneId: clone.id });
    }
    console.info("[vc/run] cloned", { jobId: job.id, userId: ownerId, cloneId: clone.id, samples: meta.samples.length, elapsedMs: Date.now() - startedAt, completed });
    return { ok: true, jobId: job.id, cloneId: clone.id };
  } catch (e) {
    const code = isAiJobError(e) ? e.code : "PROVIDER_ERROR";
    const detail = e instanceof Error ? e.message : String(e);
    /*
      🔴 THE GUARD THE 2026-09-27 BUG EARNED. If a voice reached the library
      before this threw, the member HAS what they asked for — so the job is
      completed rather than failed, nothing is refunded, and the fault is the
      operator's to read in the log. Reported as ok, because for the member it
      is.
    */
    const made = await getVoiceCloneByJob(ownerId, job.id).catch(() => null);
    if (made) {
      console.error("[vc/run] threw AFTER the voice was made — completing rather than failing", { jobId: job.id, userId: ownerId, cloneId: made.id, code, detail: detail.slice(0, 300) });
      await finishVoiceCloneJob(job.id, job.metadata ?? {}, made.id);
      await recordJobEvent(job.id, "clone.created", { cloneId: made.id, recovered: true, code, elapsedMs: Date.now() - startedAt }).catch(() => null);
      return { ok: true, jobId: job.id, cloneId: made.id };
    }
    await openProviderRun({
      jobId: job.id,
      userId: ownerId,
      feature: "ai_voice_clone",
      mode: "voice_clone",
      stage: "voice",
      provider: "elevenlabs",
      model: config.model,
      modelVersion: null,
      providerJobId: `clone:${job.id}`,
      test,
      latencyMs: Date.now() - startedAt,
      status: "failed",
      errorCode: code,
      errorDetail: detail.slice(0, 500),
      costEstimateUsdCents: null,
      metadata: { samples: meta.samples.length },
    }).catch(() => null);
    await recordJobEvent(job.id, "clone.refused", { code, reason: detail.slice(0, 300) }).catch(() => null);
    await failVoiceCloneJob(job, code, detail);
    return { ok: false, jobId: job.id, code, detail };
  }
}

/**
 * `processing → finalizing → completed`, the only lawful road (lib/ai/jobs.ts
 * `TRANSITIONS`). Never throws: a job whose voice exists must not be failed by
 * its own bookkeeping, so a caller gets false and decides — and every caller
 * here decides to keep the member's success.
 */
async function finishVoiceCloneJob(jobId: string, metadata: Record<string, unknown>, cloneId: string): Promise<boolean> {
  try {
    // already completed by an earlier pass: nothing to do, and not a failure
    const claimed = await transitionJob(jobId, ["processing", "finalizing"], "finalizing", {});
    if (!claimed) {
      const row = await getJobAsService(jobId).catch(() => null);
      if (row?.status === "completed") return true;
      console.error("[vc/run] could not claim finalizing", { jobId, status: row?.status });
      return false;
    }
    const done = await transitionJob(jobId, ["finalizing"], "completed", {
      completed_at: new Date().toISOString(),
      result_path: null,
      result_size: null,
      finalize_lease_until: null,
      finalize_next_at: null,
      finalize_error: null,
      metadata: { ...metadata, clone_id: cloneId },
    });
    return !!done;
  } catch (e) {
    console.error("[vc/run] completion threw", { jobId, error: String(e).slice(0, 300) });
    return false;
  }
}

/**
 * End the job, refund ONCE (the money and the month's free voice), tell the
 * member once. The free voice comes back through `releaseJobFunding`, which
 * asks lib/ai/voice-clone/free.ts and is guarded by the row's own mark — so
 * this path, an operator's refund and the generic undo cannot each hand the
 * same allowance back.
 */
async function failVoiceCloneJob(job: AiJobRow, code: string, detail: string): Promise<void> {
  // `finalizing` is in the list because the completion above may have claimed it before something else went wrong
  const updated = await transitionJob(job.id, ["processing", "acquiring", "finalizing"], "failed", { error_code: code, error_message: detail.slice(0, 2000), completed_at: new Date().toISOString(), finalize_lease_until: null, finalize_next_at: null }).catch((e) => {
    console.error("[vc/run] could not fail the job", { jobId: job.id, error: String(e).slice(0, 200) });
    return null;
  });
  if (!updated) return;
  const subject = subjectFromRow(updated);
  if (subject) {
    try {
      await releaseJobFunding({ job: updated, subject, feature: "ai_voice_clone", dailyLimit: 0, cause: "failure" });
      await recordJobEvent(job.id, "refund.issued", { reason: code, chargedCents: updated.charged_cents, from: "vc-run" });
    } catch (e) {
      console.error("[vc/run] refund failed", { jobId: job.id, error: String(e).slice(0, 200) });
    }
    if (subject.kind === "user") {
      // the member reads the reason when it is theirs to fix, and the generic sentence when it is ours
      const message = code === "VOICE_CLONE_REJECTED" ? aiErrorMessage("VOICE_CLONE_REJECTED") : aiErrorMessage("PROCESSING_FAILED");
      await notifyAiJobFailed({ userId: subject.userId, jobId: job.id, feature: "ai_voice_clone", message, errorCode: code });
    }
  }
  console.error("[vc/run] failed", { jobId: job.id, userId: job.user_id, code, detail: detail.slice(0, 300) });
}
