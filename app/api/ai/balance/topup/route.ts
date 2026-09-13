import { randomUUID } from "node:crypto";

import { after, NextResponse } from "next/server";

import { aiTopupCeiling, aiTopupFloor, formatCents, isAcceptableTopupCents } from "@/lib/ai/economy";
import { recordTopupAttempt } from "@/lib/ai/topup-attempts";
import { aiCurrencySymbol, getLandingSettings } from "@/lib/landing/settings";
import { AI_TOPUP_PURPOSE, initializeAiTopup, paystackEnabled } from "@/lib/paystack/paystack";
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
 * It creates a checkout and hands back a URL. No balance moves here. A member
 * who closes the tab mid-payment is still credited by the webhook; a member who
 * forges a success callback is not credited by anything.
 *
 * ⚠️ There IS now a sibling route at `topup/verify`, which this comment used to
 * say would never exist. It is not a confirm endpoint: it takes a reference,
 * asks PAYSTACK what happened to it, and credits only what Paystack says
 * settled. The browser supplies an identifier, never an outcome and never an
 * amount — see that file.
 *
 * ── 🔴 THE AMOUNT IS BOUNDED BY THE SERVER, NOT CHOSEN FROM A LIST ──────────
 *
 * Owner, 2026-09-09: "the add balance dont have an input field to add a custom
 * amount."
 *
 * It used to accept only the four generated rungs. That was described here as
 * the security property, and it was overstating itself: what actually needs
 * defending is somebody buying credit for a cent, and a server-side FLOOR
 * closes that completely. Every rung was above the floor anyway, so the closed
 * set was a floor with three arbitrary gaps in it.
 *
 * What is unchanged, and is the part that matters: the floor and the ceiling
 * come from the OPERATOR'S SETTINGS, read below after the settings fetch — never
 * from the request. A value outside them is REFUSED rather than clamped;
 * clamping turns an attack into a slightly cheaper purchase.
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

    `isAcceptableTopupCents` takes the minimum as an argument so the module
    stays pure — which means a careless caller could hand it one that arrived in
    the body, and `{ minCents: 1, amountCents: 1 }` would then buy credit for a
    cent. Reading it here, after the settings fetch, is what closes that: the
    bounds the server validates against are the operator's, whatever the client
    believes it was offered.
  */
  const amount = (body as { amountCents?: unknown })?.amountCents;
  if (!isAcceptableTopupCents(amount, frenzAiMinTopupCents)) {
    /*
      🔴 The bounds are named in the message because a member typing a custom
      amount can now be wrong in a way they can fix. "Choose one of the listed
      amounts" was true when there was a list; with a free field it would be a
      refusal with no next step. The numbers are the operator's own public
      settings — the same ones the top-up screen already displays.
    */
    const symbol = aiCurrencySymbol(frenzAiCurrency);
    return NextResponse.json(
      {
        error: `Enter an amount between ${formatCents(aiTopupFloor(frenzAiMinTopupCents), symbol)} and ${formatCents(aiTopupCeiling(frenzAiMinTopupCents), symbol)}.`,
      },
      { status: 400 },
    );
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
      /*
        🔴 BACK TO THE PAGE THEY LEFT, and the dashboard on it VERIFIES rather
        than assuming — see /api/ai/balance/topup/verify.

        This used to be a fixed `/studio/ai?topup=done`, which sent somebody who
        recharged from `/ai/clean` to a different screen and told it nothing it
        could act on. `topup=done` was read by no code at all: the query string
        said the payment finished, the balance had not necessarily moved yet
        (the webhook and this redirect race), and nothing re-read it. That is
        the owner's "i just recharged but it didnt show in the dashboard".

        Paystack appends `?reference=…&trxref=…` to whatever we pass, so the
        returning page has the transaction to verify.
      */
      callbackUrl: `${SITE_URL}${safeReturnTo((body as { returnTo?: unknown })?.returnTo)}`,
    });
    /*
      The attempt, on record BEFORE the member reaches Paystack (0151). A
      declined card leaves no ledger row, so this is the only place a failed
      deposit can be described from — its amount, its currency, and later
      Paystack's reason. Best-effort: a refused insert logs and the checkout
      still opens.
    */
    after(() => recordTopupAttempt({ reference, userId: user.id, amountCents: amount, currency: frenzAiCurrency }));
    return NextResponse.json({ url });
  } catch (e) {
    // 🔴 Never the provider's message. It can carry the request back, and the
    // request carries an email address and our own metadata.
    console.error("[ai/topup] initialize failed", { userId: user.id, error: String(e) });
    return NextResponse.json({ error: "We couldn't start that payment. Try again." }, { status: 502 });
  }
}

/**
 * Where Paystack sends the member back to, as a path on OUR origin.
 *
 * ── 🔴 AN ALLOW-LIST, NOT A SANITISER ───────────────────────────────────────
 *
 * This value arrives in the request body and is concatenated onto `SITE_URL`,
 * which makes it the textbook shape of an open redirect: `//evil.example`
 * resolves to a different HOST after concatenation, `https://evil.example`
 * replaces the origin outright, and a `\` is normalised to `/` by some clients
 * before the browser ever parses it. Every one of those is a phishing link that
 * would be sent by Paystack, from a payment somebody actually made.
 *
 * Trying to strip those cases is a losing game. A fixed set of four AI paths is
 * not: anything that is not literally one of them becomes the default, and no
 * amount of cleverness in the body can widen it.
 */
const RETURN_PATHS = new Set([
  "/ai",
  "/ai/clean",
  "/ai/history",
  "/studio/ai",
  "/studio/ai/clean",
  "/studio/ai/history",
]);

const DEFAULT_RETURN = "/ai/clean";

function safeReturnTo(value: unknown): string {
  return typeof value === "string" && RETURN_PATHS.has(value) ? value : DEFAULT_RETURN;
}
