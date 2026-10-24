import "server-only";

import { randomUUID } from "node:crypto";

import type { AiPlanId, AiPlansConfig } from "@/lib/ai/credits/config";
import { activateFlutterwavePlan, activateFlutterwaveSitePlan } from "@/lib/ai/credits/flutterwave-plans";
import { activateAiPlanFromVerifiedCharge, AI_PLAN_PURPOSE, isAiPlanId } from "@/lib/ai/credits/paystack";
import { verifyFlutterwaveByReference } from "@/lib/flutterwave/client";
import { flutterwaveConfigured, getFlutterwaveConfig } from "@/lib/flutterwave/config";
import { chargeMatches, type VerifiedCharge } from "@/lib/payments/charge";
import { flutterwaveReferencePurpose, isFlutterwaveReference } from "@/lib/payments/references";
import { paystackEnabled, paystackRefusedForSure, verifyTransaction } from "@/lib/paystack/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI PRO / AI MAX PURCHASES: A DURABLE ATTEMPT, AND RECOVERY (Part 3, 2026-10-23)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Before Part 3 an AI plan checkout wrote nothing: Paystack chose the reference, and a member who paid
 * but never came back, with a missed webhook, was never activated. Now every checkout writes its row in
 * the ONE attempt ledger (`ai_topup_attempts`, purpose 'ai_subscription' — allowed since 0186/0195, no
 * migration) BEFORE Paystack is called, with OUR reference (`frenz_ai_plan_<uuid>`), the member, the plan
 * (item_id), the provider (Paystack — the only rail for plans), the list price, and the EXACT amount and
 * currency of the Paystack plan charge (provider_amount / provider_currency).
 *
 * Recovery verifies that reference with Paystack and activates ONLY through the existing idempotent
 * subscription write (`activateAiPlanFromVerifiedCharge` → upsertAiSubscription, de-duplicated by the
 * reference; the welcome push is claimed once). This is the FIRST charge of a subscription only: renewals,
 * cancellations and failures keep arriving as Paystack subscription events on the webhook — they carry
 * Paystack's own references, never ours, so this module never sees or touches them.
 *
 * Verified means all of: our reference, the row's member, purpose frenz_ai_plan, the row's plan, success,
 * and EXACTLY the stored amount in the stored currency. Anything else → `mismatch`, left for a person.
 */

