import "server-only";

import { finalizeBackoffMs, finalizeMaxAttempts } from "@/lib/ai/character-replace/finalize-policy";
import { settleCharacterReplaceCharge } from "@/lib/ai/character-replace/wallet";
import { settleAiCredits } from "@/lib/ai/credits/store";
import { aiErrorMessage } from "@/lib/ai/errors";
import { releaseJobFunding } from "@/lib/ai/funding";
import { recordJobEvent } from "@/lib/ai/job-events";
import { claimFinalization, getJobAsService, scheduleFinalizationRetry, transitionJob } from "@/lib/ai/job-store";
import type { AiJobRow } from "@/lib/ai/jobs";
import { notifyAiJobFailed, notifyAiJobFinished } from "@/lib/ai/notify";
import { closeProviderRun, openProviderRun } from "@/lib/ai/providers/runs";
import { AI_RESULT_BUCKET, aiResultKey } from "@/lib/ai/storage";
import { subjectFromRow } from "@/lib/ai/subject";
import { createAudioAsset } from "@/lib/ai/text-to-audio/assets";
import { readTextToAudioMeta, type TextToAudioMeta } from "@/lib/ai/text-to-audio/job-meta";
import { mp3Facts } from "@/lib/ai/text-to-audio/mp3-duration";
import { textToSpeechProviderFor } from "@/lib/ai/voice/tts-provider";
import { getLandingSettings } from "@/lib/landing/settings";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FINISHING A TEXT TO AUDIO JOB — on the frontend, no worker, no ffmpeg
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The output is one MP3 of a few hundred kilobytes: nothing here needs the
 * Railway machine. Both routes end in `finalizeTextToAudioJob`:
 *
 *   direct      `runDirectTextToAudio` — the synthesis in the request's
 *               `after()`, the bytes handed straight in
 *   replicate   the webhook recorded `provider_output_url`; the dispatcher
 *               (lib/ai/finalize-dispatch.ts) calls this instead of the
 *               worker, and the recovery pass re-calls it the same way
 *
 * The finalizer is the video tools' in shape and guarantees: the SAME lease
 * claim (`processing|finalizing → finalizing`, one holder at a time, a
 * bounded attempt count), the SAME settle-once (credits → the credit ledger,
 * a wallet charge → settled, a free generation → nothing to settle), the SAME
 * announce-once (`notifyAiJobFinished` claims the notification). A transient
 * failure schedules a retry the sweep will run; a permanent one fails the
 * job and refunds it once — the money AND the month's free characters
 * (lib/ai/funding.ts asks lib/ai/text-to-audio/free.ts).
 */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const LEASE_SECONDS = 120;

export type TextToAudioFinalizeResult = { ok: true; jobId: string; skipped?: string } | { ok: false; jobId: string; code: string; detail: string; retry: boolean };

class FinalizeFailure extends Error {
  constructor(
    readonly code: "PROVIDER_ERROR" | "STORAGE_ERROR" | "FINAL_UPLOAD_FAILED" | "INTERNAL_ERROR",
    detail: string,
    readonly transient: boolean,
  ) {
    super(detail);
  }
}

/** The direct route's work: synthesise, then finalize with the bytes in hand. Never throws. */
export async function runDirectTextToAudio(jobId: string): Promise<TextToAudioFinalizeResult> {
  const job = await getJobAsService(jobId);
  if (!job) return { ok: false, jobId, code: "JOB_NOT_FOUND", detail: "no row", retry: false };
  if (job.status !== "processing") return { ok: true, jobId, skipped: `status ${job.status}` };
  const meta = readTextToAudioMeta(job.metadata);
  if (!meta || meta.route !== "elevenlabs") return { ok: false, jobId, code: "INTERNAL_ERROR", detail: "not a direct text-to-audio row", retry: false };
  const provider = textToSpeechProviderFor(meta.model);
  const startedAt = Date.now();
  let audio: { bytes: Buffer; mime: string };
  try {
    // 2026-09-27: the delivery the row recorded — absent on a row from before that date, which then gets the provider's defaults as it always did
    audio = await provider.synthesize({ jobId: job.id, text: meta.text, languageCode: meta.languageCode ?? "en", providerVoiceId: meta.providerVoiceId, voiceSettings: meta.voice_settings ?? null });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await openProviderRun({ jobId: job.id, userId: job.user_id, feature: "ai_text_to_audio", mode: "text_to_audio", stage: "voice", provider: "elevenlabs", model: meta.model, modelVersion: provider.version || null, providerJobId: `tta:${job.id}`, test: (job.metadata?.provider_plan as { test?: unknown } | null)?.test === true, latencyMs: Date.now() - startedAt, status: "failed", errorCode: "VOICE_GENERATION_FAILED", errorDetail: detail.slice(0, 500), costEstimateUsdCents: meta.quote?.providerCostEstimateUsdCents ?? null, metadata: { characters: meta.characters } });
    await failTextToAudioJob(job, "VOICE_GENERATION_FAILED", detail, ["processing"]);
    return { ok: false, jobId, code: "VOICE_GENERATION_FAILED", detail, retry: false };
  }
  await openProviderRun({ jobId: job.id, userId: job.user_id, feature: "ai_text_to_audio", mode: "text_to_audio", stage: "voice", provider: "elevenlabs", model: meta.model, modelVersion: provider.version || null, providerJobId: `tta:${job.id}`, test: (job.metadata?.provider_plan as { test?: unknown } | null)?.test === true, latencyMs: Date.now() - startedAt, status: "succeeded", costEstimateUsdCents: meta.quote?.providerCostEstimateUsdCents ?? null, metadata: { characters: meta.characters, bytes: audio.bytes.byteLength } });
  return finalizeTextToAudioJob(job.id, { bytes: audio.bytes, mime: audio.mime });
}

