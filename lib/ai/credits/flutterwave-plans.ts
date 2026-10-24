import "server-only";

import { createHash } from "node:crypto";

import { after } from "next/server";

import type { AiPlanId, AiPlansConfig } from "@/lib/ai/credits/config";
import { welcomeAiPlan, welcomeSitePlan } from "@/lib/ai/credits/plan-welcome";
import { upsertAiSubscription, type AiSubscriptionRow } from "@/lib/ai/credits/subscription";
import { trackEvent } from "@/lib/analytics/events";
import {
  cancelFlutterwaveSubscription,
  findFlutterwaveSubscriptions,
  flutterwaveFailureIsDefinite,
  FlutterwaveHttpError,
  listFlutterwaveTransactions,
  majorToMinor,
  readFlutterwavePlan,
  verifyFlutterwaveById,
  type FlutterwaveSubscription,
} from "@/lib/flutterwave/client";
import { flutterwaveConfigured, getFlutterwaveConfig } from "@/lib/flutterwave/config";
import type { VerifiedCharge } from "@/lib/payments/charge";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PLANS ON FLUTTERWAVE PAYMENT PLANS — Part 3.3 (2026-10-23)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * AI Pro / AI Max (`ai_subscriptions`) and Pro / Business (`subscriptions`) bought as Flutterwave payment plans (USD,
 * card). The Part 3.2 audit found renewals tied to a member by EMAIL and TODAY's price; Part 3.3 replaces that:
 *
 *   IDENTITY — at activation, the subscription Flutterwave created for the verified FIRST charge is looked up by that
 *     charge's transaction id (GET /v3/subscriptions?transaction_id= — documented for the first charge) and checked
 *     (one subscription, our plan, the payer's email, active, the charged amount). Its id, the plan id and the CONTRACT
 *     (amount, currency, interval of that first charge) are stored on the row (0274). Not found yet → no activation,
 *     the attempt stays open and is re-checked; conflicting → no activation, a review.
 *   RENEWALS — Flutterwave documents NO field tying a renewal transaction to its subscription, and the transaction_id
 *     filter is only documented for first charges. So a renewal is extended AUTOMATICALLY only once the operator has
 *     proved that lookup with a sandbox renewal (FLUTTERWAVE_RENEWAL_TX_LOOKUP=confirmed); until then every renewal of a
 *     subscriber is a REVIEW item an admin applies. Either way the one writer is apply_plan_renewal (0274): it locks the
 *     row, checks the stored subscription id, plan and contract, and claims the transaction in `plan_renewals` (unique),
 *     so a transaction extends a plan once — webhook, cron and admin alike. Email and price prove nothing on their own.
 *   CANCELLATION — `subscription.cancelled` carries data.plan as an OBJECT (docs); the plan id + email must match exactly
 *     one stored subscription, whose id must show "cancelled" at Flutterwave. Confirmed → cancel_at_period_end: paid access
 *     continues to the paid-through time (no grace, nothing more). A member's own cancel is by the stored subscription id
 *     and is reported as done only once Flutterwave shows it cancelled. Anything unclear → a review, never a guess.
 *   EXPIRY — expire_flutterwave_site_plan (0274) re-checks under the row lock, so a renewal that landed first wins.
 *   RECONCILIATION — for subscribers near their renewal, GET /v3/transactions (date window, pages, budget) finds charges
 *     a webhook may have missed; each is re-verified by id and goes through the SAME renewal path.
 * Every failure to record (the ledger, a review) is an error the caller retries — never a silent "processed".
 */

export type SitePlanId = "pro" | "business";
export type PlanTarget = "ai_subscription" | "site_subscription";

export const PLAN_INTERVALS = ["daily", "weekly", "monthly", "quarterly", "bi-annually", "yearly"] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

/** Flutterwave's interval words → ours; anything unknown is null (a contract is never guessed). */
export function normalizePlanInterval(v: unknown): PlanInterval | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "annually") return "yearly";
  return (PLAN_INTERVALS as readonly string[]).includes(s) ? (s as PlanInterval) : null;
}

