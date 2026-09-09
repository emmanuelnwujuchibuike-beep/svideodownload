import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { isValidTopupCents } from "@/lib/ai/economy";
import { AI_TOPUP_PURPOSE, initializeAiTopup, paystackEnabled } from "@/lib/paystack/paystack";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { SITE_URL } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/ai/balance/topup — start a Paystack checkout for AI credit
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09, standing rule §13: "Use the existing integrated Paystack
 * payment infrastructure. Do NOT create a second payment provider… Payment
 * confirmation must be verified server-side."
 *
 * ── 🔴 THIS ROUTE GRANTS NOTHING ────────────────────────────────────────────
 *
 * It creates a checkout and hands back a URL. No balance moves here, and there
 * is deliberately no "confirm" endpoint a browser can call on its way back from
 * Paystack — the credit happens in the webhook, after an HMAC check, and
 * nowhere else. A member who closes the tab mid-payment is still credited; a
 * member who forges a success callback is not.
 *
 * ── 🔴 THE AMOUNT IS CHOSEN FROM A LIST, NOT SENT AS A NUMBER ───────────────
 *
 * "Users must not be able to manipulate… request payloads." A free-form amount
 * is the most obvious thing in this system to tamper with, so a value that is
 * not one of `AI_TOPUP_OPTIONS_CENTS` is REFUSED rather than clamped — clamping
 * turns an attack into a slightly cheaper purchase.
 *
 * ── The reference is ours, and it is the idempotency key ────────────────────
 *
 * Minted here, echoed back by Paystack, and carrying a unique index in
 * `credit_ai_balance`. A webhook delivered three times credits once.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 🔴 Signed in only, like everything else in Frenz AI. There is no guest
  // balance to top up, and never will be.
  if (!user) return NextResponse.json({ error: "Sign in to add AI credit." }, { status: 401 });

  /*
    Keyed by USER. Rate-limiting a payment start is not about spend — Paystack
    is the one taking the money — it is about somebody minting hundreds of
    pending references and filling the ledger's index with them.
  */
  const burst = await aiJobCreateLimiter.limit(`ai-topup:${user.id}`);
  if (!burst.success) {
    return NextResponse.json({ error: "You're going a bit fast — give it a moment." }, { status: 429 });
  }

  if (!(await paystackEnabled())) {
    // An honest 503 rather than a broken checkout: the operator has not
    // configured a secret key, and that is not the member's problem to decode.
    return NextResponse.json({ error: "Payments aren't available right now." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = user.email;
  if (!email) {
    // Paystack requires one, and we will not invent it.
    return NextResponse.json({ error: "Add an email to your account first." }, { status: 400 });
  }

  const { frenzAiCurrency, frenzAiMinTopupCents } = await getLandingSettings();

  /*
    🔴 THE MINIMUM COMES FROM THE SERVER'S SETTINGS, NEVER FROM THE REQUEST.

    `isValidTopupCents` takes the minimum as an argument so the module stays
    pure — which means a careless caller could hand it one that arrived in the
    body, and `{ minCents: 1, amountCents: 1 }` would then buy credit for a
    cent. Reading it here, after the settings fetch, is what closes that: the
    ladder the server validates against is the ladder the operator configured,
    whatever the client believes it was offered.
  */
  const amount = (body as { amountCents?: unknown })?.amountCents;
  if (!isValidTopupCents(amount, frenzAiMinTopupCents)) {
    return NextResponse.json({ error: "Choose one of the listed amounts." }, { status: 400 });
  }

  /*
    🔴 A PREFIXED, RANDOM REFERENCE. The prefix makes an AI top-up recognisable
    in Paystack's own dashboard without cross-referencing anything, and the uuid
    makes it unguessable — a reference somebody could predict would let them
    replay a webhook body for a payment that never happened, if the signature
    were ever weakened.
  */
  const reference = `${AI_TOPUP_PURPOSE}_${randomUUID()}`;

  try {
    const url = await initializeAiTopup({
      email,
      userId: user.id,
      amount,
      currency: frenzAiCurrency,
      reference,
      // Back to the AI page. The balance may not have moved yet — the webhook
      // and this redirect race — so that screen re-reads rather than assuming.
      callbackUrl: `${SITE_URL}/studio/ai?topup=done`,
    });
    return NextResponse.json({ url });
  } catch (e) {
    // 🔴 Never the provider's message. It can carry the request back, and the
    // request carries an email address and our own metadata.
    console.error("[ai/topup] initialize failed", { userId: user.id, error: String(e) });
    return NextResponse.json({ error: "We couldn't start that payment. Try again." }, { status: 502 });
  }
}
