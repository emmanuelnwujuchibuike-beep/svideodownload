import { NextResponse } from "next/server";

import { paystackEnabled, subscriptionManageLink } from "@/lib/paystack/paystack";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns a Paystack manage link so a member can update card / cancel. */
export async function POST() {
  if (!paystackEnabled()) {
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
    .select("subscription_ref")
    .eq("user_id", user.id)
    .maybeSingle();

  const code = data?.subscription_ref as string | undefined;
  if (!code) {
    return NextResponse.json({ error: "No active subscription found." }, { status: 404 });
  }

  try {
    const url = await subscriptionManageLink(code);
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Couldn't open billing. Try again." }, { status: 502 });
  }
}
