import "server-only";

import { randomUUID } from "node:crypto";

import { AI_PLAN_IDS, type AiPlanId, type AiPlansConfig } from "@/lib/ai/credits/config";
import { upsertAiSubscription } from "@/lib/ai/credits/subscription";
import { markTopupAttempt } from "@/lib/ai/topup-attempts";
import type { BachsAttempt } from "@/lib/ai/wallet/bachs-topup";
import { bachsConfigured, bachsSubscriptionStatus, createBachsSubscriptionCheckout } from "@/lib/payments/bachs";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI PRO / AI MAX THROUGH BACHS — the same ONE subscription, another rail
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-07: Bachs is the preferred rail in Nigeria for the AI plans
 * too. There is no "Bachs Pro": the plan is `ai_subscriptions` (0167), the
 * row says `provider = 'bachs'`, and the entitlement, the credits and the
 * grace rules are exactly the Paystack ones (lib/ai/credits/subscription.ts).
 *
 *   begin     the attempt row FIRST (purpose ai_subscription, the plan, its
 *             price), then a Bachs checkout of the plan's RECURRING product
 *             (`frenzAiPlans.plans.<id>.bachsProductId`).
 *   activate  on the signed `collection.succeeded` for our reference (or the
 *             verified return): the plan becomes active for one interval and
 *             the Bachs customer id is kept — it is what later subscription
 *             events are matched by.
 *   follow    customer.subscription.created / updated → the Bachs subscription
 *             id, status, period and cancel-at-period-end; .deleted → canceled;
 *             invoice.payment_failed → past_due (access continues inside the
 *             paid period, the existing rule — Bachs runs its own recovery).
 *
 * Every write goes through `upsertAiSubscription`, idempotent on the
 * reference / event id it is given.
 */
export const BACHS_PLAN_PREFIX = "frenz_bachs_plan_";

export function aiPlanForBachsProduct(productId: unknown, config: AiPlansConfig): AiPlanId | null {
  if (typeof productId !== "string" || !productId) return null;
  return AI_PLAN_IDS.find((id) => config.plans[id].bachsProductId === productId) ?? null;
}

export async function beginBachsPlanCheckout(opts: { userId: string; email: string; plan: AiPlanId; config: AiPlansConfig; successUrl: string; cancelUrl: string }): Promise<{ ok: true; url: string } | { ok: false; status: number; error: string }> {
  const p = opts.config.plans[opts.plan];
  if (!bachsConfigured() || !p.bachsProductId) return { ok: false, status: 503, error: "That plan isn't available for purchase yet." };
  const reference = `${BACHS_PLAN_PREFIX}${randomUUID()}`;
  const db = createAdminClient();
  const { error } = await db.from("ai_topup_attempts").insert({ reference, user_id: opts.userId, amount_cents: Math.max(1, p.priceCents), currency: "USD", status: "pending", provider: "bachs", purpose: "ai_subscription", item_id: opts.plan });
  if (error) {
    console.error("[ai/plans/bachs] attempt not recorded — no checkout", { userId: opts.userId, message: error.message });
    return { ok: false, status: 503, error: "Couldn't start checkout. Please try again in a moment." };
  }
  try {
    const join = (u: string) => `${u}${u.includes("?") ? "&" : "?"}reference=${encodeURIComponent(reference)}&ai_plan=${opts.plan}`;
    const checkout = await createBachsSubscriptionCheckout({ productId: p.bachsProductId, email: opts.email, reference, metadata: { user_id: opts.userId, purpose: "frenz_ai_plan", ai_plan: opts.plan }, successUrl: join(opts.successUrl), cancelUrl: join(opts.cancelUrl) });
    await db.from("ai_topup_attempts").update({ external_id: checkout.checkoutId, updated_at: new Date().toISOString() }).eq("reference", reference);
    return { ok: true, url: checkout.url };
  } catch (e) {
    console.error("[ai/plans/bachs] checkout create failed", { reference, error: String(e).slice(0, 300) });
    await markTopupAttempt(reference, { status: "failed", gatewayResponse: "checkout could not be created" }).catch(() => null);
    return { ok: false, status: 503, error: "Couldn't start checkout. Please try again in a moment." };
  }
}

