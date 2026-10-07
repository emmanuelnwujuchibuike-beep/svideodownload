import "server-only";

import { after } from "next/server";

import { creditDecisionView, decideCredits, getAiCreditEntitlement, type CreditDecision } from "@/lib/ai/credits/entitlement";
import { currentPeriods, reserveAiCredits } from "@/lib/ai/credits/store";
import { featureContext, featureRefusal, payAsYouGoRefusal } from "@/lib/ai/credits/feature-gate";
import { walletShortfall } from "@/lib/ai/credits/units";
import type { AiErrorCode } from "@/lib/ai/errors";
import { releaseJobFunding } from "@/lib/ai/funding";
import { recordJobEvent } from "@/lib/ai/job-events";
import { claimJobStart, getOwnJob, revertJobStartClaim, transitionJob } from "@/lib/ai/job-store";
import type { AiJobRow } from "@/lib/ai/jobs";
import { statSourceObject } from "@/lib/ai/storage-server";
import { subjectOwnerId } from "@/lib/ai/subject";
import { runVoiceClone } from "@/lib/ai/voice-clone/run";
import { voiceCloneCapacity, voiceCloneGate, type VoiceCloneCreateContext, type VoiceCloneRefusal } from "@/lib/ai/voice-clone/create";
import { consumeFreeClone, readFreeClones, releaseFreeClone } from "@/lib/ai/voice-clone/free";
import { readVoiceCloneDraft } from "@/lib/ai/voice-clone/job-meta";
import { publicVoiceCloneQuote, quoteVoiceClone, voiceCloneCredits, voiceCloneMonthKey, type VoiceCloneQuote } from "@/lib/ai/voice-clone/pricing";
import type { StartVoiceCloneJobRequest } from "@/lib/ai/voice-clone/schemas";
import { concurrencyLimitFor, getAiWalletBalanceCents, reserveAiWalletCharge } from "@/lib/ai/wallet/server";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  START — consent, the real files, the price, the funding, then the provider
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The same sequence, in the same order, with the same functions as every paid
 * tool in this project — which is the point of putting the money machinery in
 * one place and the PIPELINE in its own:
 *
 *   A · gate      the tool switch, the entitlement, the kill switches, the
 *                 provider
 *   C · consent   the member's declaration, recorded before anything else —
 *                 the schema makes `consent: true` unskippable, this checks
 *                 the signature the operator asked for
 *   U · uploads   what is ACTUALLY in the bucket: every sample present, its
 *                 real size within the ceilings. The browser's numbers are
 *                 claims; these are facts
 *   S · slots     the member's and the platform's voice slots, again — they
 *                 can fill between create and start
 *   F · free      this month's free voice TAKEN first (atomic per member)
 *   $ · price     recomputed here; a difference from what the member was shown
 *                 is refused as PRICE_CHANGED with the fresh quote
 *   B · fund      included credits → the wallet (nothing when free); the claim
 *                 under the concurrency lock, then the reservation, a revert
 *                 on refusal (and the free voice given back)
 *   P · provider  after the response (`after()`): the samples are read back,
 *                 the voice is made, the row is written, the job completes
 */
export interface VoiceCloneStartOutcome {
  ok: true;
  job: AiJobRow;
  billing: "free" | "credits" | "paid" | null;
  balanceCents: number | null;
  credits: ReturnType<typeof creditDecisionView> | null;
}
export type VoiceCloneStartResult = VoiceCloneStartOutcome | VoiceCloneRefusal;

const refuse = (code: AiErrorCode, extra?: Record<string, unknown>): VoiceCloneRefusal => ({ ok: false, code, extra });

