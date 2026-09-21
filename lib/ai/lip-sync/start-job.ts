import "server-only";

import { providerHealthFor } from "@/lib/ai/character-replace/circuit";
import { concurrencyLimitFor } from "@/lib/ai/character-replace/config";
import { consumeFreeUse, getCharacterReplaceFreeEligibility } from "@/lib/ai/character-replace/free-access";
import { LAUNCH_INTERNAL_MESSAGE, launchAllows } from "@/lib/ai/character-replace/launch-server";
import { dispatchPreparation } from "@/lib/ai/character-replace/prepare-dispatch";
import { getCharacterReplaceBalanceCents, reserveCharacterReplaceCharge } from "@/lib/ai/character-replace/wallet";
import { creditDecisionView, decideCredits, getAiCreditEntitlement, type CreditDecision } from "@/lib/ai/credits/entitlement";
import { currentPeriods, reserveAiCredits } from "@/lib/ai/credits/store";
import { getAiEntitlement, type AiEntitlement } from "@/lib/ai/entitlement";
import type { AiErrorCode } from "@/lib/ai/errors";
import { releaseJobFunding } from "@/lib/ai/funding";
import { recordJobEvent } from "@/lib/ai/job-events";
import { claimJobStart, getOwnJob, revertJobStartClaim, stampJobProvider, transitionJob } from "@/lib/ai/job-store";
import { aiFeature, type AiJobRow } from "@/lib/ai/jobs";
import { readLipSyncMeta } from "@/lib/ai/lip-sync/job-meta";
import { estimateSpeechMs, lipSyncCredits, publicLipSyncQuote, quoteLipSync, verifyLipSyncQuote, type LipSyncQuote } from "@/lib/ai/lip-sync/pricing";
import { planSpeechPath, resolveLipSyncProRoute, textPathReady } from "@/lib/ai/lip-sync/providers/router";
import type { StartLipSyncJobRequest } from "@/lib/ai/lip-sync/schemas";
import { pathBelongsTo } from "@/lib/ai/storage";
import { statSourceObject } from "@/lib/ai/storage-server";
import { subjectOwnerId, type AiSubject } from "@/lib/ai/subject";
import { textToSpeechProviderFor } from "@/lib/ai/voice/tts-provider";
import { getAdminUser } from "@/lib/admin/require-admin";
import { getLandingSettings, type LandingSettings } from "@/lib/landing/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasWorker } from "@/lib/worker";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  START A LIP SYNC PRO JOB — verify, decide the route, fund, claim, hand off
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The Character Replace /start sequence (lib/ai/character-replace/start-job.ts),
 * for this tool — the SAME order, the same functions, the same guarantees:
 *
 *   A · validate    the row, the uploads (both present, under their ceilings),
 *                   the signed quote re-verified and RECOMPUTED under today's
 *                   prices, the speech source's fields resolved server-side
 *                   (a voice id must be one of the catalogue's; the speed
 *                   inside the operator's range) — nothing a client typed
 *                   is trusted (§16)
 *   R · the route   the vendor/model for NEW jobs, decided ONCE and written
 *                   on the row; the speech PATH (native | tts | audio) with
 *                   it — a text job on an audio-only model is a tts job, a
 *                   text job on Kling is native (§5, §17)
 *   B · fund        complimentary creation → included credits → the wallet
 *                   (0167's order), the claim under the concurrency lock
 *                   FIRST, the reservation after it, a revert on refusal
 *   E · hand off    the worker's prepare step; a failed hand-off refunds once
 *
 * No `waiting` queue here: a cap refusal is refused (this tool has no batch).
 */
export interface LipSyncStartShared {
  settings: LandingSettings;
  entitlement: AiEntitlement;
  isAdmin: boolean;
}
export type LipSyncStartOutcome =
  | { ok: true; job: AiJobRow; started: boolean; alreadyStarted?: boolean; billing: "free" | "credits" | "paid" | null; balanceCents: number | null; credits: ReturnType<typeof creditDecisionView> | null }
  | { ok: false; code: AiErrorCode; extra?: Record<string, unknown> };

const refuse = (code: AiErrorCode, extra?: Record<string, unknown>): LipSyncStartOutcome => ({ ok: false, code, extra });
const ABANDONED_AFTER_MS = 30 * 60 * 1000;

export async function loadLipSyncStartShared(subject: AiSubject): Promise<LipSyncStartShared> {
  const feature = aiFeature("ai_lip_sync")!;
  const [settings, entitlement, adminUser] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature), getAdminUser().catch(() => null)]);
  return { settings, entitlement, isAdmin: !!adminUser };
}