export const AI_PLAN_REFERENCE_PREFIX = "frenz_ai_plan_";
export const newPlanReference = (): string => `${AI_PLAN_REFERENCE_PREFIX}${randomUUID()}`;
/** Ours, on either rail: frenz_ai_plan_<uuid> (Paystack) or frenz_ai_plan_fw_<uuid> (Flutterwave, 2026-10-23). */
export const isPlanReference = (r: unknown): r is string => typeof r === "string" && /^frenz_ai_plan_(fw_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(r);

const OPEN = ["pending", "verification_required"] as const;
/** The plan purposes this module settles: AI plans, and (2026-10-23, Flutterwave only) the Pro / Business site plans. */
const PLAN_PURPOSES = ["ai_subscription", "site_subscription"] as const;
export type SitePlanId = "pro" | "business";
const isSitePlanId = (v: unknown): v is SitePlanId => v === "pro" || v === "business";
const CANCEL_AFTER_MS = 30 * 60_000;
const WINDOW_MS = 7 * 86_400_000;
const RECHECK_MS = 5 * 60_000;
const REUSE_MS = 30 * 60_000;

export interface PlanAttemptRow {
  reference: string;
  user_id: string;
  provider: string;
  status: string;
  /** ai_subscription | site_subscription (absent on rows read before 2026-10-23 code: an AI plan) */
  purpose?: string;
  item_id: string | null;
  provider_amount: number | string | null;
  provider_currency: string | null;
  checkout_url: string | null;
  created_at: string;
  updated_at: string;
  /** Part 3.3: the provider's transaction id of the charge that SETTLED this attempt (its first charge) — null until then. */
  charge_id?: string | null;
  /** Part 3.3.2: { provider_plan_id } — the Flutterwave payment-plan id the SERVER chose at checkout (absent on Paystack rows). */
  metadata?: { provider_plan_id?: unknown } | null;
}
const COLUMNS = "reference, user_id, provider, status, purpose, item_id, provider_amount, provider_currency, checkout_url, created_at, updated_at, charge_id, metadata";
/** The columns a PlanAttemptRow needs (Part 5: the admin recheck reads a row the same way the sweep does). */
export const PLAN_ATTEMPT_COLUMNS = COLUMNS;

/** The Flutterwave plan id stored with the attempt at checkout — digits only; anything else (a legacy row) is null. */
export function attemptPlanId(row: Pick<PlanAttemptRow, "metadata">): string | null {
  const v = row.metadata?.provider_plan_id;
  return typeof v === "string" && /^\d{1,12}$/.test(v) ? v : null;
}

/** Write the attempt BEFORE Paystack is called. False = not written → the checkout must not open. */
export async function recordPlanAttempt(a: { reference: string; userId: string; plan: AiPlanId | SitePlanId; listCents: number; listCurrency: string; providerAmount: number; providerCurrency: string; provider?: "paystack" | "flutterwave"; purpose?: "ai_subscription" | "site_subscription"; providerPlanId?: string }): Promise<boolean> {
  const { error } = await createAdminClient()
    .from("ai_topup_attempts")
    .insert({
      reference: a.reference,
      user_id: a.userId,
      provider: a.provider ?? "paystack",
      purpose: a.purpose ?? "ai_subscription",
      item_id: a.plan,
      status: "pending",
      // amount_cents must be > 0: the list price, or (a free-listed plan) the charge itself
      amount_cents: a.listCents > 0 ? a.listCents : a.providerAmount,
      currency: a.listCents > 0 ? a.listCurrency : a.providerCurrency,
      provider_amount: a.providerAmount,
      provider_currency: a.providerCurrency.toUpperCase(),
      // Part 3.3.2: the payment plan the server opened the checkout on — activation is held to THIS, not to whatever the
      // admin configures later (0197's metadata column; nothing else writes it on a plan attempt)
      ...(a.providerPlanId ? { metadata: { provider_plan_id: a.providerPlanId } } : {}),
    });
  if (error) console.error("[ai/plans] attempt record failed — checkout not opened", { reference: a.reference });
  return !error;
}

async function setStatus(reference: string, patch: Record<string, unknown>): Promise<void> {
  await createAdminClient()
    .from("ai_topup_attempts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("reference", reference)
    .in("purpose", [...PLAN_PURPOSES])
    .in("status", [...OPEN]);
}

/** After Paystack answered at checkout: the link (pending), a refusal (failed), or an unknown outcome (held). */
export async function markPlanCheckout(reference: string, outcome: { url: string } | { refused: boolean }): Promise<void> {
  if ("url" in outcome) await setStatus(reference, { checkout_url: outcome.url });
  else if (outcome.refused) await setStatus(reference, { status: "failed", status_reason: "the provider refused the checkout" });
  else await setStatus(reference, { status: "verification_required", status_reason: "checkout outcome unknown" });
}

/**
 * A LEASE, not just a compare-and-set (Part 3.1): the claim moves updated_at LEASE_MS into the FUTURE. Nobody can
 * claim a row whose updated_at is still ahead of now — so a worker that reads the row AFTER another claimed it
 * (webhook, return page, cron) is refused until the holder finishes (every status change sets updated_at = now)
 * or the lease runs out (a crash). The sweeps only select rows last touched before now − RECHECK, never a held one.
 */
const LEASE_MS = 2 * 60_000;

async function claim(row: PlanAttemptRow): Promise<boolean> {
  if (Date.parse(row.updated_at) > Date.now()) return false;
  const { data, error } = await createAdminClient()
    .from("ai_topup_attempts")
    .update({ updated_at: new Date(Date.now() + LEASE_MS).toISOString() })
    .eq("reference", row.reference)
    .eq("updated_at", row.updated_at)
    .in("status", [...OPEN])
    .select("reference");
  return !error && (data?.length ?? 0) > 0;
}

export type PlanReconcileOutcome = "settled" | "pending" | "failed" | "mismatched" | "verification_failed" | "skipped";

/** Settle ONE open plan attempt from Paystack's record. Never throws. */
export async function reconcilePlanAttempt(row: PlanAttemptRow, config: AiPlansConfig, opts: { claimed?: boolean; flutterwaveCharge?: VerifiedCharge } = {}): Promise<PlanReconcileOutcome> {
  const site = flutterwaveReferencePurpose(row.reference) === "site_subscription";
  if (!(OPEN as readonly string[]).includes(row.status) || (!isPlanReference(row.reference) && !site)) return "skipped";
  // the provider is the ROW's, and the reference shape must agree with it — never re-chosen
  const fw = isFlutterwaveReference(row.reference);
  if ((row.provider === "flutterwave") !== fw || (row.provider !== "paystack" && row.provider !== "flutterwave")) return "skipped";
  if (!opts.claimed && !(await claim(row))) return "skipped";
  if (fw) return reconcileFlutterwavePlanAttempt(row, config, opts.flutterwaveCharge);
  try {
    if (!(await paystackEnabled())) return "skipped";
    let charge;
    try {
      charge = await verifyTransaction(row.reference);
    } catch (e) {
      if (paystackRefusedForSure(e) && row.status === "verification_required" && !row.checkout_url) {
        await setStatus(row.reference, { status: "failed", status_reason: "paystack checkout never created" });
        return "failed";
      }
      return "verification_failed";
    }
    const meta = (charge.metadata ?? {}) as { user_id?: string; purpose?: string; ai_plan?: string };
    if ((charge.reference && charge.reference !== row.reference) || meta.user_id !== row.user_id || meta.purpose !== AI_PLAN_PURPOSE || meta.ai_plan !== row.item_id) {
      await setStatus(row.reference, { status: "mismatch", status_reason: "paystack charge is not this attempt's" });
      return "mismatched";
    }
    if (charge.status === "success") {
      const exact = (charge.currency ?? "").toUpperCase() === (row.provider_currency ?? "").toUpperCase() && Number(charge.amount) === Number(row.provider_amount) && Number.isSafeInteger(Number(charge.amount));
      if (!exact) {
        await setStatus(row.reference, { status: "mismatch", status_reason: "paystack amount or currency differs", paid_amount: Number(charge.amount) || null, paid_currency: charge.currency ?? null });
        return "mismatched";
      }
      const activated = await activateAiPlanFromVerifiedCharge(row.user_id, charge, config);
      if (!activated.ok) {
        await setStatus(row.reference, { status: "mismatch", status_reason: `not activated: ${activated.reason}`.slice(0, 200) });
        return "mismatched";
      }
      await setStatus(row.reference, { status: "success", verified_at: new Date().toISOString(), charge_id: charge.id ? String(charge.id) : null, external_id: charge.id ? String(charge.id) : null, paid_amount: Number(charge.amount), paid_currency: charge.currency ?? null });
      return "settled";
    }
    const old = Date.now() - Date.parse(row.created_at) >= CANCEL_AFTER_MS;
    if (charge.status === "failed" || (charge.status === "abandoned" && old)) {
      await setStatus(row.reference, { status: charge.status, status_reason: (charge.gateway_response ?? charge.status).slice(0, 200) });
      return "failed";
    }
    return "pending";
  } catch (e) {
    console.warn("[ai/plans/reconcile] check failed", { reference: row.reference, error: e instanceof Error ? e.name : "unknown" });
    return "verification_failed";
  }
}

export interface PlanReconcileSummary {
  examined: number;
  settled: number;
  pending: number;
  failed: number;
  mismatched: number;
  verificationFailed: number;
  skipped: number;
}

/** The scheduled sweep for plan purchases (the 10-minute ai-reconcile cron): bounded, oldest first, aggregates only. */
export async function reconcilePendingPlanAttempts(config: AiPlansConfig, opts: { limit?: number; budgetMs?: number; now?: number } = {}): Promise<PlanReconcileSummary> {
  const now = opts.now ?? Date.now();
  const deadline = Date.now() + (opts.budgetMs ?? 30_000);
  const out: PlanReconcileSummary = { examined: 0, settled: 0, pending: 0, failed: 0, mismatched: 0, verificationFailed: 0, skipped: 0 };
  const { data, error } = await createAdminClient()
    .from("ai_topup_attempts")
    .select(COLUMNS)
    .in("purpose", [...PLAN_PURPOSES])
    .in("provider", ["paystack", "flutterwave"])
    .in("status", [...OPEN])
    .lte("created_at", new Date(now - 2 * 60_000).toISOString())
    .gte("created_at", new Date(now - WINDOW_MS).toISOString())
    .lte("updated_at", new Date(now - RECHECK_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(50, opts.limit ?? 10)));
  if (error) return out;
  for (const row of (data ?? []) as PlanAttemptRow[]) {
    if (Date.now() > deadline) break;
    const o = await reconcilePlanAttempt(row, config);
    out.examined += 1;
    if (o === "verification_failed") out.verificationFailed += 1;
    else out[o] += 1;
  }
  return out;
}

/**
 * Before a NEW plan checkout for this member and plan: an open attempt from the last 30 minutes with a
 * link is handed back (one intent, one checkout); one whose creation outcome was unknown is resolved first.
 * "held" = it might still be paid → no second checkout.
 */
export async function resolvePlanCheckout(userId: string, plan: AiPlanId | SitePlanId, config: AiPlansConfig): Promise<{ kind: "clear" } | { kind: "reuse"; url: string } | { kind: "activated" } | { kind: "held" }> {
  const { data, error } = await createAdminClient()
    .from("ai_topup_attempts")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("purpose", isSitePlanId(plan) ? "site_subscription" : "ai_subscription")
    .eq("item_id", plan)
    .in("status", [...OPEN])
    .gte("created_at", new Date(Date.now() - WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) return { kind: "held" };
  for (const row of (data ?? []) as PlanAttemptRow[]) {
    if (row.status === "pending" && row.checkout_url && Date.now() - Date.parse(row.created_at) < REUSE_MS) return { kind: "reuse", url: row.checkout_url };
    if (row.status === "verification_required") {
      // claimed like every other caller (Part 3.1): a webhook or the cron working it right now → held
      const o = await reconcilePlanAttempt(row, config);
      if (o === "settled") return { kind: "activated" };
      if (o !== "failed") return { kind: "held" };
    }
  }
  return { kind: "clear" };
}

/**
 * The member came back from Paystack with one of OUR plan references (verify-on-return): the same checks
 * as the sweep (exact amount, plan, member), on their own attempt only. A row already settled answers
 * "settled" with no provider call; someone else's reference is "unknown".
 */
export async function settleOwnPlanAttempt(userId: string, reference: string, config: AiPlansConfig): Promise<PlanReconcileOutcome | "unknown"> {
  if (!isPlanReference(reference)) return "unknown";
  const { data, error } = await createAdminClient().from("ai_topup_attempts").select(COLUMNS).eq("reference", reference).eq("purpose", "ai_subscription").maybeSingle();
  if (error) return "verification_failed";
  const row = data as PlanAttemptRow | null;
  if (!row || row.user_id !== userId) return "unknown";
  if (row.status === "success") return "settled";
  if (row.status === "mismatch") return "mismatched";
  if (row.status === "failed" || row.status === "abandoned") return "failed";
  // claimed (Part 3.1): if the webhook or the cron is settling it this instant, the return page shows "pending" and asks again
  return reconcilePlanAttempt(row, config);
}

/**
 * A Flutterwave plan attempt (2026-10-23): the charge is Flutterwave's own record of OUR reference (fetched here, or
 * already fetched by the webhook by transaction id). Activation needs a success at EXACTLY the stored amount and
 * currency (chargeMatches — the Part 2.1 rule). The plan is the ROW's (item_id); Flutterwave's metadata is not read.
 * Already leased by the caller.
 */
async function reconcileFlutterwavePlanAttempt(row: PlanAttemptRow, config: AiPlansConfig, given?: VerifiedCharge): Promise<PlanReconcileOutcome> {
  try {
    if (!flutterwaveConfigured(await getFlutterwaveConfig())) return "skipped";
    const charge = given ?? (await verifyFlutterwaveByReference(row.reference));
    if (charge.status === "not_found" && row.status === "verification_required" && !row.checkout_url) {
      await setStatus(row.reference, { status: "failed", status_reason: "flutterwave checkout never created" });
      return "failed";
    }
    if (charge.status === "success") {
      const match = chargeMatches(charge, { provider: "flutterwave", reference: row.reference, amountMinor: Number(row.provider_amount), currency: row.provider_currency ?? "" });
      const site = row.purpose === "site_subscription";
      const plan = site ? (isSitePlanId(row.item_id) ? row.item_id : null) : isAiPlanId(row.item_id) ? row.item_id : null;
      if (!match.ok || !plan) {
        await setStatus(row.reference, { status: "mismatch", status_reason: `flutterwave ${match.ok ? "plan" : match.mismatch}`, paid_amount: charge.amountMinor, paid_currency: charge.currency, charge_id: charge.externalId });
        return "mismatched";
      }
      const planId = attemptPlanId(row);
      const activated = site ? await activateFlutterwaveSitePlan({ userId: row.user_id, plan: plan as SitePlanId, reference: row.reference, charge, planId }) : await activateFlutterwavePlan({ userId: row.user_id, plan: plan as AiPlanId, reference: row.reference, charge, config, planId });
      if (!activated.ok) {
        // Part 3.3: paid, but the subscription Flutterwave created is not visible yet → the attempt stays open and is
        // re-checked (a review says so); a CONFLICT (another plan, customer, amount) is final — no plan, held for review
        if ("retry" in activated && activated.retry) return "pending";
        await setStatus(row.reference, { status: "mismatch", status_reason: `not activated: ${activated.reason}`.slice(0, 200), charge_id: charge.externalId });
        return "mismatched";
      }
      await setStatus(row.reference, { status: "success", verified_at: new Date().toISOString(), charge_id: charge.externalId, external_id: charge.externalId, paid_amount: charge.amountMinor, paid_currency: charge.currency });
      return "settled";
    }
    const old = Date.now() - Date.parse(row.created_at) >= CANCEL_AFTER_MS;
    if (charge.status === "failed" || ((charge.status === "abandoned" || charge.status === "not_found") && old)) {
      await setStatus(row.reference, { status: charge.status === "failed" ? "failed" : "abandoned", status_reason: (charge.reason ?? charge.status).slice(0, 200) });
      return "failed";
    }
    return "pending";
  } catch (e) {
    console.warn("[ai/plans/reconcile] flutterwave check failed", { reference: row.reference, error: e instanceof Error ? e.name : "unknown" });
    return "verification_failed";
  }
}
