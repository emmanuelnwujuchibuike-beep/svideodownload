import { NextResponse } from "next/server";

import { cancelFlutterwavePlan } from "@/lib/ai/credits/flutterwave-plans";
import { getAiSubscription } from "@/lib/ai/credits/subscription";
import { paystackEnabled, subscriptionManageLink } from "@/lib/paystack/paystack";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/subscriptions/manage — manage THIS member's AI plan. The subscription is read from
 * `ai_subscriptions`, never from the body (beyond the one confirmation word below).
 *
 *   · Paystack (every subscriber from before 2026-10-23, and the backup since): Paystack's hosted page
 *     (update the card, cancel). Cancellation itself is recorded by the webhook.
 *   · Flutterwave (2026-10-23, payment plans): Flutterwave has no hosted page, so cancelling is two steps —
 *     the first call answers { confirmCancel, periodEnd }; only { action: "cancel" } cancels, at Flutterwave first.
 *     Access stays to the end of the period already paid.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const sub = await getAiSubscription(user.id);

  if (sub?.provider === "flutterwave") {
    if (!sub.active) return NextResponse.json({ error: "No active AI plan to manage." }, { status: 404 });
    if (sub.cancelAtPeriodEnd) return NextResponse.json({ cancelled: true, periodEnd: sub.currentPeriodEnd });
    const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
    if (body?.action !== "cancel") return NextResponse.json({ confirmCancel: true, periodEnd: sub.currentPeriodEnd });
    const out = await cancelFlutterwavePlan(user.id);
    return out.ok ? NextResponse.json({ cancelled: true, periodEnd: out.periodEnd }) : NextResponse.json({ error: out.error }, { status: out.status });
  }

  if (!(await paystackEnabled())) return NextResponse.json({ error: "Billing isn't available yet." }, { status: 503 });
  if (!sub?.subscriptionRef) return NextResponse.json({ error: "No AI plan to manage yet." }, { status: 404 });
  try {
    const url = await subscriptionManageLink(sub.subscriptionRef);
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Couldn't open billing. Try again." }, { status: 503 });
  }
}
