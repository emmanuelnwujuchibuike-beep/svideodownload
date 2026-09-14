import { NextResponse } from "next/server";

import { modeConfig } from "@/lib/ai/character-replace/config";
import { readCharacterReplaceMeta, referencePaths } from "@/lib/ai/character-replace/job-meta";
import { planPipeline } from "@/lib/ai/character-replace/pipeline";
import { dispatchPreparation } from "@/lib/ai/character-replace/prepare-dispatch";
import { providerCostEstimateUsdCents } from "@/lib/ai/character-replace/pricing";
import { startCharacterReplaceJobSchema } from "@/lib/ai/character-replace/start-schema";
import { verifyStartQuote } from "@/lib/ai/character-replace/start-verify";
import { lipSyncProviderFor, lipSyncProviderUsdCentsPerSecond } from "@/lib/ai/voice/lipsync-provider";
import { textToSpeechProviderFor } from "@/lib/ai/voice/tts-provider";
import { getCharacterReplaceBalanceCents, reserveCharacterReplaceCharge } from "@/lib/ai/character-replace/wallet";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { releaseJobFunding } from "@/lib/ai/funding";
import { aiFeature, jobToView } from "@/lib/ai/jobs";
import { getOwnJob, transitionJob } from "@/lib/ai/job-store";
import { AI_IMAGE_MAX_BYTES } from "@/lib/ai/media";
import { hasProviderFor } from "@/lib/ai/providers";
import { pathBelongsTo } from "@/lib/ai/storage";
import { statSourceObject } from "@/lib/ai/storage-server";
import { subjectOwnerId } from "@/lib/ai/subject";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { aiCurrencySymbol, getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasWorker } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/ai/character-replace/jobs/[id]/start — THE endpoint that spends
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 4, §11 / §13), in order and in one request:
 *
 *   A · VALIDATE   signed in, owns the job, job is `queued`, both files are
 *                  in the bucket under the member's own path with plausible
 *                  sizes, consent given, the settings are ones the operator
 *                  offers today.
 *   B · CALCULATE  the quote handed back is genuine (HMAC), fresh, and
 *                  recomputes to the SAME total under the CURRENT pricing
 *                  configuration — otherwise PRICE_CHANGED / QUOTE_EXPIRED,
 *                  never a silent re-price (lib/ai/character-replace/start-verify.ts).
 *   C · RESERVE    `reserve_product_charge`: one SQL statement that refuses
 *                  when the balance will not cover it and writes the
 *                  immutable snapshot on the ledger row. The balance moves
 *                  HERE and nowhere else.
 *   D · CLAIM      `queued → acquiring`, a compare-and-set that records the
 *                  trim, the settings, the snapshot and the funding on the
 *                  row. A second press, a refresh, a retried request: the
 *                  transition matches no row and nothing happens twice.
 *   E/F · HAND OFF the worker trims the video and then creates the
 *                  prediction (server/services/ai-character-replace-prepare-service.ts
 *                  → /api/internal/ai/submit). A refused hand-off ends the
 *                  job now, with the reservation refunded.
 *
 * "Do not deduct money before the system has safely established what is
 * being processed. But also do not create a free provider job and then hope
 * payment succeeds afterward." — C happens after every check and before any
 * provider call, and every failure after C refunds exactly once.
 */
function fail(code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) {
  return NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code) });
}

