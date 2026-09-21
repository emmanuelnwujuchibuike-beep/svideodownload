import { NextResponse } from "next/server";

import { getAiSubscription } from "@/lib/ai/credits/subscription";
import { paystackEnabled, subscriptionManageLink } from "@/lib/paystack/paystack";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/subscriptions/manage — Paystack's hosted page for THIS
 * member's AI plan (update the card, cancel). The same mechanism as the
 * site plan's billing portal; the subscription code comes from
 * `ai_subscriptions`, never from the body. Cancellation itself is recorded
 * by the webhook (`subscription.not_renew` / `subscription.disable`).
 */
export async function POST() {
  if (!(await paystackEnabled())) return NextResponse.json({ error: "Billing isn't available yet." }, { status: 503 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const sub = await getAiSubscription(user.id);
  if (!sub?.subscriptionRef) return NextResponse.json({ error: "No AI plan to manage yet." }, { status: 404 });
  try {
    const url = await subscriptionManageLink(sub.subscriptionRef);
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Couldn't open billing. Try again." }, { status: 502 });
  }
}
