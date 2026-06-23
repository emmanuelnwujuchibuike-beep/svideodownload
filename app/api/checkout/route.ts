import { NextResponse } from "next/server";
import { z } from "zod";

import { initializeTransaction, paystackEnabled, planCodeForPlan } from "@/lib/paystack/paystack";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ plan: z.enum(["pro", "business"]) });

/** Starts a Paystack subscription checkout for the signed-in user. */
export async function POST(request: Request) {
  if (!paystackEnabled()) {
    return NextResponse.json({ error: "Billing isn't available yet." }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first.", login: true }, { status: 401 });
  }
  if (!user.email) {
    return NextResponse.json({ error: "Your account needs an email to subscribe." }, { status: 400 });
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

  const planCode = planCodeForPlan(parsed.data.plan);
  if (!planCode) {
    return NextResponse.json({ error: "That plan isn't available yet." }, { status: 503 });
  }

  try {
    const base = SITE_URL || new URL(request.url).origin;
    const url = await initializeTransaction({
      email: user.email,
      planCode,
      userId: user.id,
      callbackUrl: `${base}/account?upgraded=1`,
    });
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Couldn't start checkout. Please try again." }, { status: 502 });
  }
}