/** A plan interval added to a date (the first period; renewals are computed by the database). */
export function addFlutterwaveInterval(fromIso: string, interval: PlanInterval): string {
  const d = new Date(fromIso);
  if (interval === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else if (interval === "bi-annually") d.setUTCMonth(d.getUTCMonth() + 6);
  else if (interval === "quarterly") d.setUTCMonth(d.getUTCMonth() + 3);
  else if (interval === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (interval === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** One email form for every comparison (trimmed, lower case); "" when absent. */
export const normEmail = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** An email is never stored in a review or an event key — a short hash identifies it there. */
export const emailKey = (email: string): string => createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);

const paidStart = (charge: VerifiedCharge) => (charge.paidAt && Number.isFinite(Date.parse(charge.paidAt)) ? new Date(charge.paidAt).toISOString() : new Date().toISOString());

/* ─────────────────────────────── the review queue (0274) ─────────────────────────────── */

export type ReviewKind = "renewal" | "activation" | "cancellation" | "upgrade";

export interface ReviewInput {
  dedupeKey: string;
  kind: ReviewKind;
  reason: string;
  transactionId?: string | null;
  target?: PlanTarget | null;
  userId?: string | null;
  subscriptionRef?: string | null;
  planCode?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
}

/**
 * Queue something for an admin — once per dedupe key (the webhook and the cron never queue it twice). A queue that
 * cannot be written THROWS: the caller answers "retry", so nothing that needs a person is ever dropped silently.
 */
export async function queueBillingReview(r: ReviewInput): Promise<void> {
  const { error } = await createAdminClient()
    .from("plan_billing_reviews")
    .upsert(
      {
        dedupe_key: r.dedupeKey.slice(0, 200),
        kind: r.kind,
        reason: r.reason.slice(0, 300),
        transaction_id: r.transactionId ?? null,
        target: r.target ?? null,
        user_id: r.userId ?? null,
        subscription_ref: r.subscriptionRef ?? null,
        plan_code: r.planCode ?? null,
        amount_minor: r.amountMinor ?? null,
        currency: r.currency ?? null,
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
  if (error) throw new Error("plan billing review could not be queued");
}

/* ─────────────────────────────── identity at activation ─────────────────────────────── */

type Identity = { kind: "ok"; sub: FlutterwaveSubscription } | { kind: "not_found" } | { kind: "conflict"; reason: string };

/**
 * The subscription Flutterwave created for this FIRST charge (documented lookup by its transaction id), checked against
 * what we expect: exactly one, our payment plan, the payer's email, active, and — when Flutterwave reports one — the
 * same amount as the verified charge. A network failure throws (the attempt is re-checked later).
 */
async function subscriptionForFirstCharge(charge: VerifiedCharge, expectedPlanId: string): Promise<Identity> {
  if (!charge.externalId) return { kind: "conflict", reason: "the charge has no transaction id" };
  const subs = await findFlutterwaveSubscriptions({ transactionId: charge.externalId });
  if (!subs.length) return { kind: "not_found" };
  if (subs.length > 1) return { kind: "conflict", reason: "several Flutterwave subscriptions for one first charge" };
  const s = subs[0]!;
  if (s.plan !== expectedPlanId) return { kind: "conflict", reason: "the subscription is on another payment plan" };
  // Part 3.3.2 (L1): a customer match is REQUIRED — both emails present and equal; a missing one is never a match
  const payer = normEmail(charge.customerEmail);
  const holder = normEmail(s.email);
  if (!payer || !holder) return { kind: "conflict", reason: "the charge or the subscription carries no customer email to match" };
  if (payer !== holder) return { kind: "conflict", reason: "the subscription belongs to another customer" };
  if (s.status !== "active") return { kind: "conflict", reason: `the subscription is ${s.status || "not active"}` };
  if (s.amount !== null && majorToMinor(s.amount, charge.currency) !== charge.amountMinor) return { kind: "conflict", reason: "the subscription amount differs from the first charge" };
  return { kind: "ok", sub: s };
}

export type ActivationResult = { ok: true } | { ok: false; retry: true; reason: string } | { ok: false; retry?: false; reason: string };

/** The interval and identity checks shared by both plan kinds; a review is queued for anything that is not a clean yes. */
async function proveFirstCharge(i: { target: PlanTarget; userId: string; reference: string; charge: VerifiedCharge; planId: string }): Promise<{ ok: true; sub: FlutterwaveSubscription; interval: PlanInterval } | ActivationResult> {
  const facts = await readFlutterwavePlan(i.planId);
  const interval = normalizePlanInterval(facts.interval);
  const review = (reason: string) => queueBillingReview({ dedupeKey: `activation:${i.reference}`, kind: "activation", reason, transactionId: i.charge.externalId, target: i.target, userId: i.userId, planCode: i.planId, amountMinor: i.charge.amountMinor, currency: i.charge.currency });
  if (!interval) {
    await review(`the payment plan's interval "${facts.interval}" is not one we can hold a contract to`);
    return { ok: false, reason: "plan interval unknown" };
  }
  const id = await subscriptionForFirstCharge(i.charge, i.planId);
  if (id.kind === "not_found") {
    // Flutterwave may create the subscription a moment after the charge: the attempt stays open and is checked again
    await review("paid, but Flutterwave has not shown the subscription for this first charge yet — re-checked every 10 minutes");
    return { ok: false, retry: true, reason: "subscription not found yet" };
  }
  if (id.kind === "conflict") {
    await review(id.reason);
    return { ok: false, reason: id.reason };
  }
  return { ok: true, sub: id.sub, interval };
}

/** Does Flutterwave list this subscription id as cancelled? Any doubt (no email or plan to look it up by, an error) is "no". */
async function confirmedCancelled(ref: string, email: string | null, planCode: string | null): Promise<boolean> {
  if (!email || !planCode) return false;
  try {
    const subs = await findFlutterwaveSubscriptions({ email, plan: planCode });
    return subs.find((s) => s.id === ref)?.status === "cancelled";
  } catch {
    return false;
  }
}

/**
 * After a NEW subscription is active (an upgrade): stop the OLD one at Flutterwave by its stored id. Confirmed only when
 * Flutterwave lists it as cancelled; anything else is a review (the old one might still charge the member).
 */
async function retireOldSubscription(i: { target: PlanTarget; userId: string; oldRef: string; oldPlanCode: string | null; email: string | null }): Promise<void> {
  const review = (reason: string) => queueBillingReview({ dedupeKey: `upgrade:${i.target}:${i.oldRef}`, kind: "upgrade", reason, target: i.target, userId: i.userId, subscriptionRef: i.oldRef, planCode: i.oldPlanCode });
  try {
    await cancelFlutterwaveSubscription(i.oldRef);
  } catch (e) {
    await review(flutterwaveFailureIsDefinite(e) ? "Flutterwave refused to cancel the subscription replaced by an upgrade" : "cancelling the replaced subscription got no clear answer — it may still charge");
    return;
  }
  if (!(await confirmedCancelled(i.oldRef, i.email, i.oldPlanCode))) await review("asked Flutterwave to cancel the replaced subscription but could not confirm it is cancelled");
}

/** A legacy attempt with no stored plan id: never guessed from today's configuration — a review, no plan. */
async function refuseWithoutStoredPlan(i: { userId: string; reference: string; charge: VerifiedCharge }, target: PlanTarget): Promise<ActivationResult> {
  await queueBillingReview({ dedupeKey: `activation:${i.reference}`, kind: "activation", reason: "paid, but the attempt has no stored Flutterwave plan id (an attempt from before Part 3.3.2) — settle by hand", transactionId: i.charge.externalId, target, userId: i.userId, amountMinor: i.charge.amountMinor, currency: i.charge.currency });
  return { ok: false, reason: "attempt has no stored plan id" };
}

/** AI plan: the first charge, already verified exactly against our attempt. Idempotent on the reference. */
export async function activateFlutterwavePlan(i: { userId: string; plan: AiPlanId; reference: string; charge: VerifiedCharge; config: AiPlansConfig; planId: string | null }): Promise<ActivationResult> {
  const p = i.config.plans[i.plan];
  if (!p?.enabled) return { ok: false, reason: "plan disabled" };
  // Part 3.3.2 (L2): held to the plan id stored WITH THE ATTEMPT at checkout — never re-read from today's configuration
  if (!i.planId) return refuseWithoutStoredPlan(i, "ai_subscription");
  const { data: existingRow } = await createAdminClient().from("ai_subscriptions").select("*").eq("user_id", i.userId).maybeSingle();
  const existing = (existingRow as AiSubscriptionRow | null) ?? null;
  if (existing?.last_reference === i.reference && existing.subscription_ref) return { ok: true };
  // what the member held BEFORE this purchase (read now: the write below replaces it)
  const previous = existing?.provider === "flutterwave" && existing.subscription_ref ? { ref: existing.subscription_ref, planCode: existing.plan_code, email: existing.customer_ref } : null;
  const proof = await proveFirstCharge({ target: "ai_subscription", userId: i.userId, reference: i.reference, charge: i.charge, planId: i.planId });
  if (!("sub" in proof)) return proof;
  const start = paidStart(i.charge);
  const written = await upsertAiSubscription({
    userId: i.userId,
    plan: i.plan,
    status: "active",
    provider: "flutterwave",
    planCode: i.planId,
    customerRef: i.charge.customerEmail ?? null,
    subscriptionRef: proof.sub.id,
    reference: i.reference,
    currentPeriodStart: start,
    currentPeriodEnd: addFlutterwaveInterval(start, proof.interval),
    contractAmountMinor: i.charge.amountMinor,
    contractCurrency: i.charge.currency,
    contractInterval: proof.interval,
  });
  if (written.written) after(() => welcomeAiPlan(i.userId, i.plan, i.config));
  // an upgrade (AI Pro → AI Max): the old Flutterwave subscription must stop charging — only now, after the new one is active
  if (previous && previous.ref !== proof.sub.id) {
    await retireOldSubscription({ target: "ai_subscription", userId: i.userId, oldRef: previous.ref, oldPlanCode: previous.planCode, email: previous.email });
  }
  return { ok: true };
}

interface SiteSubRow {
  user_id: string;
  plan: string;
  status: string | null;
  provider: string;
  customer_ref: string | null;
  subscription_ref: string | null;
  plan_code: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  last_reference?: string | null;
}

/** BILLING NEVER DEMOTES AN ADMINISTRATOR (lib/paystack/sync.ts, migration 0136): the role write skips admins. */
async function setSiteRole(userId: string, paid: boolean): Promise<void> {
  await createAdminClient().from("profiles").update({ role: paid ? "pro" : "user" }).eq("id", userId).neq("role", "admin");
}

/** Pro / Business: the first charge, already verified exactly. Idempotent on the reference. */
export async function activateFlutterwaveSitePlan(i: { userId: string; plan: SitePlanId; reference: string; charge: VerifiedCharge; planId: string | null }): Promise<ActivationResult> {
  const db = createAdminClient();
  const { data: existingRow } = await db.from("subscriptions").select("*").eq("user_id", i.userId).maybeSingle();
  const existing = (existingRow as SiteSubRow | null) ?? null;
  if (existing?.last_reference === i.reference && existing.subscription_ref) return { ok: true };
  // what the member held BEFORE this purchase (read now: the write below replaces it)
  const previous = existing?.provider === "flutterwave" && existing.subscription_ref ? { ref: existing.subscription_ref, planCode: existing.plan_code, email: existing.customer_ref } : null;
  // Part 3.3.2 (L2): the plan id stored with the attempt at checkout, never today's configuration
  const planId = i.planId;
  if (!planId) return refuseWithoutStoredPlan(i, "site_subscription");
  const proof = await proveFirstCharge({ target: "site_subscription", userId: i.userId, reference: i.reference, charge: i.charge, planId });
  if (!("sub" in proof)) return proof;
  const start = paidStart(i.charge);
  const { error } = await db.from("subscriptions").upsert(
    {
      user_id: i.userId,
      plan: i.plan,
      status: "active",
      provider: "flutterwave",
      customer_ref: i.charge.customerEmail ?? null,
      subscription_ref: proof.sub.id,
      plan_code: planId,
      email_token: null,
      current_period_end: addFlutterwaveInterval(start, proof.interval),
      cancel_at_period_end: false,
      last_reference: i.reference,
      contract_amount_minor: i.charge.amountMinor,
      contract_currency: i.charge.currency,
      contract_interval: proof.interval,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error("subscriptions write failed");
  await setSiteRole(i.userId, true);
  trackEvent("subscribe", { userId: i.userId, metadata: { plan: i.plan, status: "active", provider: "flutterwave" } });
  after(() => welcomeSitePlan(i.userId, i.plan));
  // Pro → Business: the old Flutterwave subscription stops only now, after the new one is active
  if (previous && previous.ref !== proof.sub.id) {
    await retireOldSubscription({ target: "site_subscription", userId: i.userId, oldRef: previous.ref, oldPlanCode: previous.planCode, email: previous.email });
  }
  return { ok: true };
}

/* ───────────────────── one-off naira months (Nigeria, 2026-10-24) ───────────────────── */

/**
 * A plan paid ONCE for one month (owner, 2026-10-24: "Nigeria: one-off naira month") — bank transfer, USSD or card in
 * naira, so no Flutterwave subscription exists and nothing renews. The charge was already verified EXACTLY against the
 * attempt row (amount and currency written at checkout). The period starts now — or, renewing the SAME plan while it is
 * still running, at its current end — and the row is marked to end with it (`cancel_at_period_end`: no renewal grace,
 * the existing expiry ends it). Idempotent on the reference. A member who still has an auto-renewing subscription is
 * never overwritten (it would keep charging, untracked): a review, no plan change.
 */
type OneOffInput = { userId: string; reference: string; charge: VerifiedCharge; /** the prepaid period recorded at checkout (default one month) */ period?: "monthly" | "quarterly" };

function oneOffWindow(existing: { plan: string | null; status: string | null; provider: string | null; current_period_end: string | null } | null, plan: string, charge: VerifiedCharge, period: "monthly" | "quarterly" = "monthly"): { start: string; end: string } {
  const now = Date.now();
  const runningEnd = existing?.current_period_end ? Date.parse(existing.current_period_end) : NaN;
  const sameRunning = existing?.plan === plan && existing.provider === "flutterwave" && existing.status === "active" && Number.isFinite(runningEnd) && runningEnd > now;
  const start = sameRunning ? new Date(runningEnd).toISOString() : paidStart(charge);
  return { start, end: addFlutterwaveInterval(start, period) };
}

async function recurringStillActive(i: OneOffInput, target: PlanTarget, row: { provider: string | null; subscription_ref: string | null; cancel_at_period_end: boolean | null; status: string | null } | null): Promise<boolean> {
  if (!(row?.provider === "flutterwave" && row.subscription_ref && !row.cancel_at_period_end && row.status === "active")) return false;
  await queueBillingReview({ dedupeKey: `oneoff:${i.reference}`, kind: "activation", reason: "a one-off month was paid while an auto-renewing subscription is still active — not applied; settle by hand", transactionId: i.charge.externalId, target, userId: i.userId, subscriptionRef: row.subscription_ref, amountMinor: i.charge.amountMinor, currency: i.charge.currency });
  return true;
}

export async function activateOneOffAiPlan(i: OneOffInput & { plan: AiPlanId; config: AiPlansConfig }): Promise<ActivationResult> {
  const p = i.config.plans[i.plan];
  if (!p?.enabled) return { ok: false, reason: "plan disabled" };
  const { data } = await createAdminClient().from("ai_subscriptions").select("*").eq("user_id", i.userId).maybeSingle();
  const existing = (data as AiSubscriptionRow | null) ?? null;
  if (existing?.last_reference === i.reference) return { ok: true };
  if (await recurringStillActive(i, "ai_subscription", existing)) return { ok: false, reason: "auto-renewing subscription still active" };
  const w = oneOffWindow(existing, i.plan, i.charge, i.period);
  const written = await upsertAiSubscription({
    userId: i.userId,
    plan: i.plan,
    status: "active",
    provider: "flutterwave",
    planCode: null,
    customerRef: i.charge.customerEmail ?? null,
    subscriptionRef: null,
    reference: i.reference,
    currentPeriodStart: w.start,
    currentPeriodEnd: w.end,
    cancelAtPeriodEnd: true,
    contractAmountMinor: null,
    contractCurrency: null,
    contractInterval: null,
  });
  if (written.written) after(() => welcomeAiPlan(i.userId, i.plan, i.config));
  return { ok: true };
}

export async function activateOneOffSitePlan(i: OneOffInput & { plan: SitePlanId }): Promise<ActivationResult> {
  const db = createAdminClient();
  const { data } = await db.from("subscriptions").select("*").eq("user_id", i.userId).maybeSingle();
  const existing = (data as SiteSubRow | null) ?? null;
  if (existing?.last_reference === i.reference) return { ok: true };
  if (await recurringStillActive(i, "site_subscription", existing)) return { ok: false, reason: "auto-renewing subscription still active" };
  const w = oneOffWindow(existing, i.plan, i.charge, i.period);
  const { error } = await db.from("subscriptions").upsert(
    {
      user_id: i.userId,
      plan: i.plan,
      status: "active",
      provider: "flutterwave",
      customer_ref: i.charge.customerEmail ?? null,
      subscription_ref: null,
      plan_code: null,
      email_token: null,
      current_period_end: w.end,
      cancel_at_period_end: true,
      last_reference: i.reference,
      contract_amount_minor: null,
      contract_currency: null,
      contract_interval: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error("subscriptions write failed");
  await setSiteRole(i.userId, true);
  trackEvent("subscribe", { userId: i.userId, metadata: { plan: i.plan, status: "active", provider: "flutterwave", one_off: true } });
  after(() => welcomeSitePlan(i.userId, i.plan));
  return { ok: true };
}

/* ─────────────────────────────── renewals ─────────────────────────────── */

/** `ack`: answer the provider 200; `final`: the delivery may be marked processed (false = a later delivery is still welcome). */
export interface PlanEventResult {
  ack: boolean;
  final: boolean;
  outcome: string;
}

interface StoredSub {
  target: PlanTarget;
  user_id: string;
  subscription_ref: string | null;
  plan_code: string | null;
  customer_ref: string | null;
}

async function flutterwaveRowsBy(column: "customer_ref" | "subscription_ref", value: string): Promise<StoredSub[]> {
  const db = createAdminClient();
  const [ai, site] = await Promise.all([
    db.from("ai_subscriptions").select("user_id, subscription_ref, plan_code, customer_ref").eq("provider", "flutterwave").eq(column, value).limit(5),
    db.from("subscriptions").select("user_id, subscription_ref, plan_code, customer_ref").eq("provider", "flutterwave").eq(column, value).limit(5),
  ]);
  if (ai.error || site.error) throw new Error("subscription lookup failed");
  return [
    ...((ai.data ?? []) as Omit<StoredSub, "target">[]).map((r) => ({ ...r, target: "ai_subscription" as const })),
    ...((site.data ?? []) as Omit<StoredSub, "target">[]).map((r) => ({ ...r, target: "site_subscription" as const })),
  ];
}

const renewalKey = (txId: string) => `renewal:flutterwave:${txId}`;

export type OwnershipProof = { ok: true; row: StoredSub; sub: FlutterwaveSubscription } | { ok: false; retry: boolean; reason: string };

/**
 * Part 3.3.2 (H1) — does FLUTTERWAVE prove this transaction renews one of OUR stored subscriptions? The ONE test used by
 * the automatic path AND an admin's "Apply", so neither can trust anything else:
 *   · the operator has confirmed (sandbox) that the transaction_id lookup finds RENEWALS (documented for first charges only);
 *   · Flutterwave links the transaction to exactly ONE subscription …
 *   · … stored on exactly ONE of our Flutterwave rows (by its subscription id — never by an email);
 *   · on that row's stored payment plan;
 *   · for the same customer: the charge's email, the subscription's and the row's — all present, all equal.
 * The contract (amount, currency, interval) is then checked again by apply_plan_renewal under the row lock.
 * `retry` = Flutterwave or our database could not be reached (ask again later); otherwise a refusal.
 */
export async function proveRenewalOwnership(charge: VerifiedCharge): Promise<OwnershipProof> {
  const tx = charge.externalId;
  if (!tx || !/^\d{1,20}$/.test(tx)) return { ok: false, retry: false, reason: "the charge has no transaction id" };
  if (!(await getFlutterwaveConfig()).renewalLookupConfirmed) return { ok: false, retry: false, reason: "ownership not proven by Flutterwave: the renewal lookup is not confirmed yet (sandbox check, FLUTTERWAVE_RENEWAL_TX_LOOKUP)" };
  let subs: FlutterwaveSubscription[];
  try {
    subs = await findFlutterwaveSubscriptions({ transactionId: tx });
  } catch {
    return { ok: false, retry: true, reason: "Flutterwave could not be asked which subscription this transaction belongs to" };
  }
  if (subs.length !== 1) return { ok: false, retry: false, reason: subs.length ? "Flutterwave links this transaction to several subscriptions" : "Flutterwave links this transaction to no subscription" };
  const sub = subs[0]!;
  let rows: StoredSub[];
  try {
    rows = await flutterwaveRowsBy("subscription_ref", sub.id);
  } catch {
    return { ok: false, retry: true, reason: "the stored subscriptions could not be read" };
  }
  if (rows.length !== 1) return { ok: false, retry: false, reason: rows.length ? "the subscription is stored on more than one plan row" : "the subscription Flutterwave names is not one we store" };
  const row = rows[0]!;
  if (!row.plan_code || sub.plan !== row.plan_code) return { ok: false, retry: false, reason: "the subscription is on another payment plan than the one stored" };
  const payer = normEmail(charge.customerEmail);
  if (!payer || !normEmail(sub.email) || !normEmail(row.customer_ref)) return { ok: false, retry: false, reason: "a customer email is missing — a missing identity is never a match" };
  if (payer !== normEmail(sub.email) || payer !== normEmail(row.customer_ref)) return { ok: false, retry: false, reason: "the charge, the subscription and the stored plan are not the same customer" };
  return { ok: true, row, sub };
}

/** The ledger, with a PROVEN identity only. null = it could not be reached or answered unclearly (never "done"). */
async function applyProven(charge: VerifiedCharge, proof: { row: StoredSub; sub: FlutterwaveSubscription }, source: "webhook" | "reconcile" | "admin", adminId: string | null): Promise<string | null> {
  const { data, error } = await createAdminClient().rpc("apply_plan_renewal", {
    p_provider: "flutterwave",
    p_transaction_id: charge.externalId,
    p_target: proof.row.target,
    p_user_id: proof.row.user_id,
    p_subscription_ref: proof.sub.id,
    p_plan_code: proof.row.plan_code,
    p_amount_minor: charge.amountMinor,
    p_currency: charge.currency,
    p_source: source,
    p_admin: adminId,
  });
  if (error || !data) return null;
  const result = String((data as { result?: string }).result ?? "");
  return result || null;
}

/**
 * A Flutterwave charge that is NOT the first charge of one of our attempts — possibly a renewal. `charge` was verified BY ID.
 * Extended only when proveRenewalOwnership passes, through apply_plan_renewal. Anything unproven from a customer we bill is
 * a review WITHOUT a subscription link (Part 3.3.2: an email match never becomes a trusted target); a charge from nobody
 * we bill is ignored.
 */
export async function handleFlutterwaveRenewal(charge: VerifiedCharge, opts: { source: "webhook" | "reconcile" } = { source: "webhook" }): Promise<PlanEventResult> {
  if (charge.status === "pending") return { ack: true, final: false, outcome: "renewal:pending" };
  if (charge.status !== "success") return { ack: true, final: true, outcome: `renewal:${charge.status}` };
  const tx = charge.externalId;
  if (!tx || !/^\d{1,20}$/.test(tx)) return { ack: true, final: true, outcome: "renewal:unidentified" };

  const db = createAdminClient();
  const { data: done, error: doneError } = await db.from("plan_renewals").select("id").eq("provider", "flutterwave").eq("transaction_id", tx).maybeSingle();
  if (doneError) return { ack: false, final: false, outcome: "renewal:ledger_unavailable" };
  if (done) return { ack: true, final: true, outcome: "renewal:duplicate" };

  // who could this be? a COUNT for the review's context only — an email never proves anything, and is never stored
  const byEmail = charge.customerEmail ? await flutterwaveRowsBy("customer_ref", charge.customerEmail) : [];
  if (!byEmail.length) return { ack: true, final: true, outcome: "renewal:not_ours" };
  const review = async (reason: string): Promise<PlanEventResult> => {
    await queueBillingReview({ dedupeKey: renewalKey(tx), kind: "renewal", reason: `${reason} (${byEmail.length} stored Flutterwave plan${byEmail.length === 1 ? "" : "s"} share the payer's email — not proof)`, transactionId: tx, amountMinor: charge.amountMinor, currency: charge.currency });
    return { ack: true, final: true, outcome: "renewal:review" };
  };

  const proof = await proveRenewalOwnership(charge);
  if (!proof.ok) return proof.retry ? { ack: false, final: false, outcome: "renewal:lookup_failed" } : review(proof.reason);
  const result = await applyProven(charge, proof, opts.source, null);
  // the ledger could not be reached or answered unclearly: never treated as done
  if (!result) return { ack: false, final: false, outcome: "renewal:ledger_unavailable" };
  if (result === "applied") return { ack: true, final: true, outcome: "renewal:applied" };
  if (result === "duplicate") return { ack: true, final: true, outcome: "renewal:duplicate" };
  return review(`not applied: ${result}`);
}

/* ─────────────────────────────── cancellation ─────────────────────────────── */

/**
 * The documented `subscription.cancelled` payload: data.customer.email and data.plan — an OBJECT { id, name, amount, … }.
 * A bare number/string plan id is accepted too. null when either is missing or malformed.
 */
export function parseCancellationEvent(data: unknown): { email: string; planId: string } | null {
  const d = (data && typeof data === "object" ? data : {}) as { customer?: { email?: unknown } | null; plan?: unknown };
  const email = typeof d.customer?.email === "string" ? d.customer.email.trim().toLowerCase() : "";
  const rawPlan = d.plan && typeof d.plan === "object" ? (d.plan as { id?: unknown }).id : d.plan;
  const planId = typeof rawPlan === "number" || typeof rawPlan === "string" ? String(rawPlan).trim() : "";
  if (!email || !/^\d{1,12}$/.test(planId)) return null;
  return { email, planId };
}

async function markCancelAtPeriodEnd(target: PlanTarget, userId: string, ref: string): Promise<void> {
  // only the row that still holds THIS subscription (a newer one after an upgrade is never touched)
  const { error } = await createAdminClient()
    .from(target === "ai_subscription" ? "ai_subscriptions" : "subscriptions")
    .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("provider", "flutterwave")
    .eq("subscription_ref", ref);
  if (error) throw new Error("cancel flag write failed");
}

/**
 * subscription.cancelled — a nudge, CHECKED: the plan id + email must match exactly one stored subscription, and Flutterwave
 * must list that subscription id as cancelled. Confirmed → cancel at period end (paid access kept to the paid-through
 * time). Still active → nothing. Anything else → a review. Never routed by guesswork to the AI or the site plan.
 * `eventKey` names the delivery for the event log (no raw email in it).
 */
export async function handleFlutterwaveSubscriptionCancelled(data: unknown): Promise<PlanEventResult & { eventKey: string | null }> {
  const parsed = parseCancellationEvent(data);
  if (!parsed) {
    await queueBillingReview({ dedupeKey: `cancellation:unparsed:${createHash("sha256").update(JSON.stringify(data ?? null)).digest("hex").slice(0, 24)}`, kind: "cancellation", reason: "a subscription.cancelled event without a usable customer email or plan id" });
    return { ack: true, final: true, outcome: "cancel:unparsed", eventKey: null };
  }
  const key = `cancellation:${parsed.planId}:${emailKey(parsed.email)}`;
  const eventKey = `subscription.cancelled:${parsed.planId}:${emailKey(parsed.email)}:${new Date().toISOString().slice(0, 10)}`;
  const rows = (await flutterwaveRowsBy("customer_ref", parsed.email)).filter((r) => r.plan_code === parsed.planId);
  if (rows.length !== 1) {
    await queueBillingReview({ dedupeKey: key, kind: "cancellation", reason: rows.length ? "the cancelled plan matches more than one stored subscription" : "the cancelled plan matches no stored subscription", planCode: parsed.planId });
    return { ack: true, final: true, outcome: "cancel:review", eventKey };
  }
  const row = rows[0]!;
  const review = async (reason: string) => {
    await queueBillingReview({ dedupeKey: key, kind: "cancellation", reason, target: row.target, userId: row.user_id, subscriptionRef: row.subscription_ref, planCode: parsed.planId });
    return { ack: true, final: true, outcome: "cancel:review", eventKey };
  };
  if (!row.subscription_ref) return review("the stored plan has no Flutterwave subscription id to check");
  let subs: FlutterwaveSubscription[];
  try {
    subs = await findFlutterwaveSubscriptions({ email: parsed.email, plan: parsed.planId });
  } catch {
    return { ack: false, final: false, outcome: "cancel:check_failed", eventKey };
  }
  const s = subs.find((x) => x.id === row.subscription_ref);
  if (!s) return review("Flutterwave does not list the stored subscription for this customer and plan");
  if (s.status === "active") return { ack: true, final: true, outcome: "cancel:still_active", eventKey };
  if (s.status !== "cancelled") return review(`Flutterwave reports the subscription as "${s.status}"`);
  await markCancelAtPeriodEnd(row.target, row.user_id, row.subscription_ref);
  return { ack: true, final: true, outcome: "cancel:confirmed", eventKey };
}

export type MemberCancelResult = { ok: true; periodEnd: string | null } | { ok: false; error: string; status: number };

/**
 * The member's own cancel, by the STORED subscription id. Done only when Flutterwave then lists it as cancelled; a refusal
 * is an error, an unclear answer is "not confirmed — try again" (nothing written either way). Never another subscription
 * of the same email.
 */
async function cancelForMember(target: PlanTarget, row: { user_id: string; subscription_ref: string | null; plan_code: string | null; customer_ref: string | null; current_period_end: string | null }): Promise<MemberCancelResult> {
  if (!row.subscription_ref || !row.plan_code || !row.customer_ref) {
    await queueBillingReview({ dedupeKey: `cancellation:member:${target}:${row.user_id}`, kind: "cancellation", reason: "a member asked to cancel, but the plan has no stored Flutterwave subscription id — cancel it by hand", target, userId: row.user_id, subscriptionRef: row.subscription_ref, planCode: row.plan_code });
    return { ok: false, status: 409, error: "We can't cancel this one automatically yet — our team has been told and will stop it for you." };
  }
  try {
    await cancelFlutterwaveSubscription(row.subscription_ref);
  } catch (e) {
    if (flutterwaveFailureIsDefinite(e)) return { ok: false, status: 409, error: "Flutterwave refused the cancellation. Please contact support." };
    return { ok: false, status: 503, error: "Couldn't reach Flutterwave to cancel. Try again in a moment." };
  }
  if (!(await confirmedCancelled(row.subscription_ref, row.customer_ref, row.plan_code))) {
    return { ok: false, status: 503, error: "We asked Flutterwave to stop the charges but couldn't confirm it yet. Try again in a minute." };
  }
  await markCancelAtPeriodEnd(target, row.user_id, row.subscription_ref);
  return { ok: true, periodEnd: row.current_period_end };
}

/** The member's own cancel of an AI plan. */
export async function cancelFlutterwavePlan(userId: string): Promise<MemberCancelResult> {
  const { data } = await createAdminClient().from("ai_subscriptions").select("*").eq("user_id", userId).maybeSingle();
  const row = data as AiSubscriptionRow | null;
  if (!row || row.provider !== "flutterwave") return { ok: false, error: "No Flutterwave plan to cancel.", status: 404 };
  return cancelForMember("ai_subscription", row);
}

/** The member's own cancel of a Pro / Business plan. */
export async function cancelFlutterwaveSitePlan(userId: string): Promise<MemberCancelResult> {
  const { data } = await createAdminClient().from("subscriptions").select("*").eq("user_id", userId).maybeSingle();
  const row = data as SiteSubRow | null;
  if (!row || row.provider !== "flutterwave" || (row.plan !== "pro" && row.plan !== "business")) return { ok: false, error: "No Flutterwave plan to cancel.", status: 404 };
  const out = await cancelForMember("site_subscription", row);
  if (out.ok) trackEvent("subscribe_cancel", { userId, metadata: { plan: row.plan, status: "cancel_at_period_end", provider: "flutterwave" } });
  return out;
}

/* ─────────────────────────────── expiry (cron) ─────────────────────────────── */

/**
 * Pro / Business plans on Flutterwave whose paid period ran out: each is closed by expire_flutterwave_site_plan (0274),
 * which re-checks UNDER THE ROW LOCK (a renewal that landed after this query wins). Bounded; the ai-reconcile cron runs it.
 */
export async function expireFlutterwaveSitePlans(limit = 100, now = Date.now()): Promise<{ expired: number; errors: number }> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("subscriptions")
    .select("user_id")
    .eq("provider", "flutterwave")
    .in("status", ["active", "trialing"])
    .lt("current_period_end", new Date(now).toISOString())
    .limit(Math.max(1, Math.min(500, limit)));
  if (error || !data?.length) return { expired: 0, errors: error ? 1 : 0 };
  let expired = 0;
  let errors = 0;
  for (const r of data as { user_id: string }[]) {
    const { data: out, error: rpcError } = await db.rpc("expire_flutterwave_site_plan", { p_user_id: r.user_id });
    if (rpcError) errors += 1;
    else if (out === "expired") expired += 1;
  }
  return { expired, errors };
}

/* ─────────────────────────────── missed-renewal reconciliation (cron) ─────────────────────────────── */

export interface RenewalSweepSummary {
  examined: number;
  transactions: number;
  applied: number;
  reviewed: number;
  duplicates: number;
  rateLimited: boolean;
  errors: number;
  skipped?: string;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Charges a webhook may have missed, for Flutterwave subscribers near their renewal: GET /v3/transactions for that
 * customer over a bounded window (pages capped, a time budget, stop at a 429), each candidate RE-VERIFIED by id and sent
 * through the same renewal path — so a run, or two runs, can never extend a period twice (plan_renewals is unique).
 */
export async function reconcileFlutterwaveRenewals(opts: { limit?: number; budgetMs?: number; maxPages?: number; now?: number } = {}): Promise<RenewalSweepSummary> {
  const summary: RenewalSweepSummary = { examined: 0, transactions: 0, applied: 0, reviewed: 0, duplicates: 0, rateLimited: false, errors: 0 };
  if (!flutterwaveConfigured(await getFlutterwaveConfig())) return { ...summary, skipped: "not_configured" };
  const now = opts.now ?? Date.now();
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  const limit = Math.max(1, Math.min(50, opts.limit ?? 10));
  const db = createAdminClient();
  const near = async (table: "ai_subscriptions" | "subscriptions") =>
    db
      .from(table)
      .select("customer_ref, current_period_end")
      .eq("provider", "flutterwave")
      .in("status", ["active", "trialing", "past_due"])
      .not("subscription_ref", "is", null)
      .not("customer_ref", "is", null)
      .gte("current_period_end", new Date(now - 4 * 86_400_000).toISOString())
      .lte("current_period_end", new Date(now + 86_400_000).toISOString())
      .limit(limit);
  const [ai, site] = await Promise.all([near("ai_subscriptions"), near("subscriptions")]);
  if (ai.error || site.error) return { ...summary, errors: 1 };
  const rows = [...((ai.data ?? []) as { customer_ref: string; current_period_end: string }[]), ...((site.data ?? []) as { customer_ref: string; current_period_end: string }[])];
  const emails = [...new Set(rows.map((r) => r.customer_ref))];

  for (const email of emails) {
    if (Date.now() > deadline || summary.rateLimited) break;
    summary.examined += 1;
    const ends = rows.filter((r) => r.customer_ref === email).map((r) => Date.parse(r.current_period_end));
    const from = isoDay(Math.min(...ends) - 3 * 86_400_000);
    const to = isoDay(now);
    for (let page = 1; page <= (opts.maxPages ?? 3); page++) {
      if (Date.now() > deadline || summary.rateLimited) break;
      let listed;
      try {
        listed = await listFlutterwaveTransactions({ from, to, customerEmail: email, status: "successful", page });
      } catch (e) {
        if (e instanceof FlutterwaveHttpError && e.httpStatus === 429) summary.rateLimited = true;
        else summary.errors += 1;
        break;
      }
      for (const t of listed.items) {
        if (Date.now() > deadline || summary.rateLimited) break;
        // a first charge of one of our attempts is settled by the attempt sweep, never here; done or queued → skip
        const [{ data: firstCharge }, { data: applied }, { data: queued }] = await Promise.all([
          db.from("ai_topup_attempts").select("reference").eq("provider", "flutterwave").eq("charge_id", t.id).maybeSingle(),
          db.from("plan_renewals").select("id").eq("provider", "flutterwave").eq("transaction_id", t.id).maybeSingle(),
          db.from("plan_billing_reviews").select("id").eq("dedupe_key", renewalKey(t.id)).maybeSingle(),
        ]);
        if (firstCharge || applied || queued) continue;
        summary.transactions += 1;
        try {
          const charge = await verifyFlutterwaveById(t.id);
          const out = await handleFlutterwaveRenewal(charge, { source: "reconcile" });
          if (out.outcome === "renewal:applied") summary.applied += 1;
          else if (out.outcome === "renewal:review") summary.reviewed += 1;
          else if (out.outcome === "renewal:duplicate") summary.duplicates += 1;
          else if (!out.ack) summary.errors += 1;
        } catch (e) {
          if (e instanceof FlutterwaveHttpError && e.httpStatus === 429) summary.rateLimited = true;
          else summary.errors += 1;
        }
      }
      if (page >= listed.totalPages) break;
    }
  }
  return summary;
}

/* ─────────────────────────────── admin: the review queue ─────────────────────────────── */

export interface BillingReviewRow {
  id: string;
  kind: ReviewKind;
  reason: string;
  status: string;
  transaction_id: string | null;
  target: PlanTarget | null;
  user_id: string | null;
  subscription_ref: string | null;
  plan_code: string | null;
  amount_minor: number | null;
  currency: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
}

const REVIEW_COLUMNS = "id, kind, reason, status, transaction_id, target, user_id, subscription_ref, plan_code, amount_minor, currency, created_at, updated_at, resolved_at, resolution_note";

export async function listBillingReviews(status: "open" | "closed" = "open", limit = 100): Promise<BillingReviewRow[]> {
  const base = createAdminClient().from("plan_billing_reviews").select(REVIEW_COLUMNS);
  const { data, error } = await (status === "open" ? base.eq("status", "open") : base.neq("status", "open")).order("created_at", { ascending: false }).limit(Math.max(1, Math.min(200, limit)));
  if (error) throw new Error("reviews unavailable");
  return (data ?? []) as BillingReviewRow[];
}

/**
 * An admin applies a held renewal — ONLY when Flutterwave proves, right now, that the transaction renews one of our
 * stored subscriptions (Part 3.3.2, H1). The review's own target / member / subscription fields are NOT trusted (a review
 * may predate this rule, or be stale): the identity comes from proveRenewalOwnership alone. Steps: the review is an open
 * renewal → the transaction is re-verified by id (a success, at exactly the review's amount and currency) → ownership is
 * proven (lookup confirmed, one subscription, one stored row, its plan, the same customer — no missing email) →
 * apply_plan_renewal re-checks the contract under the row lock and claims the transaction once. No manual adjudication:
 * an unproven review can only be resolved or dismissed by hand.
 */
export async function applyReviewedRenewal(reviewId: string, adminId: string): Promise<{ ok: true; result: "applied" | "already_applied" } | { ok: false; error: string; status: number }> {
  const db = createAdminClient();
  const { data, error } = await db.from("plan_billing_reviews").select(REVIEW_COLUMNS).eq("id", reviewId).maybeSingle();
  if (error) return { ok: false, error: "Reviews are unavailable.", status: 503 };
  const r = data as BillingReviewRow | null;
  if (!r || r.kind !== "renewal" || r.status !== "open") return { ok: false, error: "Not an open renewal review.", status: 404 };
  if (!r.transaction_id || !r.amount_minor || !r.currency) return { ok: false, error: "This review names no transaction to check — resolve or dismiss it.", status: 409 };
  if (!(await getFlutterwaveConfig()).renewalLookupConfirmed) return { ok: false, error: "Ownership not proven by Flutterwave — automatic renewal proof is not confirmed yet. Resolve or dismiss.", status: 409 };
  let charge: VerifiedCharge;
  try {
    charge = await verifyFlutterwaveById(r.transaction_id);
  } catch {
    return { ok: false, error: "Couldn't re-check the transaction with Flutterwave. Nothing was applied — try again.", status: 503 };
  }
  if (charge.status !== "success" || charge.externalId !== r.transaction_id || charge.amountMinor !== Number(r.amount_minor) || (charge.currency ?? "") !== r.currency) {
    return { ok: false, error: "Flutterwave does not show this as the same successful charge. Nothing was applied.", status: 409 };
  }
  const proof = await proveRenewalOwnership(charge);
  if (!proof.ok) return proof.retry ? { ok: false, error: `${proof.reason}. Nothing was applied — try again.`, status: 503 } : { ok: false, error: `Not applied: ${proof.reason}.`, status: 409 };
  const result = await applyProven(charge, proof, "admin", adminId);
  if (!result) return { ok: false, error: "The renewal ledger did not answer. Nothing was applied.", status: 503 };
  if (result === "applied") return { ok: true, result: "applied" };
  // already applied (the webhook or the cron got there first): 0275 closes this review in the same transaction
  if (result === "duplicate") return { ok: true, result: "already_applied" };
  return { ok: false, error: `Not applied: ${result.replace(/_/g, " ")}.`, status: 409 };
}

/** Close a review an admin dealt with by hand (or dismissed). Only an OPEN review changes. */
export async function closeBillingReview(reviewId: string, adminId: string, status: "resolved" | "dismissed", note: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("plan_billing_reviews")
    .update({ status, resolution_note: note.slice(0, 500) || null, resolved_by: adminId, resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", reviewId)
    .eq("status", "open")
    .select("id");
  return !error && !!data?.length;
}
