import { NextResponse } from "next/server";

import { createPortalSession, stripeEnabled } from "@/lib/stripe/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Opens the Stripe billing portal so a member can manage/cancel their plan. */
export async function POST(request: Request) {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: "Billing isn't available yet." }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const customer = data?.stripe_customer_id as string | undefined;
  if (!customer) {
    return NextResponse.json({ error: "No billing account found." }, { status: 404 });
  }

  try {
    const base = SITE_URL || new URL(request.url).origin;
    const url = await createPortalSession(customer, `${base}/account`);
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Couldn't open billing. Try again." }, { status: 502 });
  }
}
