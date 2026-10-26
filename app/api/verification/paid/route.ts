import { NextResponse } from "next/server";

import { paymentCountry, paymentMarket } from "@/lib/payments/router";
import { trackLimiter } from "@/lib/rate-limit";
import { startVerificationCheckout } from "@/lib/social/paid-verification";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/verification/paid — open (or reuse) a checkout for the blue tick (Flutterwave first when enabled, else Paystack) (0268). The price is
 * the admin's (lib/social/paid-verification.ts); the tick comes only from Paystack's verified charge.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in to get verified." }, { status: 401 });
  const { success } = await trackLimiter.limit(`verification-checkout:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const out = await startVerificationCheckout({ userId: user.id, email: user.email ?? "", market: paymentMarket(request.headers), country: paymentCountry(request.headers) });
  return out.ok ? NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } }) : NextResponse.json({ ok: false, error: out.error }, { status: out.status });
}
