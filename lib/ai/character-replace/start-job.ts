import "server-only";

import { providerHealthFor } from "@/lib/ai/character-replace/circuit";
import { concurrencyLimitFor, modeConfig, type CharacterReplaceConfig } from "@/lib/ai/character-replace/config";
import { consumeFreeUse, getCharacterReplaceFreeEligibility } from "@/lib/ai/character-replace/free-access";
import { freeRequestQualifies } from "@/lib/ai/character-replace/free-access-rules";
import { readCharacterReplaceMeta, referencePaths, selectedRangeOf } from "@/lib/ai/character-replace/job-meta";
import { LAUNCH_INTERNAL_MESSAGE, launchAllows } from "@/lib/ai/character-replace/launch-server";
import { REPLACEMENT_SCOPE } from "@/lib/ai/character-replace/modes";
import { planPipeline } from "@/lib/ai/character-replace/pipeline";
import { dispatchPreparation } from "@/lib/ai/character-replace/prepare-dispatch";
import { providerCostEstimateUsdCents } from "@/lib/ai/character-replace/pricing";
import { replacementProviderFor } from "@/lib/ai/character-replace/providers/router";
import type { StartCharacterReplaceJobRequest } from "@/lib/ai/character-replace/start-schema";
import { verifyStartQuote } from "@/lib/ai/character-replace/start-verify";
import { getCharacterReplaceBalanceCents, reserveCharacterReplaceCharge } from "@/lib/ai/character-replace/wallet";
import { creditDecisionView, decideCredits, getAiCreditEntitlement, type CreditDecision } from "@/lib/ai/credits/entitlement";
import { currentPeriods, reserveAiCredits } from "@/lib/ai/credits/store";
import { getAiEntitlement, type AiEntitlement } from "@/lib/ai/entitlement";
import { type AiErrorCode } from "@/lib/ai/errors";
import { releaseJobFunding } from "@/lib/ai/funding";
import { recordJobEvent } from "@/lib/ai/job-events";
import { aiFeature, type AiFeatureDef, type AiJobRow } from "@/lib/ai/jobs";
import { claimJobStart, confirmQueueReservation, getOwnJob, revertJobStartClaim, transitionJob } from "@/lib/ai/job-store";
import { AI_IMAGE_MAX_BYTES } from "@/lib/ai/media";
import { preflightGate } from "@/lib/ai/preflight/gate";
import { hasProviderFor } from "@/lib/ai/providers";
import { pathBelongsTo } from "@/lib/ai/storage";
import { statSourceObject } from "@/lib/ai/storage-server";
import { subjectOwnerId, type AiSubject } from "@/lib/ai/subject";
import { lipSyncProviderFor, lipSyncProviderUsdCentsPerSecond } from "@/lib/ai/voice/lipsync-provider";
import { textToSpeechProviderFor } from "@/lib/ai/voice/tts-provider";
import { voiceChangeProviderFor } from "@/lib/ai/voice/voice-change-provider";
import { getAdminUser } from "@/lib/admin/require-admin";
import { aiCurrencySymbol, getLandingSettings, type LandingSettings } from "@/lib/landing/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasWorker } from "@/lib/worker";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  STARTING ONE CHARACTER REPLACE JOB — the sequence that spends, as a function
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is the body of POST /api/ai/character-replace/jobs/[id]/start (Part 4
 * → Part 11), moved here unchanged on 2026-09-21 so that the multi-video
 * batch route runs EXACTLY the same sequence per video — the same checks, the
 * same order, the same refusals — rather than a second copy that would drift.
 * The route is now a thin wrapper; nothing about a single video changed.
 *
 * Owner, 2026-09-13 (Part 4, §11 / §13), in order:
 *
 *   A · VALIDATE   signed in, owns the job, job is `queued`, every file is
 *                  in the bucket under the member's own path with plausible
 *                  sizes, consent given, the settings are ones the operator
 *                  offers today, the media preflight passed for THESE files.
 *   B · CALCULATE  the quote handed back is genuine (HMAC), fresh, and
 *                  recomputes to the SAME total under the CURRENT pricing
 *                  configuration — otherwise PRICE_CHANGED / QUOTE_EXPIRED.
 *   D · CLAIM      `claim_ai_job_start`: the member's, the platform's and the
 *                  daily caps counted inside one lock, then queued → acquiring
 *                  — or, with the QUEUE on (0166), queued → `waiting` when a
 *                  cap refuses: the job keeps its place and is admitted by the
 *                  pump when a slot frees. Nothing has been reserved yet.
 *   C · RESERVE    `reserve_product_charge` (or the atomic complimentary use):
 *                  the balance moves HERE and nowhere else. A refusal puts the
 *                  claim back. For a waiting job the row is then STAMPED as
 *                  reserved — the pump admits only stamped rows.
 *   E/F · HAND OFF an admitted job goes to the worker now; a waiting one is
 *                  handed off by the pump later. A refused hand-off ends the
 *                  job with the reservation refunded.
 *
 * "Do not deduct money before the system has safely established what is
 * being processed. But also do not create a free provider job and then hope
 * payment succeeds afterward." — the reservation comes after every check and
 * before any provider call, and every failure after it refunds exactly once.
 *
 * ── The verdict is a value, never a Response ────────────────────────────────
 * The single route answers each refusal with its own status; the batch route
 * collects them per video and keeps going. Neither has to know why the other
 * exists.
 */