/**
 * Store the MP3, complete the row, settle, save to the library, announce.
 * With `source` (the direct route) the bytes are given; without it the
 * provider's output URL on the row is fetched (bounded).
 */
export async function finalizeTextToAudioJob(jobId: string, source?: { bytes: Buffer; mime: string }): Promise<TextToAudioFinalizeResult> {
  const before = await getJobAsService(jobId);
  if (!before) return { ok: false, jobId, code: "JOB_NOT_FOUND", detail: "no row", retry: false };
  if (before.status === "completed" && before.result_path) return { ok: true, jobId, skipped: "already finalized" };
  if (before.feature !== "ai_text_to_audio") return { ok: false, jobId, code: "INTERNAL_ERROR", detail: `feature ${before.feature}`, retry: false };
  const maxAttempts = finalizeMaxAttempts(await getLandingSettings().then((s) => s.frenzAiCharacterReplace).catch(() => null));
  const claim = await claimFinalization(jobId, { leaseSeconds: LEASE_SECONDS, maxAttempts });
  if (!claim.claimed) {
    if (claim.reason === "exhausted" && before.status === "finalizing") {
      await failTextToAudioJob(before, "FINAL_UPLOAD_FAILED", before.finalize_error ?? "finalization attempts exhausted", ["finalizing"]);
      return { ok: false, jobId, code: "FINAL_UPLOAD_FAILED", detail: "attempts exhausted", retry: false };
    }
    return { ok: true, jobId, skipped: claim.reason };
  }
  const job = claim.claimed;
  const attempt = job.finalize_attempts;
  const ownerId = job.user_id;
  const meta = readTextToAudioMeta(job.metadata);
  if (!ownerId || !meta) {
    await failTextToAudioJob(job, "INTERNAL_ERROR", "row has no text-to-audio contract", ["finalizing"]);
    return { ok: false, jobId, code: "INTERNAL_ERROR", detail: "no contract", retry: false };
  }
  await recordJobEvent(jobId, "finalize.claimed", { attempt, from: before.status, route: meta.route, inline: !!source });
  const startedAt = Date.now();
  try {
    /* ── the bytes ─────────────────────────────────────────────────────── */
    let bytes: Buffer;
    let mime: string;
    if (source) {
      bytes = source.bytes;
      mime = source.mime || "audio/mpeg";
    } else {
      const url = typeof job.metadata?.provider_output_url === "string" ? job.metadata.provider_output_url : null;
      if (!url) throw new FinalizeFailure("PROVIDER_ERROR", "no provider output to bring home", false);
      const res = await fetch(url).catch((e) => {
        throw new FinalizeFailure("PROVIDER_ERROR", `output fetch failed: ${String(e).slice(0, 200)}`, true);
      });
      if (!res.ok) throw new FinalizeFailure("PROVIDER_ERROR", `output fetch ${res.status}`, res.status >= 500 || res.status === 429);
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > MAX_OUTPUT_BYTES) throw new FinalizeFailure("STORAGE_ERROR", `output declared ${declared} bytes`, false);
      bytes = Buffer.from(await res.arrayBuffer());
      mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "audio/mpeg";
    }
    if (bytes.byteLength === 0) throw new FinalizeFailure("PROVIDER_ERROR", "output was empty", false);
    if (bytes.byteLength > MAX_OUTPUT_BYTES) throw new FinalizeFailure("STORAGE_ERROR", `output was ${bytes.byteLength} bytes`, false);
    const facts = mp3Facts(bytes);
    if (!facts && (mime === "audio/mpeg" || mime === "audio/mp3")) throw new FinalizeFailure("PROVIDER_ERROR", "output is not MPEG audio", false);
    if (mime === "audio/mp3" || mime === "application/octet-stream" || mime === "binary/octet-stream") mime = facts ? "audio/mpeg" : mime;
    const ext = mime === "audio/wav" || mime === "audio/x-wav" ? "wav" : mime === "audio/mp4" ? "m4a" : "mp3";

    /* ── our bucket ────────────────────────────────────────────────────── */
    const path = aiResultKey(ownerId, "ai_text_to_audio", job.id, ext);
    const { error: uploadError } = await createAdminClient().storage.from(AI_RESULT_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
    if (uploadError) throw new FinalizeFailure("FINAL_UPLOAD_FAILED", uploadError.message, true);

    /* ── the library row (before the row says completed: a completed job always has its asset) ── */
    const durationMs = facts?.durationMs ?? null;
    let assetId: string | null = null;
    if ((job.metadata as { save?: unknown } | null)?.save !== false) {
      const asset = await createAudioAsset({ userId: ownerId, jobId: job.id, name: meta.name, path, mime, bytes: bytes.byteLength, durationMs, provider: meta.route, model: meta.model, voiceId: meta.voiceId, languageCode: meta.languageCode, characters: meta.characters });
      assetId = asset.id;
    }

    /* ── completed ─────────────────────────────────────────────────────── */
    const completed = await transitionJob(job.id, ["finalizing"], "completed", {
      result_path: path,
      result_size: bytes.byteLength,
      result_duration: durationMs === null ? null : durationMs / 1000,
      result_mime_type: mime,
      audio_restored: null,
      completed_at: new Date().toISOString(),
      finalize_lease_until: null,
      finalize_next_at: null,
      finalize_error: null,
      metadata: { ...(job.metadata ?? {}), output: { durationMs, bytes: bytes.byteLength, mime, bitrateKbps: facts?.bitrateKbps ?? null, sampleRate: facts?.sampleRate ?? null }, asset_id: assetId, provider_output_url: null },
    });
    if (completed) {
      const settled = job.funding_source === "credits" ? await settleAiCredits(job.id) : job.funding_source === "balance" ? await settleCharacterReplaceCharge(ownerId, job.id) : true;
      if (!settled) console.error("[tta/finalize] settle found nothing to settle", { jobId: job.id, userId: ownerId, funding: job.funding_source });
      if (job.replicate_prediction_id) await closeProviderRun("replicate", job.replicate_prediction_id, { status: "succeeded", outputRef: path, metadata: { bytes: bytes.byteLength, durationMs } }).catch(() => null);
      await recordJobEvent(job.id, "finalize.completed", { attempt, bytes: bytes.byteLength, durationMs, route: meta.route, characters: meta.characters, assetId, settled, elapsedMs: Date.now() - startedAt });
      await notifyAiJobFinished({ userId: ownerId, jobId: job.id, feature: "ai_text_to_audio", audioRestored: null, durationMs: Date.now() - Date.parse(job.started_at ?? job.created_at) });
    }
    console.info("[tta/finalize] completed", { jobId: job.id, userId: ownerId, route: meta.route, model: meta.model, characters: meta.characters, bytes: bytes.byteLength, durationMs, assetId, attempt, transition: completed ? "finalizing -> completed" : "(lost the row)" });
    return { ok: true, jobId: job.id };
  } catch (e) {
    const failure = e instanceof FinalizeFailure ? e : new FinalizeFailure("INTERNAL_ERROR", e instanceof Error ? e.message : String(e), true);
    if (failure.transient && attempt < maxAttempts) {
      const nextAt = Date.now() + finalizeBackoffMs(attempt);
      const scheduled = await scheduleFinalizationRetry(job.id, { nextAt, error: `${failure.code}: ${failure.message}` });
      await recordJobEvent(job.id, "finalize.retry_scheduled", { attempt, code: failure.code, nextAt: new Date(nextAt).toISOString(), scheduled });
      console.warn("[tta/finalize] transient failure — retry scheduled", { jobId: job.id, attempt, code: failure.code, detail: failure.message.slice(0, 200) });
      return { ok: false, jobId: job.id, code: failure.code, detail: failure.message, retry: true };
    }
    await failTextToAudioJob(job, failure.code, failure.message, ["finalizing"]);
    return { ok: false, jobId: job.id, code: failure.code, detail: failure.message, retry: false };
  }
}

