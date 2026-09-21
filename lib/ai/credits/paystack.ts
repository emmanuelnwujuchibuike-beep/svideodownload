import "server-only";

import { AI_PLAN_IDS, type AiPlanId, type AiPlansConfig } from "@/lib/ai/credits/config";
import { upsertAiSubscription, type AiSubscriptionStatus } from "@/lib/ai/credits/subscription";
import { trackEvent } from "@/lib/analytics/events";
import type { PaystackEventData, PaystackVerifiedCharge } from "@/lib/paystack/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI PRO / AI MAX THROUGH PAYSTACK — the same webhook, a purpose of its own
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21: "Use the existing FrenzSave/Paystack payment
 * infrastructure … Never activate an AI subscription based solely on a
 * client-side 'payment successful' response … Do not trust the frontend for
 * price, plan, credit amount, subscription status."
 *
 * An AI plan is a Paystack SUBSCRIPTION to one of two plan codes the
 * operator sets on the AI Plans & Credits tab — the same mechanism the site
 * plans use (`initializeTransaction` with a plan code). Its events arrive at
 * the one verified webhook with `metadata.purpose = "frenz_ai_plan"` (set at
 * checkout, echoed back by Paystack), or carrying one of the AI plan codes,
 * or naming a subscription code already on `ai_subscriptions`. They are
 * routed HERE, before the site-plan sync, so an AI Max charge can never
 * touch the member's Pro/Business row (§ "NORMAL PRO/BUSINESS VS AI PRO/MAX").
 *
 * Every write is the idempotent upsert in subscription.ts: a redelivered
 * event, or the verify-on-return route and the webhook landing together,
 * change nothing twice.
 */

export const AI_PLAN_PURPOSE = "frenz_ai_plan";

export function aiPlanForPlanCode(code: string | null | undefined, config: AiPlansConfig): AiPlanId | null {
  if (!code) return null;
  for (const id of AI_PLAN_IDS) if (config.plans[id].paystackPlanCode && config.plans[id].paystackPlanCode === code) return id;
  return null;
}

export function isAiPlanId(v: unknown): v is AiPlanId {
  return v === "ai_pro" || v === "ai_max";
}

type AiPlanMetadata = { user_id?: string; purpose?: string; ai_plan?: string };

/** Whether a webhook payload is about an AI plan — by purpose, by plan code, or by a subscription code we already hold. */
export async function isAiPlanEvent(data: PaystackEventData, config: AiPlansConfig): Promise<boolean> {
  const meta = (data.metadata ?? {}) as AiPlanMetadata;
  if (meta.purpose === AI_PLAN_PURPOSE) return true;
  if (aiPlanForPlanCode(data.plan?.plan_code, config)) return true;
  if (data.subscription_code) {
    try {
      const { data: row } = await createAdminClient().from("ai_subscriptions").select("user_id").eq("subscription_ref", data.subscription_code).maybeSingle();
      if (row) return true;
    } catch {
      /* before 0167 there is no table */
    }
  }
  return false;
}

async function resolveUserId(data: PaystackEventData): Promise<string | null> {
  const supabase = createAdminClient();
  const meta = (data.metadata ?? {}) as AiPlanMetadata;
  if (meta.user_id) return meta.user_id;
  if (data.subscription_code) {
    const { data: row } = await supabase.from("ai_subscriptions").select("user_id").eq("subscription_ref", data.subscription_code).maybeSingle();
    if (row?.user_id) return row.user_id as string;
  }
  if (data.customer?.customer_code) {
    const { data: row } = await supabase.from("ai_subscriptions").select("user_id").eq("customer_ref", data.customer.customer_code).maybeSingle();
    if (row?.user_id) return row.user_id as string;
  }
  const email = data.customer?.email ?? null;
  if (email) {
    const { data: prof } = await supabase.from("profiles").select("id").ilike("email", email).maybeSingle();
    if (prof?.id) return prof.id as string;
  }
  return null;
}

