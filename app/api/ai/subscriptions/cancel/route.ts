import { NextResponse } from "next/server";

import { getAiSubscription, upsertAiSubscription } from "@/lib/ai/credits/subscription";
import { bachsConfigured, cancelBachsSubscription } from "@/lib/payments/bachs";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/subscriptions/cancel — stop a BACHS-billed AI plan at the end
 * of the period already paid for (2026-10-07). Paystack plans keep Paystack's
 * own hosted manage page (/manage); Bachs has no such page, so the member asks
 * us and we ask Bachs (DELETE /v1/subscriptions/{id}, cancel_at_period_end).
 * The member's OWN subscription, from the session — never an id from the body.
 * The plan keeps granting credits until the period ends (the existing rule).
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const burst = await aiJobCreateLimiter.limit(`ai-plan-cancel:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many attempts. Try again in a minute." }, { status: 429 });
  const sub = await getAiSubscription(user.id);
  if (!sub || sub.provider !== "bachs" || !sub.subscriptionRef) return NextResponse.json({ error: "No AI plan to cancel here." }, { status: 404 });
  if (sub.cancelAtPeriodEnd) return NextResponse.json({ ok: true, alreadyCanceled: true, endsAt: sub.currentPeriodEnd });
  if (!bachsConfigured()) return NextResponse.json({ error: "Billing isn't available right now. Try again later." }, { status: 503 });
  try {
    await cancelBachsSubscription(sub.subscriptionRef, { atPeriodEnd: true, reason: "Member cancelled from Frenz AI" });
    // the webhook (customer.subscription.updated) confirms it too; recording it now means the card says so at once
    await upsertAiSubscription({ userId: user.id, plan: null, status: sub.status, provider: "bachs", cancelAtPeriodEnd: true });
    console.info("[payments] subscription_cancel_requested", { provider: "bachs", userId: user.id });
    return NextResponse.json({ ok: true, endsAt: sub.currentPeriodEnd });
  } catch (e) {
    console.error("[payments] subscription cancel failed", { provider: "bachs", userId: user.id, error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't cancel right now. Try again in a moment — your plan is unchanged." }, { status: 503 });
  }
}