const ABANDONED_AFTER_MS = 30 * 60 * 1000;

export type StartRefusal = { ok: false; code: AiErrorCode; extra?: Record<string, unknown> };
export type StartOutcome =
  | {
      ok: true;
      job: AiJobRow;
      /** True when the job was claimed and handed to the worker now. */
      started: boolean;
      /** True when the job is paid for and holding its place in the member's line (0166). */
      waiting: boolean;
      balanceCents: number;
      billing: "free" | "paid" | "credits";
      /** 0167: the credits this generation reserved, and what is left on both clocks — for the answer, never for a decision. */
      credits: ReturnType<typeof creditDecisionView> | null;
    }
  | { ok: true; job: AiJobRow; started: false; waiting: false; balanceCents: null; billing: null; alreadyStarted: true }
  | StartRefusal;

/**
 * What every start in one request shares — read once by the batch route and
 * handed in, so N videos cost one settings read and one plan lookup, not N.
 */
export interface StartShared {
  settings: LandingSettings;
  entitlement: AiEntitlement;
  isAdmin: boolean;
}

export async function loadStartShared(subject: AiSubject, feature: AiFeatureDef): Promise<StartShared> {
  const [settings, entitlement, adminUser] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature), getAdminUser().catch(() => null)]);
  return { settings, entitlement, isAdmin: !!adminUser };
}

/** The member's concurrency, the one number the claim and the pump both use (lib/ai/character-replace/config.ts). */
export function memberConcurrency(config: CharacterReplaceConfig, shared: StartShared): number {
  return concurrencyLimitFor(config, { audience: shared.entitlement.audience, isAdmin: shared.isAdmin, policyMaxConcurrent: shared.entitlement.maxConcurrent });
}

function refuse(code: AiErrorCode, extra?: Record<string, unknown>): StartRefusal {
  return { ok: false, code, extra };
}