/**
 * The webhook's write for an AI plan event. The plan comes from the plan
 * code (the operator's configuration) or, failing that, from the metadata we
 * set at checkout — never from the customer. Status follows the same
 * lifecycle words the site sync uses.
 */
export async function syncAiPlanEvent(eventType: string, data: PaystackEventData, config: AiPlansConfig): Promise<{ handled: boolean; userId: string | null; plan: AiPlanId | null; status: AiSubscriptionStatus | null }> {
  const userId = await resolveUserId(data);
  if (!userId) return { handled: false, userId: null, plan: null, status: null };
  const meta = (data.metadata ?? {}) as AiPlanMetadata;
  const planFromCode = aiPlanForPlanCode(data.plan?.plan_code, config);
  const plan: AiPlanId | null = planFromCode ?? (isAiPlanId(meta.ai_plan) ? meta.ai_plan : null);

  let status: AiSubscriptionStatus = "active";
  let cancelAtEnd: boolean | undefined;
  switch (eventType) {
    case "subscription.disable":
      status = "canceled";
      break;
    case "subscription.not_renew":
      status = "active";
      cancelAtEnd = true;
      break;
    case "invoice.payment_failed":
      status = "past_due";
      break;
    case "charge.success":
      // a charge that is not a success is not an activation
      if (data.status && data.status !== "success") return { handled: true, userId, plan, status: null };
      status = "active";
      break;
    default: // subscription.create | invoice.update
      status = "active";
  }

  const written = await upsertAiSubscription({
    userId,
    plan,
    status,
    planCode: data.plan?.plan_code ?? null,
    customerRef: data.customer?.customer_code ?? null,
    subscriptionRef: data.subscription_code ?? null,
    emailToken: data.email_token ?? null,
    reference: data.reference ?? null,
    currentPeriodEnd: data.next_payment_date ? new Date(data.next_payment_date).toISOString() : null,
    currentPeriodStart: eventType === "charge.success" || eventType === "subscription.create" ? new Date().toISOString() : null,
    cancelAtPeriodEnd: cancelAtEnd,
  });
  console.info("[ai/plans] paystack event", { eventType, userId, plan: written.plan, status, written: written.written, reference: data.reference ?? null });
  if (written.written) {
    trackEvent(status === "canceled" ? "subscribe_cancel" : "subscribe", { userId, metadata: { plan: written.plan, status, provider: "paystack", kind: "ai_plan" } });
  }
  return { handled: true, userId, plan: written.plan, status };
}

/**
 * The verify-on-return route's write: the member came back from Paystack
 * with a reference; the charge is READ FROM PAYSTACK (never the return URL),
 * and activates only when it is a success, for this member, for this
 * purpose. Idempotent with the webhook by the reference.
 */
export async function activateAiPlanFromVerifiedCharge(userId: string, charge: PaystackVerifiedCharge, config: AiPlansConfig): Promise<{ ok: true; plan: AiPlanId } | { ok: false; reason: string }> {
  const meta = (charge.metadata ?? {}) as AiPlanMetadata;
  if (charge.status !== "success") return { ok: false, reason: `charge is ${charge.status ?? "unknown"}` };
  if (meta.purpose !== AI_PLAN_PURPOSE) return { ok: false, reason: "not an AI plan charge" };
  if (meta.user_id !== userId) return { ok: false, reason: "charge belongs to another account" };
  const plan = isAiPlanId(meta.ai_plan) ? meta.ai_plan : null;
  if (!plan || !config.plans[plan].enabled) return { ok: false, reason: "plan unknown or disabled" };
  await upsertAiSubscription({ userId, plan, status: "active", planCode: config.plans[plan].paystackPlanCode || null, reference: charge.reference ?? null, currentPeriodStart: charge.paid_at ?? new Date().toISOString() });
  return { ok: true, plan };
}
