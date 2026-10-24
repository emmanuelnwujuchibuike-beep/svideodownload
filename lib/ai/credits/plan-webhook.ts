import "server-only";

import type { AiPlanId, AiPlansConfig } from "@/lib/ai/credits/config";
import { activateAiPlanFromVerifiedCharge, AI_PLAN_PURPOSE, aiPlanForPlanCode, isAiPlanId, resolveUserId, syncAiPlanEvent } from "@/lib/ai/credits/paystack";
import { queueBillingReview } from "@/lib/ai/credits/flutterwave-plans";
import { isPlanReference, reconcilePlanAttempt, type PlanAttemptRow } from "@/lib/ai/credits/plan-attempts";
import { readPaystackPlan, verifiedPlanCode, verifyTransaction, type PaystackEventData } from "@/lib/paystack/paystack";
import type { VerifiedCharge } from "@/lib/payments/charge";
import { isFlutterwaveReference } from "@/lib/payments/references";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AN AI PLAN EVENT FROM PAYSTACK — WHAT IT MAY GRANT (Part 3.1, 2026-10-23)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Before: every AI plan event went to `syncAiPlanEvent`, which set the plan ACTIVE on charge.success,
 * subscription.create and invoice.update from the signed payload alone — no API re-check, no amount
 * check, the member found by metadata, subscription/customer code or, last, by email. A valid signature
 * proves the sender, not that the right product was paid for.
 *
 * Now (`handleAiPlanWebhook`), in this order:
 *   1. charge.success for OUR first-charge reference (frenz_ai_plan_…) → the attempt row, through the SAME
 *      routine as the cron and the return page (reconcilePlanAttempt): Paystack re-verified by API; member,
 *      purpose, plan, success and the EXACT stored amount/currency; claimed (compare-and-set) so a webhook,
 *      a return and a cron racing activate once.
 *   2. events that can only TAKE AWAY access (subscription.disable, subscription.not_renew,
 *      invoice.payment_failed) → the established path, unchanged.
 *   3. a GRANTING event (charge.success, subscription.create, invoice.update) for a Paystack subscription the
 *      member ALREADY holds for that plan (activated before; same subscription when both codes are known)
 *      → a renewal / lifecycle event → the established path, unchanged.
 *   4. charge.success with Paystack's own reference and no established subscription — a first purchase from
 *      a checkout started before attempts existed → re-verified with Paystack's API: success, purpose
 *      frenz_ai_plan, a member, the verified plan code mapping to the metadata's plan, and amount + currency
 *      EXACTLY the Paystack plan's own price (read from Paystack). Otherwise no plan, an audit-log entry.
 *   5. subscription.create / invoice.update with nothing verified behind it → no grant: retried while a
 *      purchase of that plan is in flight (its charge may not be verified yet), else logged for review.
 *
 * Retry-safety: `{ ack: false }` → the route answers 500 and Paystack redelivers; only final outcomes are
 * acknowledged. A failed verification never activates and never marks the attempt paid.
 */

export type PlanWebhookResult = { ack: true; outcome: string } | { ack: false; outcome: string };

const GRANTING = new Set(["charge.success", "subscription.create", "invoice.update"]);
const OPEN = ["pending", "verification_required"];

interface SubRow {
  user_id: string;
  plan: AiPlanId;
  status: string;
  provider: string | null;
  subscription_ref: string | null;
  customer_ref: string | null;
  activated_at: string | null;
}

function eventPlan(data: PaystackEventData, config: AiPlansConfig): AiPlanId | null {
  const fromCode = aiPlanForPlanCode(data.plan?.plan_code, config);
  if (fromCode) return fromCode;
  const meta = (data.metadata ?? {}) as { ai_plan?: string };
  return isAiPlanId(meta.ai_plan) ? meta.ai_plan : null;
}

async function audit(action: string, reference: string | null, details: Record<string, unknown>): Promise<void> {
  const { error } = await createAdminClient().from("financial_audit_log").insert({ action, target_type: "ai_plan_payment", target_id: null, reference, details });
  if (error) console.error("[ai/plans/webhook] audit write failed", { action });
}

