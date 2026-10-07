import { ONE_MINUTE_SECONDS, ONE_MINUTE_SEGMENT_SECONDS, ONE_MINUTE_SEGMENTS } from "@/lib/ai/kling/pricing";
import "server-only";

import { calculateCredits } from "@/lib/ai/credits/engine";
import { creditDecisionView, decideCredits, getAiCreditEntitlement } from "@/lib/ai/credits/entitlement";
import { currentPeriods, reserveAiCredits } from "@/lib/ai/credits/store";
import type { AiEntitlement } from "@/lib/ai/entitlement";
import { AiJobError } from "@/lib/ai/errors";
import { releaseJobFunding } from "@/lib/ai/funding";
import { claimJobStart, createJob, stampJobProvider, transitionJob } from "@/lib/ai/job-store";
import { aiFeature, type AiFeatureDef } from "@/lib/ai/jobs";
import { submitKlingPipeline } from "@/lib/ai/kling/pipelines/submit";
import { klingCapability, klingPipeline, type KlingPipelineInputs, type KlingRunnableFeature } from "@/lib/ai/kling/pipelines/registry";
import { klingConfigured } from "@/lib/ai/kling/client";
import { quoteKling, type KlingQuote } from "@/lib/ai/kling/pricing";
import type { AiSubject } from "@/lib/ai/subject";
import { subjectOwnerId } from "@/lib/ai/subject";
import { concurrencyLimitFor, getAiWalletBalanceCents, reserveAiWalletCharge } from "@/lib/ai/wallet/server";
import type { LandingSettings } from "@/lib/landing/settings";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CREATING A KLING VIDEO JOB — the money sequence, shared; the work, not
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Part 5 §2 draws the line this file sits on: "Shared infrastructure is
 * allowed. Shared feature execution is NOT."
 *
 * What is SHARED here, because it is identical for every video tool and
 * duplicating it six times is how a refund path goes wrong in one copy:
 *
 *     the capability gate · the funding decision (credits → wallet) ·
 *     the reservation · the job row · the concurrency claim ·
 *     the transition to `processing` · the undo on every failure
 *
 * What is NOT shared, and never reaches this file:
 *
 *     what a feature's input is · how it is validated · what its request body
 *     looks like · which endpoint it goes to · which dimensions of it are
 *     billable
 *
 * All six of those live in `lib/ai/kling/pipelines/<feature>.ts`. This function
 * asks the pipeline and does as it is told. There is no `switch (feature)`
 * here, and a test asserts it.
 *
 * ── 🔴 THE ORDER, AND WHY IT IS THIS ORDER ─────────────────────────────────
 *
 *   1. gate      free, pure, no network. A feature the API cannot run is
 *                refused before anything is looked up. This is the Part 1
 *                audit's most expensive recorded bug — a capability check that
 *                existed but ran AFTER the charge, the download and the
 *                prepare.
 *   2. validate  the pipeline's own rules. Still free, still before money.
 *   3. quote     server-authoritative (§26). The client may SEND a quote; it is
 *                compared, never trusted, and a difference refuses with
 *                PRICE_CHANGED so the member re-confirms.
 *   4. reserve   credits first, then the wallet.
 *   5. row       created only once the money is held.
 *   6. submit    the pipeline builds and sends its own request.
 *   7. stamp     the task id lands in the shared idempotency column.
 *
 * Every failure after step 4 calls `releaseJobFunding`, which reads
 * `funding_source` off the row and runs the matching undo. A bespoke refund
 * here would be a second opinion about what was taken.
 */

export interface CreateKlingVideoResult {
  ok: true;
  jobId: string;
  quote: KlingQuote & { ok: true };
  funding: "credits" | "balance";
  balanceCents: number | null;
  credits: ReturnType<typeof creditDecisionView> | null;
}

export interface CreateKlingVideoOptions<K extends KlingRunnableFeature> {
  feature: K;
  input: KlingPipelineInputs[K];
  subject: AiSubject;
  clientRequestId: string;
  /** What the browser was last shown. Compared, never trusted (§26). */
  shownTotalCents?: number | null;
  /** The member asked to pay from the wallet even though credits would cover it. */
  preferWallet?: boolean;
  settings: LandingSettings;
  entitlement: AiEntitlement;
  isAdmin: boolean;
  /** Where Kling should report the outcome. */
  callbackUrl: string;
  /** Facts the worker measured, recorded on the row for the operator. Never billing input on their own. */
  sourceFacts?: Record<string, unknown>;
}

type Refusal = { ok: false; code: string; extra?: Record<string, unknown> };

const refuse = (code: string, extra?: Record<string, unknown>): Refusal => ({ ok: false, code, extra });

