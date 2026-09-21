import "server-only";

import { aiPlanRank, type AiPlanId } from "@/lib/ai/credits/config";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE MEMBER'S AI PLAN — one row, read by the server, written by billing
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `ai_subscriptions` (0167): AI Pro / AI Max, apart from the site plan in
 * `subscriptions`. Only three writers exist — the Paystack webhook, the
 * verify-on-return route (both after a verified payment) and an
 * administrator — and every write is an upsert keyed by the member, so a
 * redelivered event lands on the same row. Nothing here is decided from a
 * browser: the plan a member is on is what this table says right now.
 *
 * "Active" means the status says so AND the period, when one is recorded,
 * has not passed: a subscription whose renewal never arrived stops granting
 * credits at its period end, without waiting for a webhook to say so.
 */

export type AiSubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "expired";

export interface AiSubscriptionRow {
  user_id: string;
  plan: AiPlanId;
  status: AiSubscriptionStatus;
  provider: string;
  plan_code: string | null;
  customer_ref: string | null;
  subscription_ref: string | null;
  email_token: string | null;
  last_reference: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  activated_at: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiSubscription {
  plan: AiPlanId;
  status: AiSubscriptionStatus;
  /** Grants credits right now. */
  active: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  subscriptionRef: string | null;
  emailToken: string | null;
}

/** A period end more than this far in the past means the renewal is not coming (Paystack retries for a few days). */
const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export function subscriptionIsActive(row: Pick<AiSubscriptionRow, "status" | "current_period_end">, now: number = Date.now()): boolean {
  if (row.status !== "active" && row.status !== "trialing" && row.status !== "past_due") return false;
  if (!row.current_period_end) return row.status !== "past_due";
  const end = Date.parse(row.current_period_end);
  if (!Number.isFinite(end)) return row.status !== "past_due";
  // active/trialing: honoured until the period end plus a grace for the renewal charge; past_due: only inside the paid period
  return row.status === "past_due" ? now <= end : now <= end + GRACE_MS;
}

export function toAiSubscription(row: AiSubscriptionRow | null, now: number = Date.now()): AiSubscription | null {
  if (!row) return null;
  return { plan: row.plan, status: row.status, active: subscriptionIsActive(row, now), currentPeriodEnd: row.current_period_end, cancelAtPeriodEnd: row.cancel_at_period_end, subscriptionRef: row.subscription_ref, emailToken: row.email_token };
}

export async function getAiSubscription(userId: string): Promise<AiSubscription | null> {
  try {
    const { data, error } = await createAdminClient().from("ai_subscriptions").select("*").eq("user_id", userId).maybeSingle();
    if (error) {
      // 0167 not applied yet (PGRST205 = no such table): nobody has a plan, the wallet path is unchanged.
      if (error.code === "PGRST205" || /ai_subscriptions/.test(error.message)) return null;
      console.error("[ai/credits] subscription read failed", { userId, code: error.code, message: error.message });
      return null;
    }
    return toAiSubscription((data as AiSubscriptionRow | null) ?? null);
  } catch (e) {
    console.error("[ai/credits] subscription read threw", { userId, error: String(e).slice(0, 200) });
    return null;
  }
}

/** The plan currently granting credits, or null. */
export async function getActiveAiPlan(userId: string): Promise<AiPlanId | null> {
  const sub = await getAiSubscription(userId);
  return sub && sub.active ? sub.plan : null;
}

/**
 * Billing's write. Idempotent by construction: keyed by the member, and a
 * `last_reference` equal to the one already recorded changes nothing (the
 * verify-on-return route and the webhook both see the same charge). A plan
 * change UP (AI Pro → AI Max) takes effect at once; the rank never goes down
 * on an `active` event without a plan code (a renewal charge that omits it).
 */
export async function upsertAiSubscription(input: {
  userId: string;
  plan: AiPlanId | null;
  status: AiSubscriptionStatus;
  planCode?: string | null;
  customerRef?: string | null;
  subscriptionRef?: string | null;
  emailToken?: string | null;
  reference?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
}): Promise<{ written: boolean; plan: AiPlanId | null }> {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("ai_subscriptions").select("*").eq("user_id", input.userId).maybeSingle();
  const current = (existing as AiSubscriptionRow | null) ?? null;
  if (input.reference && current?.last_reference && current.last_reference === input.reference && current.status === input.status) {
    return { written: false, plan: current.plan };
  }
  // an event that names no plan keeps the current one (a renewal), unless it is an ending
  const plan: AiPlanId | null = input.plan ?? (input.status === "canceled" || input.status === "expired" ? (current?.plan ?? null) : current?.plan ?? null);
  if (!plan) return { written: false, plan: null };
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    user_id: input.userId,
    plan: input.status === "active" && current && aiPlanRank(current.plan) > aiPlanRank(plan) && !input.planCode ? current.plan : plan,
    status: input.status,
    provider: "paystack",
    cancel_at_period_end: input.cancelAtPeriodEnd ?? (input.status === "active" ? false : (current?.cancel_at_period_end ?? false)),
    updated_at: now,
  };
  if (input.planCode) patch.plan_code = input.planCode;
  if (input.customerRef) patch.customer_ref = input.customerRef;
  if (input.subscriptionRef) patch.subscription_ref = input.subscriptionRef;
  if (input.emailToken) patch.email_token = input.emailToken;
  if (input.reference) patch.last_reference = input.reference;
  if (input.currentPeriodStart) patch.current_period_start = input.currentPeriodStart;
  if (input.currentPeriodEnd) patch.current_period_end = input.currentPeriodEnd;
  if (input.status === "active" && !current?.activated_at) patch.activated_at = now;
  if (input.status === "canceled") patch.canceled_at = now;
  const { error } = await admin.from("ai_subscriptions").upsert(patch, { onConflict: "user_id" });
  if (error) {
    console.error("[ai/credits] subscription write failed", { userId: input.userId, code: error.code, message: error.message });
    throw new Error(error.message);
  }
  return { written: true, plan: patch.plan as AiPlanId };
}

/** Every member with an AI plan row — for the admin monitor and the analytics. */
export async function listAiSubscriptions(limit = 200): Promise<AiSubscriptionRow[]> {
  const { data, error } = await createAdminClient().from("ai_subscriptions").select("*").order("updated_at", { ascending: false }).limit(Math.max(1, Math.min(1000, limit)));
  if (error) return [];
  return (data ?? []) as AiSubscriptionRow[];
}
