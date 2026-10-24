import { NextResponse } from "next/server";
import { z } from "zod";

import { cancelFlutterwaveSitePlan } from "@/lib/ai/credits/flutterwave-plans";
import { paystackEnabled, subscriptionManageLink } from "@/lib/paystack/paystack";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ action: z.enum(["cancel"]).optional() }).strict();

/**
 * Billing for a Pro / Business member.
 *   · Paystack plan → Paystack's manage link (update card / cancel), as before.
 *   · Flutterwave plan (2026-10-23) → Flutterwave has no hosted manage page, so this is a two-step cancel: the
 *     first call answers what will happen (`flutterwave: true`, the paid-through date); `{ action: "cancel" }` stops
 *     future charges at Flutterwave and keeps access to the end of the paid period.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("subscriptions")
    .select("provider, subscription_ref, current_period_end, cancel_at_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  if (data?.provider === "flutterwave") {
    if (parsed.data.action !== "cancel") {
      return NextResponse.json({ flutterwave: true, periodEnd: data.current_period_end ?? null, cancelled: !!data.cancel_at_period_end });
    }
    if (data.cancel_at_period_end) return NextResponse.json({ ok: true, periodEnd: data.current_period_end ?? null });
    const out = await cancelFlutterwaveSitePlan(user.id);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ ok: true, periodEnd: out.periodEnd });
  }

  if (!(await paystackEnabled())) {
    return NextResponse.json({ error: "Billing isn't available yet." }, { status: 503 });
  }
  const code = data?.subscription_ref as string | undefined;
  if (!code) {
    return NextResponse.json({ error: "No active subscription found." }, { status: 404 });
  }

  try {
    const url = await subscriptionManageLink(code);
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Couldn't open billing. Try again." }, { status: 503 });
  }
}
