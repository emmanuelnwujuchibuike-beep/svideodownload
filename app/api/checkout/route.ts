import { NextResponse } from "next/server";
import { z } from "zod";

import { createCheckoutSession, ensureCustomer, priceForPlan, stripeEnabled } from "@/lib/stripe/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ plan: z.enum(["pro", "business"]) });

/** Creates a Stripe Checkout session for the signed-in user and returns its URL. */
export async function POST(request: Request) {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: "Billing isn't available yet." }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first.", login: true }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a valid plan." }, { status: 400 });
  }

  const priceId = priceForPlan(parsed.data.plan);
  if (!priceId) {
    return NextResponse.json({ error: "That plan isn't available yet." }, { status: 503 });
  }

  try {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const customer = await ensureCustomer(
      (existing?.stripe_customer_id as string) ?? null,
      user.email ?? undefined,
      user.id,
    );

    // Persist the customer id up-front so the webhook can resolve the user.
    await admin
      .from("subscriptions")
      .upsert(
        { user_id: user.id, stripe_customer_id: customer, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );

    const base = SITE_URL || new URL(request.url).origin;
    const url = await createCheckoutSession({
      customer,
      priceId,
      userId: user.id,
      successUrl: `${base}/account?upgraded=1`,
      cancelUrl: `${base}/pricing`,
    });
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Couldn't start checkout. Please try again." }, { status: 502 });
  }
}