/** A one-minute request (four chained 15 s segments). */
function isOneMinute(input: unknown): boolean {
  const o = (input as { options?: { durationSeconds?: unknown } } | null)?.options;
  return o?.durationSeconds === ONE_MINUTE_SECONDS;
}

/** The same request, as the first 15 s segment. */
function asFirstSegment<T>(input: T): T {
  const i = input as unknown as { options?: Record<string, unknown> };
  return { ...i, options: { ...(i.options ?? {}), durationSeconds: ONE_MINUTE_SEGMENT_SECONDS } } as unknown as T;
}

export async function createKlingVideoJob<K extends KlingRunnableFeature>(opts: CreateKlingVideoOptions<K>): Promise<CreateKlingVideoResult | Refusal> {
  const { feature: featureId, subject, settings, entitlement } = opts;
  const pipeline = klingPipeline(featureId);
  const featureDef: AiFeatureDef | null = aiFeature(pipeline.aiFeature);
  if (!featureDef) return refuse("FEATURE_UNAVAILABLE");
  const ownerId = subjectOwnerId(subject);
  if (!ownerId) return refuse("AUTH_REQUIRED");

  const pricing = settings.frenzAiKlingPricing;
  const plans = settings.frenzAiPlans;

  /* ── 1 · the capability gate: free, and before anything else ───────────── */
  const capability = klingCapability(featureId, { configured: klingConfigured(), pricing });
  if (capability.state !== "available") {
    return refuse(capability.state === "unsupported" ? "FEATURE_UNAVAILABLE" : "PROVIDER_UNAVAILABLE", { error: capability.reason ?? undefined });
  }

  /* ── 2 · the feature's OWN validation ──────────────────────────────────── */
  const verdict = pipeline.validate(opts.input);
  if (!verdict.ok) {
    return refuse(verdict.kind === "unsupported" ? "FEATURE_UNAVAILABLE" : "INVALID_INPUT", { error: verdict.reason });
  }

  /* ── 3 · the price, decided HERE and nowhere else (§26) ────────────────── */
  const quote = pipeline.quote(opts.input, pricing);
  if (!quote.ok) return refuse("INVALID_INPUT", { error: quote.reason });
  /*
    🔴 The browser's number is compared, never believed. A member who was shown
    one price and would be charged another is asked again rather than silently
    charged the new one.
  */
  if (typeof opts.shownTotalCents === "number" && opts.shownTotalCents !== quote.totalUsdCents) {
    return refuse("PRICE_CHANGED", { quote: publicKlingQuote(quote) });
  }

  /* ── 4 · fund: credits first, then the wallet ──────────────────────────── */
  let creditDecision: ReturnType<typeof decideCredits> | null = null;
  let useCredits = false;
  if (plans.enabled) {
    const creditEntitlement = await getAiCreditEntitlement(ownerId, plans);
    if (creditEntitlement.plan) {
      const estimate = calculateCredits({ feature: featureDef.id, priceCents: quote.totalUsdCents, mode: "video", durationMs: Math.round(quote.billableSeconds * 1000), lines: [{ label: pipeline.label, cents: quote.totalUsdCents }] }, plans);
      creditDecision = decideCredits(creditEntitlement, { feature: featureDef.id, priceCents: estimate.priceCents, mode: "video", durationMs: Math.round(quote.billableSeconds * 1000), lines: [{ label: pipeline.label, cents: quote.totalUsdCents }] }, plans);
      if (creditDecision.affordable && !opts.preferWallet) useCredits = true;
      else if (!opts.preferWallet && plans.walletFallback !== "allow") {
        return refuse("CR_CREDITS_REQUIRED", { credits: creditDecisionView(creditDecision), walletFallback: plans.walletFallback, priceCents: quote.totalUsdCents });
      } else if (opts.preferWallet && plans.walletFallback === "off") {
        return refuse("CR_CREDITS_REQUIRED", { credits: creditDecisionView(creditDecision), walletFallback: plans.walletFallback, priceCents: quote.totalUsdCents });
      }
    }
  }

  const balanceBefore = useCredits ? null : await getAiWalletBalanceCents(ownerId).catch(() => null);
  if (!useCredits) {
    if (balanceBefore === null) return refuse("INTERNAL_ERROR");
    if (balanceBefore < quote.totalUsdCents) {
      return refuse("CR_BALANCE_REQUIRED", { balanceCents: balanceBefore, requiredCents: quote.totalUsdCents, shortfallCents: quote.totalUsdCents - balanceBefore, ...(creditDecision ? { credits: creditDecisionView(creditDecision) } : {}) });
    }
  }

  /* ── 5 · the row ───────────────────────────────────────────────────────── */
  const created = await createJob({
    subject,
    feature: featureDef,
    // A video tool's "source" is its request, not an upload: the size is the
    // billable seconds so the row carries something meaningful for the admin.
    source: { kind: "upload", size: Math.max(1, Math.round(quote.billableSeconds)), mimeType: "application/json", name: pipeline.label },
    clientRequestId: opts.clientRequestId,
  });
  if (!created.created) {
    // Idempotent: the same client request id gets the same job, unfunded twice.
    return { ok: true, jobId: created.row.id, quote, funding: useCredits ? "credits" : "balance", balanceCents: balanceBefore, credits: creditDecision ? creditDecisionView(creditDecision) : null };
  }
  const job = created.row;
  const now = new Date().toISOString();

  const metadata = {
    ...(job.metadata ?? {}),
    tool: featureId,
    tool_id: featureId,
    request: opts.input,
    source_facts: opts.sourceFacts ?? null,
    quote,
    billing: useCredits && creditDecision
      ? { type: "CREDITS", normalPriceCents: quote.totalUsdCents, chargedCents: 0, credits: creditDecision.estimate.creditsRequired, plan: creditDecision.plan }
      : { type: "PAID", normalPriceCents: quote.totalUsdCents, chargedCents: quote.totalUsdCents },
    /*
      🔴 The plan says `kling`, and a job keeps its provider for ever. This is
      what `jobVendor()` reads to pick the adapter that polls and cancels it.
    */
    provider_plan: { id: "kling" as const, model: pipeline.model, version: null, scope: featureId, providersVersion: settings.frenzAiProviders.version, decidedAt: now, test: opts.isAdmin && settings.frenzAiProviders.adminJobsAreTests },
    provider_cost_estimate: quote.providerCostUsdCents === null ? null : { totalUsdCents: quote.providerCostUsdCents, providerUnits: quote.providerUnits },
    endpoint: pipeline.endpoint,
    audience: opts.isAdmin ? "admin" : entitlement.audience,
    /*
      🔴 ONE MINUTE = A CHAIN (2026-10-06). Priced and charged as 60 s above;
      made as four 15 s segments. The worker finalizer reads this: after each
      segment it stores the clip, takes its LAST frame and submits the next
      segment from it (first_frame), and after the last it joins all four.
    */
    ...(isOneMinute(opts.input)
      ? { chain: { segments: ONE_MINUTE_SEGMENTS, segmentSeconds: ONE_MINUTE_SEGMENT_SECONDS, done: [] as string[], callbackUrl: opts.callbackUrl } }
      : {}),
  };

  const maxActive = concurrencyLimitFor(settings.frenzAiCharacterReplace, { audience: entitlement.audience, isAdmin: opts.isAdmin, policyMaxConcurrent: entitlement.maxConcurrent });
  const claim = await claimJobStart({
    jobId: job.id,
    userId: ownerId,
    feature: featureDef.id,
    maxActivePerUser: maxActive,
    maxActiveGlobal: settings.frenzAiCharacterReplace.limits.maxActiveJobsGlobal,
    maxPerDay: settings.frenzAiCharacterReplace.limits.maxJobsPerUserPerDay,
    chargedCents: useCredits ? 0 : quote.totalUsdCents,
    metadata,
    funding: useCredits ? "credits" : "balance",
    queue: false,
  });
  if (claim === "user_limit" || claim === "waiting") {
    await transitionJob(job.id, ["queued"], "cancelled", { completed_at: new Date().toISOString(), error_code: null });
    return refuse("CR_ACTIVE_LIMIT");
  }
  if (claim !== "claimed") {
    await transitionJob(job.id, ["queued"], "cancelled", { completed_at: new Date().toISOString(), error_code: null });
    return refuse(claim === "daily_limit" ? "CR_DAILY_LIMIT" : "CR_BUSY");
  }

  /* ── 6 · reserve, now that the row exists to attach it to ──────────────── */
  let reserved = false;
  try {
    if (useCredits && creditDecision) {
      const reservation = await reserveAiCredits({ userId: ownerId, jobId: job.id, feature: featureDef.id, plan: creditDecision.plan!, estimate: creditDecision.estimate, dailyLimit: creditDecision.dailyLimit, weeklyLimit: creditDecision.weeklyLimit, periods: currentPeriods(plans), config: plans }).catch(() => null);
      reserved = !!reservation;
    } else {
      /*
        ── 🔴 THE SNAPSHOT MUST CARRY THE WALLET'S CURRENCY ──────────────────

        Production, 2026-10-04. This passed `{ totalCents }` alone behind an
        `as unknown as` cast, so `snapshot.currency` was `undefined` — and
        `reserve_product_charge` declares `p_currency text default 'NGN'`.
        Every Kling video reservation was therefore written in NGN into a USD
        wallet. The two real Text to Video charges are the ONLY two NGN rows in
        the entire ledger.

        That is not a cosmetic label. `refund_product_charge` (0160) refuses to
        credit a refund whose row currency differs from the wallet's —
        deliberately, because paying NGN minor units back into a USD wallet
        would return ~1,335× the money. So the mis-currency made these charges
        PERMANENTLY unrefundable by code: the guard fired, wrote nothing, and
        returned the balance unchanged, which is why they survived every undo
        path even after the undo paths themselves were fixed.

        The currency is the operator's one setting — the same `frenzAiCurrency`
        the two video pages already price in.
      */
      const snapshot = {
        totalCents: quote.totalUsdCents,
        currency: settings.frenzAiCurrency,
        feature: featureId,
        model: pipeline.model,
        seconds: quote.seconds,
        billableSeconds: quote.billableSeconds,
        resolution: quote.resolution,
        pricingVersion: quote.pricingVersion,
      };
      await reserveAiWalletCharge({ userId: ownerId, jobId: job.id, snapshot: snapshot as unknown as Parameters<typeof reserveAiWalletCharge>[0]["snapshot"] });
      reserved = true;
    }
  } catch {
    reserved = false;
  }
  if (!reserved) {
    await transitionJob(job.id, ["acquiring", "processing", "queued"], "failed", { error_code: "CR_BALANCE_REQUIRED", completed_at: new Date().toISOString() });
    return refuse("CR_BALANCE_REQUIRED");
  }

  /* ── 7 · the pipeline submits its OWN request ──────────────────────────── */
  const undo = async (code: string, detail: string) => {
    /*
      🔴 `releaseJobFunding` reads `funding_source` off the row and runs the
      matching undo. A bespoke refund here would be a second opinion about what
      was taken — and the recorded failure mode is releasing a daily allowance
      on a PAID job, which hands back a free run the member never spent.
    */
    const fresh = { ...job, funding_source: useCredits ? "credits" : "balance" } as typeof job;
    await releaseJobFunding({ job: fresh, subject, feature: featureDef.id, dailyLimit: 0, cause: "undo" }).catch(() => {});
    await transitionJob(job.id, ["queued", "acquiring", "processing"], "failed", { error_code: code, error_message: detail.slice(0, 2000), completed_at: new Date().toISOString() });
  };

  try {
    /*
      🔴 The provider is stamped BEFORE the submit, through the existing
      `stampJobProvider` — the same helper every other tool uses. It is a
      separate write because the column is guarded (`status in
      (acquiring, waiting)` and no prediction id yet), which is what stops a
      second submit re-stamping a job that already has one.
    */
    await stampJobProvider(job.id, "kling", pipeline.model);
    // a one-minute job submits its FIRST 15 s segment; the rest follow from the worker
    const submission = await submitKlingPipeline({ feature: featureId, input: isOneMinute(opts.input) ? asFirstSegment(opts.input) : opts.input, jobId: job.id, callbackUrl: opts.callbackUrl });
    const moved = await transitionJob(
      job.id,
      ["queued", "acquiring"],
      "processing",
      {
        // The shared, provider-neutral idempotency column (§15). Kling's task id
        // lives here exactly as Replicate's and fal's did; the UNIQUE index on it
        // is what stops a duplicate callback finishing a job twice.
        replicate_prediction_id: submission.taskId,
        model: submission.model,
        model_version: null,
        started_at: new Date().toISOString(),
      },
      { predictionId: null },
    );
    if (!moved) {
      await undo("INTERNAL_ERROR", "the job could not be moved to processing after a successful submit");
      return refuse("INTERNAL_ERROR");
    }
  } catch (e) {
    const err = e instanceof AiJobError ? e : null;
    await undo(err?.code ?? "PROVIDER_ERROR", err?.detail ?? String(e));
    return refuse(err?.code ?? "PROVIDER_ERROR", { error: capability.reason ?? undefined });
  }

  return { ok: true, jobId: job.id, quote, funding: useCredits ? "credits" : "balance", balanceCents: balanceBefore, credits: creditDecision ? creditDecisionView(creditDecision) : null };
}

/** The quote as a browser may see it — no provider cost, no units, no margin. */
export function publicKlingQuote(q: KlingQuote & { ok: true }) {
  return {
    feature: q.feature,
    resolution: q.resolution,
    seconds: q.seconds,
    billableSeconds: q.billableSeconds,
    totalCents: q.totalUsdCents,
    pricingVersion: q.pricingVersion,
  };
}