export async function startVoiceCloneJob(ctx: VoiceCloneCreateContext, input: { job: AiJobRow; body: StartVoiceCloneJobRequest }): Promise<VoiceCloneStartResult> {
  const { subject, feature, config, settings, entitlement, isAdmin } = ctx;
  const { job, body } = input;
  const ownerId = subjectOwnerId(subject);
  const plans = settings.frenzAiPlans;
  const cr = settings.frenzAiCharacterReplace;

  /* ── already started: the same job, nothing charged twice ──────────────── */
  if (job.status !== "queued") {
    if (job.status === "acquiring" || job.status === "processing" || job.status === "finalizing" || job.status === "completed") return { ok: true, job, billing: null, balanceCents: null, credits: null };
    return refuse("JOB_ALREADY_PROCESSING", { jobId: job.id, status: job.status });
  }
  const draft = readVoiceCloneDraft(job.metadata);
  if (!draft) return refuse("INTERNAL_ERROR", { error: "That voice draft is incomplete. Start again." });

  /* ── A · gate ──────────────────────────────────────────────────────────── */
  const gate = await voiceCloneGate(ctx, subject);
  if (!gate.ok) return gate;
  // 0185: the admin feature table — may this tier use it at all? (its allowance is free voices a month, below)
  const fctx = await featureContext(ownerId, feature.id, plans);
  const barred = featureRefusal(fctx);
  if (barred) return refuse(barred.code, barred.extra);

  /* ── C · consent ───────────────────────────────────────────────────────── */
  const consentName = (body.consentName ?? "").trim().slice(0, 120);
  if (config.requireConsentName && consentName.length < 2) {
    return refuse("INVALID_INPUT", { error: "Type your name to confirm you hold the rights to this voice.", consentRequired: true });
  }
  const consent = { at: new Date().toISOString(), name: consentName, statement: config.consentStatement };

  /* ── U · the real files ────────────────────────────────────────────────── */
  const stats = await Promise.all(draft.samples.map((s) => statSourceObject(s.path).catch(() => null)));
  const missing = stats.findIndex((x) => !x || x.size <= 0);
  if (missing >= 0) return refuse("INVALID_INPUT", { error: "One of your recordings didn't finish uploading. Add it again.", sampleIndex: missing + 1 });
  const measured = draft.samples.map((s, i) => ({ ...s, size: stats[i]!.size, mime: stats[i]!.mimeType ?? s.mime }));
  const totalBytes = measured.reduce((a, s) => a + s.size, 0);
  if (measured.some((s) => s.size > config.samples.maximumBytes)) return refuse("FILE_TOO_LARGE", { error: "One of those recordings is too large." });
  if (totalBytes > config.samples.maximumTotalBytes) return refuse("FILE_TOO_LARGE", { error: "Those recordings are too much audio together." });

  /* ── S · the slots, authoritatively ────────────────────────────────────── */
  const capacity = await voiceCloneCapacity(ctx, ownerId);
  if (!capacity.ok) return capacity;

  /* ── F · the month's free voice, taken first ───────────────────────────── */
  const monthKey = voiceCloneMonthKey(new Date(), plans.reset.timezone);
  const before = await readFreeClones(ownerId, monthKey, config.freeClonesPerMonth);
  const shown = quoteVoiceClone({ freeClonesAvailable: before.remaining }, config, { currency: settings.frenzAiCurrency });
  if (body.quote && (body.quote.totalCents !== shown.totalCents || body.quote.pricingConfigVersion !== shown.pricingConfigVersion)) {
    return refuse("PRICE_CHANGED", { quote: { ...publicVoiceCloneQuote(shown), credits: shown.totalCents > 0 ? voiceCloneCredits(shown, config, plans).creditsRequired : 0 } });
  }
  const taken = await consumeFreeClone(ownerId, monthKey, config.freeClonesPerMonth);
  if (!taken) return refuse("INTERNAL_ERROR");
  const giveBack = async (why: string) => {
    if (taken.covered > 0) await releaseFreeClone(ownerId, monthKey, why);
  };
  const quote: VoiceCloneQuote = taken.covered > 0 === shown.freeCovered ? shown : quoteVoiceClone({ freeClonesAvailable: taken.covered }, config, { currency: settings.frenzAiCurrency });
  if (quote.totalCents !== shown.totalCents) {
    // a concurrent clone took the last free voice between the read and the take: the price moved, the member decides
    await giveBack("price moved");
    return refuse("PRICE_CHANGED", { quote: { ...publicVoiceCloneQuote(quote), credits: quote.totalCents > 0 ? voiceCloneCredits(quote, config, plans).creditsRequired : 0 } });
  }

  /* ── B · fund: credits → the wallet; nothing when free ─────────────────── */
  const free = quote.totalCents === 0;
  let creditDecision: CreditDecision | null = null;
  let useCredits = false;
  if (!free && plans.enabled) {
    const creditEntitlement = await getAiCreditEntitlement(ownerId, plans);
    if (creditEntitlement.plan) {
      const estimate = voiceCloneCredits(quote, config, plans);
      creditDecision = decideCredits(creditEntitlement, { feature: feature.id, priceCents: estimate.priceCents, mode: "voice_clone", durationMs: null, lines: quote.lines.filter((l) => l.amountCents > 0).map((l) => ({ label: l.label, cents: l.amountCents })) }, plans);
      const wantsWallet = body.funding === "wallet";
      if (creditDecision.affordable && !wantsWallet) useCredits = true;
      else if (!wantsWallet && plans.walletFallback !== "allow") {
        await giveBack("credits required");
        return refuse("CR_CREDITS_REQUIRED", { credits: creditDecisionView(creditDecision), walletFallback: plans.walletFallback, priceCents: quote.totalCents, currency: quote.currency });
      } else if (wantsWallet && plans.walletFallback === "off") {
        await giveBack("wallet off");
        return refuse("CR_CREDITS_REQUIRED", { credits: creditDecisionView(creditDecision), walletFallback: plans.walletFallback, priceCents: quote.totalCents, currency: quote.currency });
      }
    }
  }
  // 🔴 the wallet holds credits (0184): the same engine figure an AI plan would count
  const walletCharge = voiceCloneCredits(quote, config, plans);
  const balanceBefore = free || useCredits ? null : await getAiWalletBalanceCents(ownerId).catch(() => null);
  if (!free && !useCredits) {
    // 0185: the wallet may be closed for this feature — a plan's allowance only
    const closed = payAsYouGoRefusal(fctx);
    if (closed) {
      await giveBack("pay-as-you-go off");
      return refuse(closed.code, { ...closed.extra, ...(creditDecision ? { credits: creditDecisionView(creditDecision) } : {}) });
    }
    if (balanceBefore === null) {
      await giveBack("balance read failed");
      return refuse("INTERNAL_ERROR");
    }
    if (balanceBefore < walletCharge.creditsRequired) {
      await giveBack("balance short");
      return refuse("CR_BALANCE_REQUIRED", walletShortfall(balanceBefore, walletCharge.creditsRequired, creditDecision ? { credits: creditDecisionView(creditDecision) } : {}));
    }
  }

  /* ── the claim ─────────────────────────────────────────────────────────── */
  const metadata = {
    ...(job.metadata ?? {}),
    name: draft.name,
    description: draft.description,
    samples: measured,
    quote,
    consent,
    billing: free
      ? { type: "FREE_ALLOWANCE", normalPriceCents: quote.totalCents, chargedCents: 0, currency: quote.currency }
      : useCredits && creditDecision
        ? { type: "CREDITS", normalPriceCents: quote.totalCents, chargedCents: 0, currency: quote.currency, credits: creditDecision.estimate.creditsRequired, plan: creditDecision.plan, creditsConfigVersion: creditDecision.estimate.configVersion }
        : { type: "PAID", normalPriceCents: quote.totalCents, chargedCents: quote.totalCents, currency: quote.currency, credits: walletCharge.creditsRequired, unit: "CREDIT" },
    free_clones: { monthKey, covered: taken.covered },
    provider: { id: "elevenlabs", model: config.model },
    provider_cost_estimate: quote.providerCostEstimateUsdCents !== null ? { totalUsdCents: quote.providerCostEstimateUsdCents } : null,
    // no pipeline: this tool has ONE provider step and no stages (the standalone rule)
    pipeline: null,
    clone_id: null,
    sample_bytes: totalBytes,
    sample_seconds: measured.reduce((a, s) => a + (s.durationMs ?? 0), 0) / 1000 || null,
  };

  const maxActive = concurrencyLimitFor(cr, { audience: entitlement.audience, isAdmin, policyMaxConcurrent: entitlement.maxConcurrent });
  const claim = await claimJobStart({
    jobId: job.id,
    userId: ownerId,
    feature: feature.id,
    // a clone is seconds of work and holds no GPU: it must not be blocked by a video the member is also making
    maxActivePerUser: Math.max(2, maxActive),
    maxActiveGlobal: cr.limits.maxActiveJobsGlobal,
    maxPerDay: cr.limits.maxJobsPerUserPerDay,
    chargedCents: free || useCredits ? 0 : quote.totalCents,
    metadata,
    funding: free ? "free" : useCredits ? "credits" : "balance",
    queue: false,
  });
  const endUnclaimed = async (why: string) => {
    await giveBack(why);
    await transitionJob(job.id, ["queued"], "cancelled", { completed_at: new Date().toISOString(), error_code: null });
  };
  if (claim === "user_limit" || claim === "waiting") {
    await endUnclaimed("active limit");
    return refuse("CR_ACTIVE_LIMIT");
  }
  if (claim === "daily_limit") {
    await endUnclaimed("daily limit");
    return refuse("CR_DAILY_LIMIT");
  }
  if (claim === "global_limit") {
    await endUnclaimed("global limit");
    return refuse("CR_BUSY");
  }
  const claimed = claim === "claimed" ? await getOwnJob(subject, job.id) : null;
  if (!claimed || claimed.status !== "acquiring") {
    const fresh = claimed ?? (await getOwnJob(subject, job.id));
    return { ok: true, job: fresh ?? job, billing: null, balanceCents: null, credits: null };
  }

  /* ── reserve ───────────────────────────────────────────────────────────── */
  const ledgerSnapshot = { ...quote, product: "voice_clone", mode: "voice_clone", quality: config.model, provider: "elevenlabs", providerModel: config.model, durationMs: 0, freeClonesCovered: taken.covered };
  let balanceAfter: number | null = balanceBefore;
  if (useCredits && creditDecision && creditDecision.plan) {
    const reservation = await reserveAiCredits({ userId: ownerId, jobId: job.id, feature: feature.id, plan: creditDecision.plan, estimate: creditDecision.estimate, dailyLimit: creditDecision.dailyLimit, weeklyLimit: creditDecision.weeklyLimit, periods: currentPeriods(plans), config: plans }).catch(() => null);
    if (!reservation || !reservation.ok) {
      await revertJobStartClaim(job.id, job.metadata ?? {});
      await endUnclaimed("credits reservation refused");
      return refuse("CR_CREDITS_UNAVAILABLE", reservation && !reservation.ok ? { reason: reservation.reason } : undefined);
    }
  } else if (!free) {
    try {
      balanceAfter = await reserveAiWalletCharge({ userId: ownerId, jobId: job.id, credits: walletCharge.creditsRequired, snapshot: { ...ledgerSnapshot, creditBreakdown: walletCharge.breakdown, creditsConfigVersion: walletCharge.configVersion } });
    } catch (e) {
      await revertJobStartClaim(job.id, job.metadata ?? {});
      await endUnclaimed("wallet reservation refused");
      const msg = String(e);
      if (/insufficient/i.test(msg)) return refuse("CR_BALANCE_REQUIRED", walletShortfall(balanceBefore ?? 0, walletCharge.creditsRequired));
      console.error("[vc/start] reserve threw", { jobId: job.id, error: msg.slice(0, 200) });
      return refuse("INTERNAL_ERROR");
    }
  }

  /* ── P · the provider, after the response ──────────────────────────────── */
  const moved = await transitionJob(job.id, ["acquiring"], "processing", { started_at: new Date().toISOString(), model: config.model, model_version: null });
  if (!moved) {
    // the row left `acquiring` under us: the funding comes back and the job ends rather than a voice being made nobody asked for
    await releaseJobFunding({ job: claimed, subject, feature: feature.id, dailyLimit: 0, cause: "undo" });
    await transitionJob(job.id, ["acquiring"], "failed", { error_code: "INTERNAL_ERROR", error_message: "the row left acquiring before the clone started", completed_at: new Date().toISOString() });
    return refuse("INTERNAL_ERROR");
  }
  await recordJobEvent(job.id, "provider.submitted", { provider: "elevenlabs", model: config.model, samples: measured.length, bytes: totalBytes, inline: true });
  after(async () => {
    try {
      await runVoiceClone(job.id);
    } catch (e) {
      console.error("[vc/start] clone threw", { jobId: job.id, error: String(e).slice(0, 300) });
    }
  });

  const billing = free ? "free" : useCredits ? "credits" : "paid";
  console.info("[vc/start] funded and submitted", { jobId: job.id, userId: ownerId, samples: measured.length, bytes: totalBytes, freeCovered: taken.covered, chargedCents: free || useCredits ? 0 : quote.totalCents, billing, credits: creditDecision?.estimate.creditsRequired ?? null });
  const fresh = (await getOwnJob(subject, job.id)) ?? claimed;
  return { ok: true, job: fresh, billing, balanceCents: balanceAfter, credits: creditDecision ? creditDecisionView(creditDecision) : null };
}