/** Does the member already hold this Paystack subscription (a renewal / lifecycle event)? */
async function establishedSubscription(data: PaystackEventData, config: AiPlansConfig): Promise<boolean> {
  const userId = await resolveUserId(data);
  if (!userId) return false;
  const { data: row } = await createAdminClient().from("ai_subscriptions").select("user_id, plan, status, provider, subscription_ref, customer_ref, activated_at").eq("user_id", userId).maybeSingle();
  const r = row as SubRow | null;
  if (!r || (r.provider ?? "paystack") !== "paystack" || !r.activated_at) return false;
  if (!["active", "past_due", "trialing"].includes(r.status)) return false;
  const plan = eventPlan(data, config);
  if (plan && plan !== r.plan) return false;
  // when both sides know the subscription, it must be the same one
  if (data.subscription_code && r.subscription_ref && data.subscription_code !== r.subscription_ref) return false;
  return true;
}

/**
 * 1 — our reference: the attempt row decides (the cron / return routine), claimed so it runs once. Shared by both
 * webhooks; `flutterwaveCharge` is the charge the Flutterwave webhook already verified by transaction id.
 */
export async function settleAttemptFromWebhook(reference: string, config: AiPlansConfig, flutterwaveCharge?: VerifiedCharge): Promise<PlanWebhookResult> {
  const db = createAdminClient();
  const load = async () => (await db.from("ai_topup_attempts").select("reference, user_id, provider, status, purpose, item_id, provider_amount, provider_currency, checkout_url, created_at, updated_at").eq("reference", reference).in("purpose", ["ai_subscription", "site_subscription"]).maybeSingle()).data as PlanAttemptRow | null;
  const row = await load();
  if (!row) {
    await audit("ai_plan_payment_review", reference, { reason: "our reference with no attempt row", review: "no plan granted" });
    return { ack: true, outcome: "unknown_attempt" };
  }
  if (row.status === "success") return { ack: true, outcome: "already_settled" };
  if (["mismatch", "failed", "abandoned"].includes(row.status)) return { ack: true, outcome: `final:${row.status}` };
  const o = await reconcilePlanAttempt(row, config, { flutterwaveCharge });
  if (o === "settled" || o === "mismatched" || o === "failed") return { ack: true, outcome: o };
  if (o === "skipped") {
    // another worker holds it right now: acknowledge only once it is final, else ask for a redelivery
    const after = await load();
    if (after && after.status !== "pending" && after.status !== "verification_required") return { ack: true, outcome: `final:${after.status}` };
  }
  return { ack: false, outcome: o };
}

/**
 * Part 3.3 (H5) — a Flutterwave transaction carrying one of OUR plan references. Flutterwave does not document what
 * tx_ref a payment-plan renewal carries, so the reference alone never decides: the attempt's FIRST charge is the one
 * whose transaction id settled it (charge_id). Any OTHER successful transaction on that reference is a later charge →
 * `subsequent` (the caller sends it down the renewal path, which proves or reviews it — never "already settled", never
 * a second activation). A settled attempt with no recorded charge id cannot be told apart → a review.
 */
export async function settleFlutterwavePlanTransaction(reference: string, config: AiPlansConfig, charge: VerifiedCharge): Promise<PlanWebhookResult & { subsequent?: true }> {
  const { data, error } = await createAdminClient().from("ai_topup_attempts").select("status, charge_id").eq("reference", reference).in("purpose", ["ai_subscription", "site_subscription"]).maybeSingle();
  if (error) return { ack: false, outcome: "attempt_unavailable" };
  const row = data as { status: string; charge_id: string | null } | null;
  if (row && row.status !== "pending" && row.status !== "verification_required") {
    const same = !!charge.externalId && row.charge_id === charge.externalId;
    if (same) return { ack: true, outcome: row.status === "success" ? "already_settled" : `final:${row.status}` };
    if (charge.status !== "success") return { ack: true, outcome: `later_charge:${charge.status}` };
    if (row.charge_id) return { ack: true, outcome: "subsequent", subsequent: true };
    if (charge.externalId) {
      await queueBillingReview({ dedupeKey: `renewal:flutterwave:${charge.externalId}`, kind: "renewal", reason: "a charge on a settled plan reference whose first charge id was never recorded — cannot tell first charge from renewal", transactionId: charge.externalId, amountMinor: charge.amountMinor, currency: charge.currency });
    }
    return { ack: true, outcome: "review:unclassifiable" };
  }
  return settleAttemptFromWebhook(reference, config, charge);
}