function addInterval(from: Date, interval: "monthly" | "yearly"): Date {
  const d = new Date(from);
  if (interval === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** The first payment of a Bachs plan is confirmed: the plan is active for one interval (a subscription event refines the period). Idempotent on the reference. */
export async function activateBachsPlan(attempt: BachsAttempt, config: AiPlansConfig, facts: { customerId?: string | null; via: "webhook" | "return" }): Promise<{ ok: true; plan: AiPlanId } | { ok: false; reason: string }> {
  const plan = AI_PLAN_IDS.find((id) => id === attempt.item_id) ?? null;
  if (attempt.purpose !== "ai_subscription" || !plan) return { ok: false, reason: "not an AI plan payment" };
  const now = new Date();
  await upsertAiSubscription({
    userId: attempt.user_id,
    plan,
    status: "active",
    provider: "bachs",
    customerRef: facts.customerId ?? null,
    reference: attempt.reference,
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: addInterval(now, config.plans[plan].interval).toISOString(),
    cancelAtPeriodEnd: false,
  });
  await markTopupAttempt(attempt.reference, { status: "success", gatewayResponse: `bachs ${facts.via}` }).catch(() => null);
  console.info("[payments] subscription_activated", { provider: "bachs", userId: attempt.user_id, plan, reference: attempt.reference, via: facts.via });
  return { ok: true, plan };
}

/** A Bachs subscription or invoice event → the member's one AI plan row. Matched by the Bachs subscription id, else the Bachs customer id we stored at activation. */
export async function syncBachsSubscriptionEvent(eventType: string, eventId: string | null, data: Record<string, unknown>, config: AiPlansConfig): Promise<{ handled: boolean; userId: string | null; status: string | null }> {
  const db = createAdminClient();
  const isInvoice = eventType.startsWith("invoice.");
  const subscriptionId = typeof (isInvoice ? data.subscription_id ?? data.subscription : data.id) === "string" ? String(isInvoice ? data.subscription_id ?? data.subscription : data.id) : null;
  const customer = (data.customer ?? null) as { id?: unknown } | string | null;
  const customerId = typeof customer === "string" ? customer : typeof customer?.id === "string" ? customer.id : typeof data.customer_id === "string" ? data.customer_id : null;
  let row: { user_id: string } | null = null;
  if (subscriptionId) row = ((await db.from("ai_subscriptions").select("user_id").eq("provider", "bachs").eq("subscription_ref", subscriptionId).maybeSingle()).data as { user_id: string } | null) ?? null;
  if (!row && customerId) row = ((await db.from("ai_subscriptions").select("user_id").eq("provider", "bachs").eq("customer_ref", customerId).maybeSingle()).data as { user_id: string } | null) ?? null;
  if (!row) {
    console.warn("[ai/plans/bachs] subscription event for no known member", { eventType, subscriptionId, customerId });
    return { handled: false, userId: null, status: null };
  }
  let status: "active" | "trialing" | "past_due" | "canceled" | "expired" | null;
  if (eventType === "customer.subscription.deleted") status = "canceled";
  else if (eventType === "invoice.payment_failed") status = "past_due";
  else if (isInvoice) status = /paid|succeeded/.test(eventType) ? "active" : null;
  else status = bachsSubscriptionStatus(data.status);
  if (!status) return { handled: false, userId: row.user_id, status: null };
  const iso = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);
  await upsertAiSubscription({
    userId: row.user_id,
    plan: aiPlanForBachsProduct(data.product_id ?? (data.product as { id?: unknown } | undefined)?.id, config),
    status,
    provider: "bachs",
    subscriptionRef: !isInvoice ? subscriptionId : null,
    customerRef: customerId,
    reference: eventId ? `bachs_evt:${eventId}` : null,
    currentPeriodStart: iso(data.current_period_start ?? data.period_start),
    currentPeriodEnd: iso(data.current_period_end ?? data.period_end),
    cancelAtPeriodEnd: typeof data.cancel_at_period_end === "boolean" ? data.cancel_at_period_end : undefined,
  });
  console.info("[payments] subscription_synced", { provider: "bachs", eventType, userId: row.user_id, status });
  return { handled: true, userId: row.user_id, status };
}