export async function startLipSyncJob(input: { subject: AiSubject & { kind: "user" }; request: Request; jobId: string; body: StartLipSyncJobRequest; shared?: LipSyncStartShared }): Promise<LipSyncStartOutcome> {
  const feature = aiFeature("ai_lip_sync");
  if (!feature) return refuse("FEATURE_UNAVAILABLE");
  const { subject, request, body } = input;

  /* ── A · validate ──────────────────────────────────────────────────────── */
  const job = await getOwnJob(subject, input.jobId);
  if (!job || job.feature !== feature.id) return refuse("JOB_NOT_FOUND");
  if (job.status !== "queued") return { ok: true, job, started: false, alreadyStarted: true, billing: null, balanceCents: null, credits: null };
  if (!hasWorker) return refuse("FEATURE_UNAVAILABLE");
  const meta = readLipSyncMeta(job.metadata);
  if (!meta) {
    console.error("[lipsync/start] job has no contract metadata", { jobId: job.id });
    return refuse("INTERNAL_ERROR");
  }
  const ownerId = subjectOwnerId(subject);
  const audioPath = meta.speech.source === "audio" ? meta.speech.upload.path : null;
  for (const p of [meta.video.path, ...(audioPath ? [audioPath] : [])]) {
    if (!pathBelongsTo(p, ownerId, job.id)) {
      console.error("[lipsync/start] a path failed ownership", { jobId: job.id, subject: subject.key });
      return refuse("INTERNAL_ERROR");
    }
  }
  const shared = input.shared ?? (await loadLipSyncStartShared(subject));
  const { settings, entitlement } = shared;
  const config = settings.frenzAiLipSync;
  const cr = settings.frenzAiCharacterReplace;
  if (!config.enabled || !entitlement.allowed) return refuse("FEATURE_UNAVAILABLE");
  if (!(await launchAllows(cr, subject))) return refuse("FEATURE_UNAVAILABLE", { error: LAUNCH_INTERNAL_MESSAGE });
  if (cr.ops.maintenanceMode) return refuse("CR_MAINTENANCE", { error: cr.ops.maintenanceMessage });
  if (!cr.ops.processingEnabled) return refuse("CR_BUSY");

  const [videoObject, audioObject] = await Promise.all([statSourceObject(meta.video.path), audioPath ? statSourceObject(audioPath) : Promise.resolve(null)]);
  const age = Date.now() - Date.parse(job.created_at);
  const notYet = (what: string) => refuse("INVALID_INPUT", { error: age > ABANDONED_AFTER_MS ? `That ${what} upload didn't finish. Choose it again.` : `The ${what} upload hasn't finished yet.` });
  if (!videoObject || videoObject.size <= 0) return notYet("video");
  if (videoObject.size > Math.min(feature.maxBytes, config.video.maximumUploadBytes)) return refuse("FILE_TOO_LARGE");
  if (audioPath) {
    if (!audioObject || audioObject.size <= 0) return notYet("audio");
    if (audioObject.size > config.audioMode.maximumUploadBytes) return refuse("FILE_TOO_LARGE");
  }

  /* ── R · the route, decided once ───────────────────────────────────────── */
  const route = resolveLipSyncProRoute(config, settings.frenzAiProviders);
  if (!route.adapter || !route.enabled || !route.configured || route.paused) {
    await recordJobEvent(job.id, "provider.refused", { vendor: route.vendor, model: config.models[route.vendor].model, reason: route.diagnostic, feature: feature.id });
    return refuse("PROVIDER_UNAVAILABLE", { error: "Lip Sync Pro is temporarily unavailable. Try again in a few minutes — nothing has been charged." });
  }
  const adapter = route.adapter;
  const speechPath = planSpeechPath(meta.speech.source, adapter);
  if (meta.speech.source === "text" && !textPathReady(config, adapter)) return refuse("FEATURE_UNAVAILABLE", { error: "Typing what they should say isn't available right now." });
  if (meta.speech.source === "audio" && !adapter.capabilities.supports_audio) return refuse("FEATURE_UNAVAILABLE", { error: "Uploading your own audio isn't available right now." });

  // the speech fields, resolved SERVER-SIDE (§16): the voice must be one the catalogue / the native model offers
  let speechPatch: Record<string, unknown> = {};
  if (meta.speech.source === "text") {
    const spoken = meta.speech;
    const speed = Math.min(config.textMode.speed.max, Math.max(config.textMode.speed.min, spoken.speed));
    if (speechPath === "native") {
      const voices = adapter.nativeVoices ?? [];
      const wanted = spoken.voiceId ? voices.find((v) => v.id === spoken.voiceId) : null;
      if (spoken.voiceId && !wanted) return refuse("INVALID_INPUT", { error: "Choose one of the voices offered." });
      const language = wanted?.language ?? spoken.languageCode ?? "en";
      if (spoken.languageCode && !voices.some((v) => v.language === spoken.languageCode)) return refuse("INVALID_INPUT", { error: "That language isn't offered by this voice engine." });
      speechPatch = { providerVoiceId: wanted?.id ?? null, languageCode: language, speed, path: "native" };
    } else {
      const tts = textToSpeechProviderFor(config.tts.model);
      // the voice provider's catalogue (Character Replace's voices), the configured provider's rows only
      const voice = spoken.voiceId ? cr.voices.find((v) => v.id === spoken.voiceId && v.provider === tts.id) : null;
      if (spoken.voiceId && !voice) return refuse("INVALID_INPUT", { error: "Choose one of the voices offered." });
      const language = spoken.languageCode ?? voice?.languages[0] ?? "en";
      if (!tts.supportedLanguages().includes(language)) return refuse("INVALID_INPUT", { error: "That language isn't offered right now." });
      if (voice && voice.languages.length && !voice.languages.includes(language)) return refuse("INVALID_INPUT", { error: "That voice doesn't speak that language." });
      if (config.languageCodes.length && !config.languageCodes.includes(language)) return refuse("INVALID_INPUT", { error: "That language isn't offered right now." });
      if (voice && config.voiceIds.length && !config.voiceIds.includes(voice.id)) return refuse("INVALID_INPUT", { error: "Choose one of the voices offered." });
      speechPatch = { providerVoiceId: voice?.providerVoiceId || null, languageCode: language, speed, path: "tts" };
    }
  }

  // the quote: its signature, and its arithmetic under TODAY's configuration
  const selected = body.trim ? { startMs: Math.max(0, body.trim.startMs), endMs: Math.min(meta.video.durationMs, body.trim.endMs) } : { startMs: 0, endMs: meta.video.durationMs };
  const selectedMs = selected.endMs - selected.startMs;
  if (selectedMs <= 0 || (body.trim && body.trim.endMs > meta.video.durationMs + 500)) return refuse("INVALID_INPUT", { error: "The trim runs past the end of the video." });
  // the signature covers the priced facts only (lipSyncQuoteCanonical) — the body carries exactly those
  const given = body.quote as unknown as LipSyncQuote;
  if (!verifyLipSyncQuote(given)) return refuse("INVALID_INPUT", { error: "That price didn't verify. Review the price and try again." });
  if (Date.parse(given.expiresAt) < Date.now()) return refuse("QUOTE_EXPIRED");
  const characters = meta.speech.source === "text" ? meta.speech.text.trim().length : 0;
  const fresh = quoteLipSync({ durationMs: selectedMs, speechSource: meta.speech.source, speechPath, textCharacters: characters }, config, { currency: settings.frenzAiCurrency });
  if (fresh.totalCents !== given.totalCents || fresh.pricingConfigVersion !== given.pricingConfigVersion || fresh.durationMs !== given.durationMs || fresh.speechSource !== given.speechSource || fresh.speechPath !== given.speechPath || fresh.routeKey !== given.routeKey) {
    return refuse("PRICE_CHANGED", { quote: publicLipSyncQuote(fresh) });
  }
  const snapshot = fresh;
  const minVideo = Math.max(config.video.minimumDurationSeconds * 1000, adapter.capabilities.video.minDurationMs ?? 0);
  const maxVideo = Math.min(config.video.maximumDurationSeconds * 1000, adapter.capabilities.video.maxDurationMs ?? Infinity);
  if (selectedMs < minVideo) return refuse("INVALID_INPUT", { error: `This engine needs at least ${Math.ceil(minVideo / 1000)} seconds of video — nothing has been charged.`, limit: "too_short" });
  if (selectedMs > maxVideo) return refuse("CR_ENGINE_LIMIT", { error: `This engine works on clips of up to ${Math.floor(maxVideo / 1000)} seconds. Trim your video — nothing has been charged.`, limit: "too_long" });

  // §7 for text mode, before anything is charged: a script that would run far past the video is told, unless the policy handles it
  if (meta.speech.source === "text") {
    const speechMs = estimateSpeechMs(characters, (speechPatch.speed as number) ?? 1);
    const policy = meta.settings.durationPolicy;
    if (policy === "reject" && speechMs > selectedMs * (1 + config.duration.significantMismatchFraction)) {
      return refuse("INVALID_INPUT", { error: `That text would take about ${Math.round(speechMs / 1000)} seconds to say, longer than the ${Math.round(selectedMs / 1000)}-second video. Shorten the text or choose a longer video.`, limit: "speech_longer_than_video" });
    }
  }

  /* ── the breaker, before any money moves ──────────────────────────────── */
  if (cr.ops.circuitBreaker.enabled) {
    const models = [adapter.model, ...(speechPath === "tts" ? [config.tts.model] : [])];
    const { open } = await providerHealthFor(models);
    if (open.length > 0) return refuse("PROVIDER_UNAVAILABLE", { error: "Lip Sync Pro is temporarily unavailable. Try again in a few minutes — nothing was charged." });
  }

  /* ── B · fund ──────────────────────────────────────────────────────────── */
  const plans = settings.frenzAiPlans;
  // the complimentary creations are the AI studio's, shared with Character Replace (the same pool, the same device rule)
  const eligibility = await getCharacterReplaceFreeEligibility({ subject, config: cr, request, isAdmin: shared.isAdmin, plans });
  const complimentary = eligibility.eligible && (eligibility.remainingFreeUses === null || eligibility.remainingFreeUses > 0);
  let creditDecision: CreditDecision | null = null;
  let useCredits = false;
  if (!complimentary && plans.enabled) {
    const creditEntitlement = await getAiCreditEntitlement(ownerId, plans);
    if (creditEntitlement.plan) {
      const estimate = lipSyncCredits(snapshot, config, plans);
      creditDecision = decideCredits(creditEntitlement, { feature: feature.id, priceCents: estimate.priceCents, mode: estimate.mode, durationMs: snapshot.durationMs, lines: snapshot.lines.filter((l) => l.amountCents > 0).map((l) => ({ label: l.label, cents: l.amountCents })) }, plans);
      const wantsWallet = body.funding === "wallet";
      if (creditDecision.affordable && !wantsWallet) useCredits = true;
      else if (!wantsWallet && plans.walletFallback !== "allow") return refuse("CR_CREDITS_REQUIRED", { credits: creditDecisionView(creditDecision), walletFallback: plans.walletFallback, priceCents: snapshot.totalCents, currency: snapshot.currency });
      else if (wantsWallet && plans.walletFallback === "off") return refuse("CR_CREDITS_REQUIRED", { credits: creditDecisionView(creditDecision), walletFallback: plans.walletFallback, priceCents: snapshot.totalCents, currency: snapshot.currency });
    }
  }
  const balanceBefore = complimentary || useCredits ? null : await getCharacterReplaceBalanceCents(ownerId).catch(() => null);
  if (!complimentary && !useCredits) {
    if (balanceBefore === null) return refuse("INTERNAL_ERROR");
    if (balanceBefore < snapshot.totalCents) return refuse("CR_BALANCE_REQUIRED", { balanceCents: balanceBefore, requiredCents: snapshot.totalCents, shortfallCents: snapshot.totalCents - balanceBefore, currency: snapshot.currency, ...(creditDecision ? { credits: creditDecisionView(creditDecision) } : {}) });
  }

  const providersVersion = settings.frenzAiProviders.version;
  const pipeline = { stages: ["lipsync", "finalize"] as const, current: "lipsync" as const, records: { lipsync: { status: "pending" } }, stage_started_at: null, pending_advance: null };
  const startMetadata = {
    ...(job.metadata ?? {}),
    trim: body.trim,
    speech: { ...meta.speech, ...speechPatch },
    quote: snapshot,
    quote_id: snapshot.id,
    provider_plan: { id: adapter.id, model: adapter.model, version: adapter.version || null, scope: "lip_sync", speechPath, providersVersion, decidedAt: new Date().toISOString(), test: shared.isAdmin && settings.frenzAiProviders.adminJobsAreTests },
    billing: complimentary
      ? { type: "FREE_TRIAL", normalPriceCents: snapshot.totalCents, chargedCents: 0, freeEntitlementUsed: 1, currency: snapshot.currency }
      : useCredits && creditDecision
        ? { type: "CREDITS", normalPriceCents: snapshot.totalCents, chargedCents: 0, freeEntitlementUsed: 0, currency: snapshot.currency, credits: creditDecision.estimate.creditsRequired, plan: creditDecision.plan, creditsConfigVersion: creditDecision.estimate.configVersion }
        : { type: "PAID", normalPriceCents: snapshot.totalCents, chargedCents: snapshot.totalCents, freeEntitlementUsed: 0, currency: snapshot.currency },
    pipeline,
    provider_cost_estimate: snapshot.providerCostEstimate.totalUsdCents !== null ? { totalUsdCents: snapshot.providerCostEstimate.totalUsdCents, lipSyncUsdCents: snapshot.providerCostEstimate.lipSyncUsdCents, ttsUsdCents: snapshot.providerCostEstimate.ttsUsdCents } : null,
    consent_at: new Date().toISOString(),
    audience: shared.isAdmin ? "admin" : entitlement.audience,
  };

  const maxActive = Math.min(concurrencyLimitFor(cr, { audience: entitlement.audience, isAdmin: shared.isAdmin, policyMaxConcurrent: entitlement.maxConcurrent }), config.models[route.vendor].maxConcurrent > 0 ? config.models[route.vendor].maxConcurrent : Infinity);
  const claim = await claimJobStart({
    jobId: job.id,
    userId: ownerId,
    feature: feature.id,
    maxActivePerUser: Number.isFinite(maxActive) ? maxActive : 1,
    maxActiveGlobal: cr.limits.maxActiveJobsGlobal,
    maxPerDay: cr.limits.maxJobsPerUserPerDay,
    chargedCents: complimentary || useCredits ? 0 : snapshot.totalCents,
    metadata: startMetadata,
    funding: complimentary ? "free" : useCredits ? "credits" : "balance",
    queue: false,
  });
  if (claim === "user_limit" || claim === "waiting") return refuse("CR_ACTIVE_LIMIT");
  if (claim === "daily_limit") return refuse("CR_DAILY_LIMIT");
  if (claim === "global_limit") return refuse("CR_BUSY");
  const claimed = claim === "claimed" ? await getOwnJob(subject, job.id) : null;
  if (!claimed || claimed.status !== "acquiring") {
    const now = claimed ?? (await getOwnJob(subject, job.id));
    return { ok: true, job: now ?? job, started: false, alreadyStarted: true, billing: null, balanceCents: null, credits: null };
  }
  await stampJobProvider(job.id, adapter.id, adapter.model);

  /* ── reserve ───────────────────────────────────────────────────────────── */
  const ledgerSnapshot = { ...snapshot, product: "lip_sync", mode: meta.speech.source === "text" ? "lip_sync_text" : "lip_sync_audio", quality: snapshot.model, provider: adapter.id, providerModel: adapter.model, speechPath, selectedStartMs: selected.startMs, selectedEndMs: selected.endMs, originalDurationMs: meta.video.durationMs };
  let balanceAfter: number | null = balanceBefore;
  if (complimentary) {
    const use = await consumeFreeUse({ userId: ownerId, jobId: job.id, snapshot: ledgerSnapshot as unknown as Parameters<typeof consumeFreeUse>[0]["snapshot"], granted: eligibility.remainingFreeUses === null ? null : eligibility.granted });
    if (!use.ok) {
      await revertJobStartClaim(job.id, job.metadata ?? {});
      return refuse("CR_FREE_UNAVAILABLE");
    }
  } else if (useCredits && creditDecision && creditDecision.plan) {
    const reservation = await reserveAiCredits({ userId: ownerId, jobId: job.id, feature: feature.id, plan: creditDecision.plan, estimate: creditDecision.estimate, dailyLimit: creditDecision.dailyLimit, weeklyLimit: creditDecision.weeklyLimit, periods: currentPeriods(plans), config: plans }).catch(() => null);
    if (!reservation || !reservation.ok) {
      await revertJobStartClaim(job.id, job.metadata ?? {});
      return refuse("CR_CREDITS_UNAVAILABLE", reservation && !reservation.ok ? { reason: reservation.reason } : undefined);
    }
  } else {
    try {
      balanceAfter = await reserveCharacterReplaceCharge({ userId: ownerId, jobId: job.id, snapshot: ledgerSnapshot as unknown as Parameters<typeof reserveCharacterReplaceCharge>[0]["snapshot"] });
    } catch (e) {
      await revertJobStartClaim(job.id, job.metadata ?? {});
      const msg = String(e);
      if (/insufficient/i.test(msg)) return refuse("CR_BALANCE_REQUIRED", { balanceCents: balanceBefore, requiredCents: snapshot.totalCents, shortfallCents: Math.max(0, snapshot.totalCents - (balanceBefore ?? 0)), currency: snapshot.currency });
      console.error("[lipsync/start] reserve threw", { jobId: job.id, error: msg.slice(0, 200) });
      return refuse("INTERNAL_ERROR");
    }
  }

  /* ── E · hand off ──────────────────────────────────────────────────────── */
  const handoff = await dispatchPreparation(job.id);
  if (!handoff.dispatched) {
    await releaseJobFunding({ job: claimed, subject, feature: feature.id, dailyLimit: 0 });
    await transitionJob(job.id, ["acquiring"], "failed", { error_code: "PREPARATION_FAILED", error_message: handoff.detail.slice(0, 2000), completed_at: new Date().toISOString() });
    await createAdminClient().from("ai_jobs").update({ metadata: { ...(claimed.metadata ?? {}), failure_category: "system", failed_in: "dispatch" } }).eq("id", job.id);
    console.error("[lipsync/start] preparation dispatch failed", { jobId: job.id, reason: handoff.reason, detail: handoff.detail });
    return refuse(handoff.reason === "refused" ? "FEATURE_UNAVAILABLE" : "PROVIDER_UNAVAILABLE");
  }
  console.info("[lipsync/start] reserved and handed off", { jobId: job.id, userId: ownerId, source: meta.speech.source, path: speechPath, vendor: adapter.id, model: adapter.model, durationMs: snapshot.durationMs, chargedCents: complimentary || useCredits ? 0 : snapshot.totalCents, billing: complimentary ? "FREE_TRIAL" : useCredits ? "CREDITS" : "PAID", credits: creditDecision?.estimate.creditsRequired ?? null });
  return { ok: true, job: claimed, started: true, billing: complimentary ? "free" : useCredits ? "credits" : "paid", balanceCents: balanceAfter, credits: creditDecision ? creditDecisionView(creditDecision) : null };
}