/** 4 — a first charge with Paystack's own reference (a checkout from before attempts existed): verified exactly against Paystack's own records. */
async function settleLegacyFirstCharge(data: PaystackEventData, config: AiPlansConfig): Promise<PlanWebhookResult> {
  const reference = data.reference ?? "";
  if (!/^[A-Za-z0-9_.=:-]{6,120}$/.test(reference)) {
    await audit("ai_plan_payment_review", null, { reason: "charge without a usable reference", review: "no plan granted" });
    return { ack: true, outcome: "no_reference" };
  }
  let charge;
  try {
    charge = await verifyTransaction(reference);
  } catch {
    return { ack: false, outcome: "verification_failed" };
  }
  const meta = (charge.metadata ?? {}) as { user_id?: string; purpose?: string; ai_plan?: string };
  const code = verifiedPlanCode(charge);
  const plan = aiPlanForPlanCode(code, config);
  const review = async (reason: string, extra: Record<string, unknown> = {}): Promise<PlanWebhookResult> => {
    await audit("ai_plan_payment_review", reference, { reason, plan: plan ?? meta.ai_plan ?? null, status: charge.status ?? null, paid: charge.amount ?? null, currency: charge.currency ?? null, ...extra, review: "no plan granted" });
    return { ack: true, outcome: `review:${reason}` };
  };
  if (charge.reference && charge.reference !== reference) return review("reference");
  if (charge.status !== "success") return charge.status === "failed" || charge.status === "abandoned" ? { ack: true, outcome: `not_paid:${charge.status}` } : { ack: false, outcome: "pending" };
  if (meta.purpose !== AI_PLAN_PURPOSE || !meta.user_id) return review("purpose_or_member");
  if (!plan || !code || plan !== meta.ai_plan || !config.plans[plan]?.enabled) return review("plan");
  let facts;
  try {
    facts = await readPaystackPlan(code);
  } catch {
    return { ack: false, outcome: "plan_read_failed" };
  }
  const exact = Number.isSafeInteger(Number(charge.amount)) && Number(charge.amount) === facts.amount && (charge.currency ?? "").toUpperCase() === facts.currency.toUpperCase();
  if (!exact) return review("amount_or_currency", { expected: facts.amount, expected_currency: facts.currency });
  const activated = await activateAiPlanFromVerifiedCharge(meta.user_id, charge, config);
  if (!activated.ok) return review(`not_activated:${activated.reason}`);
  return { ack: true, outcome: "settled_legacy" };
}

/** 5 — subscription.create / invoice.update with no verified grant behind it yet. */
async function noVerifiedGrant(eventType: string, data: PaystackEventData, config: AiPlansConfig): Promise<PlanWebhookResult> {
  const userId = await resolveUserId(data);
  const plan = eventPlan(data, config);
  if (userId && plan) {
    const { data: open } = await createAdminClient()
      .from("ai_topup_attempts")
      .select("reference")
      .eq("user_id", userId)
      .eq("purpose", "ai_subscription")
      .eq("item_id", plan)
      .in("status", OPEN)
      .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
      .limit(1);
    // its first charge may simply not be verified yet: Paystack redelivers this event, by then the plan is established
    if ((open ?? []).length) return { ack: false, outcome: "purchase_in_flight" };
  }
  await audit("ai_plan_payment_review", data.subscription_code ?? null, { reason: `${eventType} with no verified purchase`, plan, member_found: !!userId, review: "no plan granted" });
  return { ack: true, outcome: "review:no_verified_purchase" };
}

export async function handleAiPlanWebhook(eventType: string, data: PaystackEventData, config: AiPlansConfig): Promise<PlanWebhookResult> {
  // Paystack's webhook settles only Paystack-shaped plan references (a Flutterwave one never comes this way)
  if (eventType === "charge.success" && isPlanReference(data.reference) && !isFlutterwaveReference(data.reference)) return settleAttemptFromWebhook(data.reference, config);
  if (!GRANTING.has(eventType)) {
    await syncAiPlanEvent(eventType, data, config);
    return { ack: true, outcome: "lifecycle" };
  }
  if (await establishedSubscription(data, config)) {
    await syncAiPlanEvent(eventType, data, config);
    return { ack: true, outcome: "renewal" };
  }
  if (eventType === "charge.success") return settleLegacyFirstCharge(data, config);
  return noVerifiedGrant(eventType, data, config);
}