const ABANDONED_AFTER_MS = 30 * 60 * 1000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feature = aiFeature("ai_character_replace");
  if (!feature) return fail("FEATURE_UNAVAILABLE");
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");

  const burst = await aiJobCreateLimiter.limit(`ai-cr-start:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return fail("JOB_NOT_FOUND");

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("INVALID_INPUT");
  }
  const parsed = startCharacterReplaceJobSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT");
  const body = parsed.data;

  try {
    /* ── A · validate ────────────────────────────────────────────────────── */
    const job = await getOwnJob(subject, id);
    if (!job) return fail("JOB_NOT_FOUND");
    if (job.feature !== feature.id) return fail("JOB_NOT_FOUND");
    if (job.status !== "queued") {
      // Already started (a second press, a refresh): say where it is, charge nothing.
      return NextResponse.json({ job: jobToView(job, storedErrorMessage), started: false });
    }
    if (!hasProviderFor(feature) || !hasWorker) return fail("FEATURE_UNAVAILABLE");

    const meta = readCharacterReplaceMeta(job.metadata);
    if (!meta) {
      console.error("[cr/start] job has no contract metadata", { jobId: job.id });
      return fail("INTERNAL_ERROR");
    }
    const ownerId = subjectOwnerId(subject);
    const refPaths = referencePaths(meta);
    const audioUploadPath = meta.audio?.source === "upload" ? (meta.audio.upload?.path ?? null) : null;
    for (const p of [meta.video.path, ...refPaths, ...(audioUploadPath ? [audioUploadPath] : [])]) {
      if (!pathBelongsTo(p, ownerId, job.id)) {
        console.error("[cr/start] a path failed ownership", { jobId: job.id, subject: subject.key });
        return fail("INTERNAL_ERROR");
      }
    }

    const [settings, entitlement, videoObject, ...objects] = await Promise.all([
      getLandingSettings(),
      getAiEntitlement(subject, feature),
      statSourceObject(meta.video.path),
      ...refPaths.map((p) => statSourceObject(p)),
      ...(audioUploadPath ? [statSourceObject(audioUploadPath)] : []),
    ]);
    const referenceObjects = objects.slice(0, refPaths.length);
    const audioObject = audioUploadPath ? (objects[refPaths.length] ?? null) : null;
    const config = settings.frenzAiCharacterReplace;
    if (!config.enabled || !entitlement.allowed) return fail("FEATURE_UNAVAILABLE");
    const modeView = modeConfig(config, meta.mode);
    if (!modeView.enabled) return fail("FEATURE_UNAVAILABLE");

    const age = Date.now() - Date.parse(job.created_at);
    const notYet = (what: string) => fail("INVALID_INPUT", { error: age > ABANDONED_AFTER_MS ? `That ${what} upload didn't finish. Choose it again.` : `The ${what} upload hasn't finished yet.` });
    if (!videoObject || videoObject.size <= 0) return notYet("video");
    for (const [i, obj] of referenceObjects.entries()) if (!obj || obj.size <= 0) return notYet(i === 0 ? "photo" : `reference photo ${i + 1}`);
    if (videoObject.size > Math.min(feature.maxBytes, modeView.maximumUploadBytes)) return fail("FILE_TOO_LARGE");
    for (const obj of referenceObjects) if (obj && obj.size > AI_IMAGE_MAX_BYTES) return fail("FILE_TOO_LARGE");

    /* ── B · calculate ───────────────────────────────────────────────────── */
    const money = { currency: settings.frenzAiCurrency, symbol: aiCurrencySymbol(settings.frenzAiCurrency) };
    // The quote's mode must be the job's: a Face Only price handed to a Full Character job is a forged mode.
    if ((body.quote.mode ?? "full_character") !== meta.mode) return fail("INVALID_INPUT", { error: "That price was for a different replacement type. Review the price and try again." });
    const ttsProvider = textToSpeechProviderFor(config.tts.model);
    const verdict = verifyStartQuote(body, config, money, { ttsLanguages: ttsProvider.supportedLanguages() });
    if (!verdict.ok) {
      console.info("[cr/start] quote refused", { jobId: job.id, subject: subject.key, code: verdict.code, reason: verdict.reason });
      return fail(verdict.code, verdict.code === "INVALID_INPUT" ? { error: "We couldn't use that price. Check it and try again." } : undefined);
    }
    const snapshot = verdict.snapshot;
    const voice = verdict.voice;
    /*
      ── Part 6: the voice, against what the job actually holds ─────────────
      An uploaded voice needs the audio the member uploaded at creation, in
      the bucket, under its ceiling; a generated voice needs the provider to
      be configured here. Refused BEFORE the reservation — nothing to refund.
    */
    if (voice?.source === "upload") {
      if (!audioUploadPath) return fail("INVALID_INPUT", { error: "Choose the audio file again — it wasn't attached to this job." });
      if (!audioObject || audioObject.size <= 0) return notYet("audio");
      if (audioObject.size > config.audio.maximumUploadBytes) return fail("FILE_TOO_LARGE");
    }
    if (voice?.source === "tts" && !ttsProvider.isConfigured()) return fail("FEATURE_UNAVAILABLE", { error: "Generating a voice isn't available right now." });
    if (snapshot.lipSyncMode) {
      const tier = config.lipSync.find((l) => l.id === snapshot.lipSyncMode);
      if (!tier || !lipSyncProviderFor(tier.model).isConfigured()) return fail("FEATURE_UNAVAILABLE", { error: "Lip sync isn't available right now." });
    }
    // The trim must lie inside the video the browser measured; the worker re-measures and re-checks.
    if (body.trim && body.trim.endMs > meta.video.durationMs + 500) return fail("INVALID_INPUT", { error: "The trim runs past the end of the video." });
    if (!body.trim && Math.abs(meta.video.durationMs - snapshot.durationMs) > Math.max(500, meta.video.durationMs * 0.03)) {
      return fail("INVALID_INPUT", { error: "The priced length doesn't match the video. Review the price and try again." });
    }

    /* ── C · reserve ─────────────────────────────────────────────────────── */
    const balanceBefore = await getCharacterReplaceBalanceCents(ownerId).catch(() => null);
    if (balanceBefore === null) return fail("INTERNAL_ERROR");
    if (balanceBefore < snapshot.totalCents) {
      return fail("CR_BALANCE_REQUIRED", { balanceCents: balanceBefore, requiredCents: snapshot.totalCents, shortfallCents: snapshot.totalCents - balanceBefore, currency: money.currency });
    }
    let balanceAfter: number;
    try {
      balanceAfter = await reserveCharacterReplaceCharge({ userId: ownerId, jobId: job.id, snapshot });
    } catch (e) {
      // The atomic check disagreed with the read (a concurrent spend), or the row is already reserved for this job.
      const message = String((e as Error)?.message ?? e);
      console.warn("[cr/start] reservation refused", { jobId: job.id, subject: subject.key, message: message.slice(0, 200) });
      if (/insufficient/i.test(message)) {
        const balance = await getCharacterReplaceBalanceCents(ownerId).catch(() => balanceBefore);
        return fail("CR_BALANCE_REQUIRED", { balanceCents: balance, requiredCents: snapshot.totalCents, shortfallCents: Math.max(0, snapshot.totalCents - balance), currency: money.currency });
      }
      return fail("INTERNAL_ERROR");
    }

    /* ── D · claim ───────────────────────────────────────────────────────── */
    /*
      Part 6: the stages this job will run are decided HERE, once, from the
      priced settings (lib/ai/character-replace/pipeline.ts), and the voice
      the verifier accepted is written beside them. The operator's estimate
      of the provider's cost goes on the row too — never on the quote the
      browser holds (Skin + Face brief §7).
    */
    const pipeline = planPipeline({ mode: meta.mode, voiceMode: snapshot.voiceMode, voiceSource: snapshot.voiceSource, lipSyncMode: snapshot.lipSyncMode });
    const audioMeta =
      snapshot.voiceMode !== "new_voice" || !voice
        ? null
        : voice.source === "upload"
          ? { ...(meta.audio ?? {}), source: "upload", upload: meta.audio?.upload ?? null, tts: null, trimToFit: voice.trimToFit, voiceConsent: true, prepared: null }
          : {
              source: "tts",
              upload: meta.audio?.upload ?? null,
              tts: { text: voice.text ?? "", languageCode: voice.languageCode ?? "", voiceId: voice.voiceId ?? "", providerVoiceId: voice.providerVoiceId, model: config.tts.model },
              trimToFit: voice.trimToFit,
              voiceConsent: voice.voiceConsent,
              prepared: null,
            };
    const lipTierModel = snapshot.lipSyncMode ? (config.lipSync.find((l) => l.id === snapshot.lipSyncMode)?.model ?? "") : "";
    const costEstimate = providerCostEstimateUsdCents(
      { selectedDurationMs: snapshot.durationMs, mode: snapshot.mode, quality: snapshot.quality, voiceMode: snapshot.voiceMode, voiceSource: snapshot.voiceSource, ttsCharacters: snapshot.ttsCharacters, lipSyncMode: snapshot.lipSyncMode },
      config,
      () => lipSyncProviderUsdCentsPerSecond(lipTierModel),
    );
    const claimed = await transitionJob(job.id, ["queued"], "acquiring", {
      funding_source: "balance",
      charged_cents: snapshot.totalCents,
      metadata: {
        ...(job.metadata ?? {}),
        trim: body.trim,
        settings: { quality: snapshot.quality, voiceMode: snapshot.voiceMode, lipSyncMode: snapshot.lipSyncMode },
        quote: snapshot,
        quote_id: snapshot.id,
        audio: audioMeta,
        pipeline,
        provider_cost_estimate: costEstimate ? { ...costEstimate, perSecondUsdCents: modeView.providerCostPerSecondUsdCents } : null,
        consent_at: new Date().toISOString(),
      },
    });
    if (!claimed) {
      /*
        Lost the race to another request for the SAME job (a double press).
        🔴 NO refund here: `reserve_product_charge` is idempotent per job, so
        the reservation is the one the winning request made and is now paying
        for a job that is proceeding. Refunding it would run that job for free.
      */
      const now = await getOwnJob(subject, job.id);
      return NextResponse.json({ job: jobToView(now ?? job, storedErrorMessage), started: false });
    }

    /* ── E/F · hand off ──────────────────────────────────────────────────── */
    const handoff = await dispatchPreparation(job.id);
    if (!handoff.dispatched) {
      await releaseJobFunding({ job: claimed, subject, feature: feature.id, dailyLimit: 0 });
      await transitionJob(job.id, ["acquiring"], "failed", {
        error_code: "PREPARATION_FAILED",
        error_message: handoff.detail.slice(0, 2000),
        completed_at: new Date().toISOString(),
      });
      await createAdminClient().from("ai_jobs").update({ metadata: { ...(claimed.metadata ?? {}), failure_category: "system", failed_in: "dispatch" } }).eq("id", job.id);
      console.error("[cr/start] preparation dispatch failed", { jobId: job.id, subject: subject.key, reason: handoff.reason, detail: handoff.detail, transition: "acquiring -> failed", refunded: true });
      return fail(handoff.reason === "refused" ? "FEATURE_UNAVAILABLE" : "PROVIDER_UNAVAILABLE");
    }

    console.info("[cr/start] reserved and handed off", {
      jobId: job.id,
      userId: ownerId,
      feature: feature.id,
      mode: meta.mode,
      stages: pipeline.stages,
      voiceSource: snapshot.voiceSource,
      quality: snapshot.quality,
      durationMs: snapshot.durationMs,
      trimmed: !!body.trim,
      chargedCents: snapshot.totalCents,
      pricingVersion: snapshot.pricingConfigVersion,
      quoteId: snapshot.id.slice(0, 12),
      balanceAfterCents: balanceAfter,
      transition: "queued -> acquiring",
    });
    return NextResponse.json({ job: jobToView(claimed, storedErrorMessage), started: true, balanceCents: balanceAfter });
  } catch (e) {
    if (isAiJobError(e)) {
      console.error("[cr/start] failed", { subject: subject.key, jobId: id, code: e.code, detail: e.detail });
      return fail(e.code);
    }
    console.error("[cr/start] threw", { subject: subject.key, jobId: id, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