export async function startCharacterReplaceJob(input: {
  subject: AiSubject & { kind: "user" };
  /** The member's request — the complimentary-creation device cookie is read from it. */
  request: Request;
  jobId: string;
  body: StartCharacterReplaceJobRequest;
  /**
   * 0166: whether a cap refusal should hold the job as `waiting` rather than
   * refuse. The single route passes the operator's switch; the batch route
   * passes true (and refuses the whole batch up front when the switch is off).
   */
  queue: boolean;
  /** Read once per request; loaded here when the caller has not. */
  shared?: StartShared;
  /** How the job was submitted, for the audit row. */
  via?: "single" | "batch" | "retry";
}): Promise<StartOutcome> {
  const feature = aiFeature("ai_character_replace");
  if (!feature) return refuse("FEATURE_UNAVAILABLE");
  const { subject, request, body } = input;
  const id = input.jobId;

  /* ── A · validate ──────────────────────────────────────────────────────── */
  const job = await getOwnJob(subject, id);
  if (!job) return refuse("JOB_NOT_FOUND");
  if (job.feature !== feature.id) return refuse("JOB_NOT_FOUND");
  if (job.status !== "queued") {
    // Already started (a second press, a refresh, a retried batch request): say where it is, charge nothing.
    return { ok: true, job, started: false, waiting: false, balanceCents: null, billing: null, alreadyStarted: true };
  }
  if (!hasProviderFor(feature) || !hasWorker) return refuse("FEATURE_UNAVAILABLE");

  const meta = readCharacterReplaceMeta(job.metadata);
  if (!meta) {
    console.error("[cr/start] job has no contract metadata", { jobId: job.id });
    return refuse("INTERNAL_ERROR");
  }
  const ownerId = subjectOwnerId(subject);
  const refPaths = referencePaths(meta);
  const audioUploadPath = meta.audio?.source === "upload" ? (meta.audio.upload?.path ?? null) : null;
  for (const p of [meta.video.path, ...refPaths, ...(audioUploadPath ? [audioUploadPath] : [])]) {
    if (!pathBelongsTo(p, ownerId, job.id)) {
      console.error("[cr/start] a path failed ownership", { jobId: job.id, subject: subject.key });
      return refuse("INTERNAL_ERROR");
    }
  }

  const shared = input.shared ?? (await loadStartShared(subject, feature));
  const [videoObject, ...objects] = await Promise.all([statSourceObject(meta.video.path), ...refPaths.map((p) => statSourceObject(p)), ...(audioUploadPath ? [statSourceObject(audioUploadPath)] : [])]);
  const { settings, entitlement } = shared;
  const referenceObjects = objects.slice(0, refPaths.length);
  const audioObject = audioUploadPath ? (objects[refPaths.length] ?? null) : null;
  const config = settings.frenzAiCharacterReplace;
  if (!config.enabled || !entitlement.allowed) return refuse("FEATURE_UNAVAILABLE");
  // Part 10 §25: `internal` launch mode — a draft opened before the switch flipped still cannot start; nothing reserved.
  if (!(await launchAllows(config, subject))) return refuse("FEATURE_UNAVAILABLE", { error: LAUNCH_INTERNAL_MESSAGE });
  const modeView = modeConfig(config, meta.mode);
  if (!modeView.enabled) return refuse("FEATURE_UNAVAILABLE");
  /*
    ── Part 8 §2: THE KILL SWITCHES ─────────────────────────────────────
    Maintenance refuses new work with the operator's own sentence; a
    processing pause refuses new starts while every running job finishes.
    Both BEFORE any money moves, so "nothing was charged" is literally true.
  */
  if (config.ops.maintenanceMode) return refuse("CR_MAINTENANCE", { error: config.ops.maintenanceMessage });
  if (!config.ops.processingEnabled) return refuse("CR_BUSY");

  const age = Date.now() - Date.parse(job.created_at);
  const notYet = (what: string) => refuse("INVALID_INPUT", { error: age > ABANDONED_AFTER_MS ? `That ${what} upload didn't finish. Choose it again.` : `The ${what} upload hasn't finished yet.` });
  if (!videoObject || videoObject.size <= 0) return notYet("video");
  for (const [i, obj] of referenceObjects.entries()) if (!obj || obj.size <= 0) return notYet(i === 0 ? "photo" : `reference photo ${i + 1}`);
  if (videoObject.size > Math.min(feature.maxBytes, modeView.maximumUploadBytes)) return refuse("FILE_TOO_LARGE");
  for (const obj of referenceObjects) if (obj && obj.size > AI_IMAGE_MAX_BYTES) return refuse("FILE_TOO_LARGE");

  /*
    ── A½ · the media preflight (2026-09-20, brief §12–§13, §25) ──────────
    The worker's stored verdict for EXACTLY these objects, this mode and
    this validator, plus the member's token for the same — both checked
    before the price is even looked at, so a refused or missing check
    costs nothing and reaches no provider. A modified client that skips
    /preflight is refused here.
  */
  const gate = preflightGate({ jobId: job.id, userId: ownerId, mode: meta.mode, metadata: job.metadata, reference: referenceObjects[0] ?? null, video: videoObject, token: body.preflightToken });
  if (!gate.ok) {
    console.info("[cr/start] preflight gate refused", { jobId: job.id, subject: subject.key, reason: gate.reason });
    return refuse("PREFLIGHT_REQUIRED");
  }

  /* ── B · calculate ─────────────────────────────────────────────────────── */
  const money = { currency: settings.frenzAiCurrency, symbol: aiCurrencySymbol(settings.frenzAiCurrency) };
  // The quote's mode must be the job's: a Face Only price handed to a Full Character job is a forged mode.
  if ((body.quote.mode ?? "full_character") !== meta.mode) return refuse("INVALID_INPUT", { error: "That price was for a different replacement type. Review the price and try again." });
  const ttsProvider = textToSpeechProviderFor(config.tts.model);
  // 2026-09-20: the voice changer (an upload re-voiced in a catalogue voice) is its own provider
  const changer = voiceChangeProviderFor(config.tts.voiceChange.model);
  const verdict = verifyStartQuote(body, config, money, { ttsLanguages: ttsProvider.supportedLanguages(), voiceChangeConfigured: config.tts.voiceChange.enabled && changer.isConfigured() });
  if (!verdict.ok) {
    console.info("[cr/start] quote refused", { jobId: job.id, subject: subject.key, code: verdict.code, reason: verdict.reason });
    return refuse(
      verdict.code,
      verdict.code === "INVALID_INPUT"
        ? { error: "We couldn't use that price. Check it and try again." }
        : verdict.code === "FEATURE_UNAVAILABLE"
          ? // the only FEATURE_UNAVAILABLE the verifier gives: a priced voice change whose changer is not configured here
            { error: "Changing the voice isn't available right now. Switch it off and try again." }
          : undefined,
    );
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
    if (!audioUploadPath) return refuse("INVALID_INPUT", { error: "Choose the audio file again — it wasn't attached to this job." });
    if (!audioObject || audioObject.size <= 0) return notYet("audio");
    if (audioObject.size > config.audio.maximumUploadBytes) return refuse("FILE_TOO_LARGE");
  }
  if (voice?.source === "tts" && !ttsProvider.isConfigured()) return refuse("FEATURE_UNAVAILABLE", { error: "Generating a voice isn't available right now." });
  if (snapshot.lipSyncMode) {
    const tier = config.lipSync.find((l) => l.id === snapshot.lipSyncMode);
    if (!tier || !lipSyncProviderFor(tier.model).isConfigured()) return refuse("FEATURE_UNAVAILABLE", { error: "Lip sync isn't available right now." });
  }
  // The trim must lie inside the video the browser measured; the worker re-measures and re-checks.
  if (body.trim && body.trim.endMs > meta.video.durationMs + 500) return refuse("INVALID_INPUT", { error: "The trim runs past the end of the video." });
  if (!body.trim && Math.abs(meta.video.durationMs - snapshot.durationMs) > Math.max(500, meta.video.durationMs * 0.03)) {
    return refuse("INVALID_INPUT", { error: "The priced length doesn't match the video. Review the price and try again." });
  }

  /*
    ── C½ · A COMPLIMENTARY CREATION? (Part 11 §4, §7, §21–§22) ─────────
    The server decides, from the member's entitlement row (granted lazily,
    under the database's device lock) and the operator's bounds for a free
    creation — never from anything the body says. The NORMAL price stays
    exactly as computed and signed: it is what the audit row records as
    "not charged". Nothing here touches the wallet.
  */
  const eligibility = await getCharacterReplaceFreeEligibility({ subject, config, request, isAdmin: shared.isAdmin, plans: settings.frenzAiPlans });
  const fits = eligibility.eligible
    ? freeRequestQualifies(config, { mode: snapshot.mode, quality: snapshot.quality, durationMs: snapshot.durationMs, voiceMode: snapshot.voiceMode, voiceSource: snapshot.voiceSource, lipSyncMode: snapshot.lipSyncMode })
    : null;
  const complimentary = eligibility.eligible && fits?.ok === true && videoObject.size <= config.freeAccess.maxUploadBytes;

  /*
    ── C¾ · INCLUDED CREDITS? (AI Pro / AI Max, 2026-09-21) ─────────────────
    The funding order is complimentary → included credits → the wallet.
    The plan comes from ai_subscriptions, the limits from the operator's
    plan configuration now, the usage from the ledger under today's and this
    week's keys — and the credits a generation costs are the priced total
    through the one credit engine. The member's body may PREFER the wallet;
    it cannot name an amount, a plan or a balance.

    When the allowance does not cover it, the operator's policy decides what
    a plan member is offered: `allow` = the wallet pays as it always did;
    `ask` = the member is told the shortfall and chooses (the client sends
    funding: "wallet" to pay from the balance); `off` = upgrade only. A
    member on no plan never reaches this: the wallet is their route as before.
  */
  const plans = settings.frenzAiPlans;
  let creditDecision: CreditDecision | null = null;
  let useCredits = false;
  if (!complimentary && plans.enabled) {
    const creditEntitlement = await getAiCreditEntitlement(ownerId, plans);
    if (creditEntitlement.plan) {
      creditDecision = decideCredits(creditEntitlement, { feature: feature.id, priceCents: snapshot.totalCents, mode: snapshot.mode, quality: snapshot.quality, durationMs: snapshot.durationMs, lines: snapshot.lines?.filter((l) => typeof l.amountCents === "number" && l.amountCents > 0).map((l) => ({ label: l.label, cents: l.amountCents as number })) }, plans);
      const wantsWallet = body.funding === "wallet";
      if (creditDecision.affordable && !wantsWallet) {
        useCredits = true;
      } else if (!wantsWallet && plans.walletFallback !== "allow") {
        // Not enough on one of the two clocks, and the wallet is not the silent answer: say exactly what is short (brief § "INSUFFICIENT CREDIT UX").
        return refuse("CR_CREDITS_REQUIRED", { credits: creditDecisionView(creditDecision), walletFallback: plans.walletFallback, priceCents: snapshot.totalCents, currency: money.currency });
      } else if (wantsWallet && plans.walletFallback === "off") {
        return refuse("CR_CREDITS_REQUIRED", { credits: creditDecisionView(creditDecision), walletFallback: plans.walletFallback, priceCents: snapshot.totalCents, currency: money.currency });
      }
    }
  }

  /* ── the balance read, before the claim ─────────────────────────────────── */
  const balanceBefore = await getCharacterReplaceBalanceCents(ownerId).catch(() => null);
  if (balanceBefore === null) return refuse("INTERNAL_ERROR");
  if (!complimentary && !useCredits && balanceBefore < snapshot.totalCents) {
    return refuse("CR_BALANCE_REQUIRED", { balanceCents: balanceBefore, requiredCents: snapshot.totalCents, shortfallCents: snapshot.totalCents - balanceBefore, currency: money.currency, ...(creditDecision ? { credits: creditDecisionView(creditDecision) } : {}) });
  }

  /* ── D · claim ─────────────────────────────────────────────────────────── */
  /*
    Part 6: the stages this job will run are decided HERE, once, from the
    priced settings (lib/ai/character-replace/pipeline.ts), and the voice
    the verifier accepted is written beside them. The operator's estimate
    of the provider's cost goes on the row too — never on the quote the
    browser holds (Skin + Face brief §7).
  */
  // 2026-09-20: an ElevenLabs voice is made by the worker during prepare, so the plan has no `voice` stage for it
  const pipeline = planPipeline({ mode: meta.mode, voiceMode: snapshot.voiceMode, voiceSource: snapshot.voiceSource, lipSyncMode: snapshot.lipSyncMode, ttsInWorker: ttsProvider.runsIn === "worker" });
  const audioMeta =
    snapshot.voiceMode !== "new_voice" || !voice
      ? null
      : voice.source === "upload"
        ? {
            ...(meta.audio ?? {}),
            source: "upload",
            upload: meta.audio?.upload ?? null,
            tts: null,
            // the priced, verified voice change — the worker re-voices the fitted recording in this catalogue voice
            convert: voice.change ? { voiceId: voice.change.voiceId, providerVoiceId: voice.change.providerVoiceId, model: config.tts.voiceChange.model } : null,
            trimToFit: voice.trimToFit,
            voiceConsent: true,
            prepared: null,
          }
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
  /*
    ── Part 8 §7: THE CIRCUIT BREAKER, BEFORE ANY MONEY MOVES ───────────
    Every model this pipeline will call is looked up once; an open circuit
    on any of them refuses the start with "temporarily unavailable" and
    nothing reserved. A job already paid for is a different matter (the
    submit path waits it out); a NEW one simply does not begin.
  */
  if (config.ops.circuitBreaker.enabled) {
    const models = pipeline.stages
      .map((stage) => (stage === "voice" ? config.tts.model : stage === "replace" ? replacementProviderFor(meta.mode, config).model : stage === "lipsync" ? lipTierModel : ""))
      .filter((m) => m.length > 0);
    const { open } = await providerHealthFor(models);
    if (open.length > 0) {
      console.warn("[cr/start] refused — circuit open", { jobId: job.id, subject: subject.key, models: open.map((o) => o.key), until: open[0]!.openedUntil });
      return refuse("PROVIDER_UNAVAILABLE", { error: "Character Replace is temporarily unavailable. Try again in a few minutes — nothing was charged." });
    }
  }

  /*
    ── THE IMMUTABLE SNAPSHOT (the replacement-scope brief §11, §16) ─────
    The signed quote is the price; beside it go the facts a statement and
    an audit need that the quote does not carry — which scope, which
    provider and model the router chose for it under TODAY's
    configuration, the original length and the trim, the rates by name.
    Written on the ledger row (`snapshot`) and on the job (`provider_plan`)
    so a price or provider change tomorrow never rewrites what ran today.
  */
  const plannedProvider = replacementProviderFor(meta.mode, config);
  const selected = selectedRangeOf({ video: meta.video, trim: body.trim });
  const ledgerSnapshot = {
    ...snapshot,
    replacementMode: snapshot.mode,
    scope: REPLACEMENT_SCOPE[snapshot.mode],
    provider: plannedProvider.id,
    providerModel: plannedProvider.model,
    originalDurationMs: meta.video.durationMs,
    selectedStartMs: selected.startMs,
    selectedEndMs: selected.endMs,
    selectedDurationMs: snapshot.durationMs,
    outputQuality: snapshot.quality,
    modeBasePriceCents: snapshot.modeBasePriceCents,
    modePerSecondRateCents: snapshot.qualityRateCents,
    qualityRateCents: snapshot.qualityRateCents,
    lipSyncRateCents: snapshot.lipSyncRateCents,
    voiceRateCents: snapshot.voiceRateCents,
    totalPriceCents: snapshot.totalCents,
  };
  const startMetadata = {
    ...(job.metadata ?? {}),
    trim: body.trim,
    settings: { quality: snapshot.quality, voiceMode: snapshot.voiceMode, lipSyncMode: snapshot.lipSyncMode },
    quote: snapshot,
    quote_id: snapshot.id,
    // §16: the provider/model the router chose at Start (the submit stage records what ACTUALLY ran in `provider`).
    provider_plan: { id: plannedProvider.id, model: plannedProvider.model, scope: REPLACEMENT_SCOPE[snapshot.mode] },
    // Part 11 §7 / 0167: how this job is paid for — the normal price is recorded either way
    billing: complimentary
      ? { type: "FREE_TRIAL", normalPriceCents: snapshot.totalCents, chargedCents: 0, freeEntitlementUsed: 1, currency: snapshot.currency }
      : useCredits && creditDecision
        ? { type: "CREDITS", normalPriceCents: snapshot.totalCents, chargedCents: 0, freeEntitlementUsed: 0, currency: snapshot.currency, credits: creditDecision.estimate.creditsRequired, plan: creditDecision.plan, creditsConfigVersion: creditDecision.estimate.configVersion }
        : { type: "PAID", normalPriceCents: snapshot.totalCents, chargedCents: snapshot.totalCents, freeEntitlementUsed: 0, currency: snapshot.currency },
    audio: audioMeta,
    pipeline,
    provider_cost_estimate: costEstimate ? { ...costEstimate, perSecondUsdCents: modeView.providerCostPerSecondUsdCents } : null,
    consent_at: new Date().toISOString(),
    // 0166: the plan the member was on when they started, for the operator's monitor (never for a decision — the entitlement is re-read every time).
    audience: shared.isAdmin ? "admin" : entitlement.audience,
    submitted_via: input.via ?? "single",
  };

  /*
    ── Part 8 §4, §5, §8: THE CLAIM, WITH THE LIMITS, BEFORE THE RESERVE ─
    One database function takes the lock, counts the member's active jobs
    (the plan's cap, tightened by the operator's), the platform's active
    jobs and the member's starts today, and moves the row queued →
    acquiring only if every count allows it. Two requests racing the last
    slot cannot both win. Every refusal is answered with its own code and
    NOTHING has been reserved yet — the reservation comes after the claim,
    and a reservation that then fails puts the row back (below).

    The order used to be reserve → claim. It cannot be: `reserve_product_charge`
    is idempotent per job, so a reservation refunded for a limit would make
    the member's next press of Start run this job for free.

    0166: with the queue on, a cap refusal moves the row to `waiting`
    instead — it keeps its place, and the reservation below still happens.
  */
  const claim = await claimJobStart({
    jobId: job.id,
    userId: ownerId,
    feature: feature.id,
    maxActivePerUser: memberConcurrency(config, shared),
    maxActiveGlobal: config.limits.maxActiveJobsGlobal,
    maxPerDay: config.limits.maxJobsPerUserPerDay,
    chargedCents: complimentary || useCredits ? 0 : snapshot.totalCents,
    metadata: startMetadata,
    funding: complimentary ? "free" : useCredits ? "credits" : "balance",
    queue: input.queue,
  });
  if (claim === "user_limit") return refuse("CR_ACTIVE_LIMIT");
  if (claim === "daily_limit") return refuse("CR_DAILY_LIMIT");
  if (claim === "global_limit") {
    console.warn("[cr/start] refused — platform at its active-job cap", { jobId: job.id, cap: config.limits.maxActiveJobsGlobal });
    return refuse("CR_BUSY");
  }
  const waiting = claim === "waiting";
  const claimed = claim === "claimed" || waiting ? await getOwnJob(subject, job.id) : null;
  if (!claimed || (claimed.status !== "acquiring" && claimed.status !== "waiting")) {
    /*
      Lost the race to another request for the SAME job (a double press).
      🔴 NO refund here: `reserve_product_charge` is idempotent per job, so
      the reservation is the one the winning request made and is now paying
      for a job that is proceeding. Refunding it would run that job for free.
    */
    const now = claimed ?? (await getOwnJob(subject, job.id));
    return { ok: true, job: now ?? job, started: false, waiting: false, balanceCents: null, billing: null, alreadyStarted: true };
  }

  /* ── C · reserve ───────────────────────────────────────────────────────── */
  let balanceAfter: number;
  if (complimentary) {
    /*
      ── THE ATOMIC FREE USE (Part 11 §3) ──────────────────────────────────
      One database function: the entitlement row locked, one use per job,
      refused when the last one was taken by a race (two tabs, a replay).
      A refusal puts the claim back — nothing ran, nothing was charged.
    */
    const use = await consumeFreeUse({ userId: ownerId, jobId: job.id, snapshot: ledgerSnapshot, granted: eligibility.remainingFreeUses === null ? null : eligibility.granted });
    if (!use.ok) {
      const reverted = await revertJobStartClaim(job.id, job.metadata ?? {});
      console.warn("[cr/start] complimentary use refused — claim reverted", { jobId: job.id, subject: subject.key, reason: use.reason, reverted });
      return refuse("CR_FREE_UNAVAILABLE");
    }
    balanceAfter = balanceBefore;
    console.info("[cr/start] complimentary creation used", { jobId: job.id, userId: ownerId, useNumber: use.useNumber, remaining: use.remaining, normalPriceCents: snapshot.totalCents, mode: meta.mode, quality: snapshot.quality, durationMs: snapshot.durationMs, waiting });
  } else if (useCredits && creditDecision && creditDecision.plan) {
    /*
      ── THE ATOMIC CREDIT RESERVATION (0167) ────────────────────────────────
      One database function: the member's rows locked, both period sums taken
      inside the lock, both limits checked, one row written — or the refusal
      named. A refusal (two tabs racing the last credits) puts the claim back;
      nothing ran and nothing was reserved. Idempotent per job: a replay of
      this request answers the reservation it already made.
    */
    const periods = currentPeriods(plans);
    const reservation = await reserveAiCredits({ userId: ownerId, jobId: job.id, feature: feature.id, plan: creditDecision.plan, estimate: creditDecision.estimate, dailyLimit: creditDecision.dailyLimit, weeklyLimit: creditDecision.weeklyLimit, periods, config: plans }).catch((e) => {
      console.error("[cr/start] credit reservation threw", { jobId: job.id, error: String(e).slice(0, 200) });
      return null;
    });
    if (!reservation || !reservation.ok) {
      const reverted = await revertJobStartClaim(job.id, job.metadata ?? {});
      console.warn("[cr/start] credit reservation refused — claim reverted", { jobId: job.id, subject: subject.key, reason: reservation ? reservation.reason : "error", reverted });
      if (!reservation) return refuse("INTERNAL_ERROR");
      return refuse("CR_CREDITS_UNAVAILABLE", { credits: { ...creditDecisionView(creditDecision), usedToday: reservation.usedToday, usedThisWeek: reservation.usedThisWeek, reason: reservation.reason, affordable: false } });
    }
    balanceAfter = balanceBefore;
    console.info("[cr/start] included credits reserved", { jobId: job.id, userId: ownerId, plan: creditDecision.plan, credits: reservation.credits, idempotent: reservation.idempotent, usedToday: reservation.usedToday, usedThisWeek: reservation.usedThisWeek, dailyLimit: creditDecision.dailyLimit, weeklyLimit: creditDecision.weeklyLimit, normalPriceCents: snapshot.totalCents, mode: meta.mode, quality: snapshot.quality, durationMs: snapshot.durationMs, configVersion: creditDecision.estimate.configVersion, waiting });
  } else {
    try {
      balanceAfter = await reserveCharacterReplaceCharge({ userId: ownerId, jobId: job.id, snapshot: ledgerSnapshot });
    } catch (e) {
      // The atomic check disagreed with the read (a concurrent spend). The claim goes back so Start can be pressed again after a recharge.
      const message = String((e as Error)?.message ?? e);
      const reverted = await revertJobStartClaim(job.id, job.metadata ?? {});
      console.warn("[cr/start] reservation refused — claim reverted", { jobId: job.id, subject: subject.key, message: message.slice(0, 200), reverted });
      if (/insufficient/i.test(message)) {
        const balance = await getCharacterReplaceBalanceCents(ownerId).catch(() => balanceBefore);
        return refuse("CR_BALANCE_REQUIRED", { balanceCents: balance, requiredCents: snapshot.totalCents, shortfallCents: Math.max(0, snapshot.totalCents - balance), currency: money.currency });
      }
      return refuse("INTERNAL_ERROR");
    }
  }

  if (waiting) {
    /*
      ── 0166: IN LINE, PAID FOR ─────────────────────────────────────────────
      The pump admits only rows carrying `queue.reserved_at`, which is written
      HERE, after the money moved — so a waiting row can never be handed to
      the worker before, or without, its reservation. If the stamp finds the
      row no longer waiting (cancelled in the meantime), the cancel path's
      refund has already handled the money: nothing further to do.
    */
    const stamped = await confirmQueueReservation(job.id, claimed.metadata ?? startMetadata);
    await recordJobEvent(job.id, "queue.waiting", { reason: (claimed.metadata?.queue as { reason?: unknown } | undefined)?.reason ?? null, chargedCents: complimentary || useCredits ? 0 : snapshot.totalCents, billing: complimentary ? "FREE_TRIAL" : useCredits ? "CREDITS" : "PAID", stamped, via: input.via ?? "single" });
    const now = (await getOwnJob(subject, job.id)) ?? claimed;
    console.info("[cr/start] reserved and waiting for a slot", { jobId: job.id, userId: ownerId, mode: meta.mode, chargedCents: complimentary ? 0 : snapshot.totalCents, billing: complimentary ? "FREE_TRIAL" : "PAID", balanceAfterCents: balanceAfter, stamped, transition: "queued -> waiting" });
    return { ok: true, job: now, started: false, waiting: true, balanceCents: balanceAfter, billing: complimentary ? "free" : useCredits ? "credits" : "paid", credits: creditDecision ? creditDecisionView(creditDecision) : null };
  }

  /* ── E/F · hand off ────────────────────────────────────────────────────── */
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
    return refuse(handoff.reason === "refused" ? "FEATURE_UNAVAILABLE" : "PROVIDER_UNAVAILABLE");
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
    chargedCents: complimentary || useCredits ? 0 : snapshot.totalCents,
    billing: complimentary ? "FREE_TRIAL" : useCredits ? "CREDITS" : "PAID",
    pricingVersion: snapshot.pricingConfigVersion,
    quoteId: snapshot.id.slice(0, 12),
    balanceAfterCents: balanceAfter,
    via: input.via ?? "single",
    transition: "queued -> acquiring",
  });
  return { ok: true, job: claimed, started: true, waiting: false, balanceCents: balanceAfter, billing: complimentary ? "free" : useCredits ? "credits" : "paid", credits: creditDecision ? creditDecisionView(creditDecision) : null };
}