/** End the job, refund once (money and free characters), tell the member once. */
async function failTextToAudioJob(job: AiJobRow, code: string, detail: string, from: readonly ("processing" | "finalizing")[]): Promise<void> {
  const updated = await transitionJob(job.id, from, "failed", { error_code: code, error_message: detail.slice(0, 2000), completed_at: new Date().toISOString(), finalize_lease_until: null, finalize_next_at: null });
  if (!updated) return;
  await recordJobEvent(job.id, "finalize.failed", { code, detail: detail.slice(0, 300) });
  const subject = subjectFromRow(updated);
  if (subject) {
    try {
      await releaseJobFunding({ job: updated, subject, feature: "ai_text_to_audio", dailyLimit: 0, cause: "failure" });
      await recordJobEvent(job.id, "refund.issued", { reason: code, chargedCents: updated.charged_cents, from: "tta-finalize" });
    } catch (e) {
      console.error("[tta/finalize] refund failed", { jobId: job.id, error: String(e).slice(0, 200) });
    }
    if (subject.kind === "user") await notifyAiJobFailed({ userId: subject.userId, jobId: job.id, feature: "ai_text_to_audio", message: aiErrorMessage("PROCESSING_FAILED"), errorCode: code });
  }
  if (updated.replicate_prediction_id) await closeProviderRun("replicate", updated.replicate_prediction_id, { status: "failed", errorCode: code, errorDetail: detail.slice(0, 500) }).catch(() => null);
  console.error("[tta/finalize] failed", { jobId: job.id, userId: job.user_id, code, detail: detail.slice(0, 300) });
}

export type { TextToAudioMeta };
