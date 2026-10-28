import { NextResponse } from "next/server";
import { z } from "zod";

import { beginCoinDeposit } from "@/lib/coin/deposits";
import { getLandingSettings } from "@/lib/landing/settings";
import { paymentCountry, paymentMarket } from "@/lib/payments/router";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// `provider`: only the member's pick among the rails the router offers (0299) — never an amount, never a rail it doesn't offer
const schema = z.object({ amountCents: z.number().int().positive().max(100_000_000), idempotencyKey: z.string().max(80), provider: z.enum(["flutterwave", "paystack"]).optional() }).strict();

/**
 * POST /api/coin/deposits — start a Frenz Coin deposit (Part 4). The member is the session; the amount is checked against
 * the admin's audited frenzCoin rules here and again in the database; the attempt is recorded BEFORE the checkout opens
 * (Paystack first in Nigeria, Flutterwave first elsewhere — the member may switch, 0299). Nothing is credited here: the
 * webhook, the return check or the sweep settles it once the payment is VERIFIED with that provider, and the coins then
 * sit on hold before they can be spent.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!user.email) return NextResponse.json({ error: "Add an email address to your account first." }, { status: 400 });
  const burst = await aiJobCreateLimiter.limit(`coin-deposit:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many requests — wait a moment." }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const settings = await getLandingSettings();
  // the edge's country, never the browser's: Nigeria pays in naira, Ghana / Kenya / South Africa in their own currency (2026-10-26)
  const out = await beginCoinDeposit({ userId: user.id, email: user.email, amountCents: parsed.data.amountCents, idempotencyKey: parsed.data.idempotencyKey, config: settings.frenzCoin, market: paymentMarket(request.headers), country: paymentCountry(request.headers), provider: parsed.data.provider });
  if (!out.ok) return NextResponse.json({ error: out.error, reason: out.reason }, { status: out.status });
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
