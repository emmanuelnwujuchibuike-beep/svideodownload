import { randomUUID } from "node:crypto";

import { after, NextResponse } from "next/server";

import { recordTopupAttempt } from "@/lib/ai/topup-attempts";
import { formatCents } from "@/lib/ai/economy";
import { aiCurrencySymbol, getLandingSettings } from "@/lib/landing/settings";
import { CHARACTER_REPLACE_TOPUP_PURPOSE, initializeAiTopup, paystackEnabled } from "@/lib/paystack/paystack";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { SITE_URL } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/character-replace/topup — begin a Character Replace recharge.
 *
 * Part 3, §3: "Use the existing Paystack payment infrastructure… The recharge
 * transaction must identify product = character_replace… Do not allow a
 * Character Replace recharge to accidentally credit AI Clean balance."
 *
 * The same shape as /api/ai/balance/topup — the same initialiser, the same
 * attempt record, the same random reference — with two differences that are
 * the whole point:
 *
 *   · the amount is checked against the TOOL's recharge bounds and packages
 *     (config.recharge), read from the server's settings, never the body;
 *   · the Paystack metadata carries `purpose: frenz_cr_topup` and the
 *     reference is prefixed with it, so the webhook and the verify-on-return
 *     route credit `ai_product_balances` and never `ai_balances`.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to add Character Replace balance." }, { status: 401 });

  const burst = await aiJobCreateLimiter.limit(`ai-cr-topup:${user.id}`);
  if (!burst.success) {
    return NextResponse.json({ error: "You're going a bit fast — give it a moment." }, { status: 429 });
  }
  if (!(await paystackEnabled())) {
    return NextResponse.json({ error: "Payments aren't available right now." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const email = user.email;
  if (!email) return NextResponse.json({ error: "Add an email to your account first." }, { status: 400 });

  const settings = await getLandingSettings();
  const { recharge, enabled } = settings.frenzAiCharacterReplace;
  if (!enabled) return NextResponse.json({ error: "Character Replace isn't available right now." }, { status: 503 });
  const symbol = aiCurrencySymbol(settings.frenzAiCurrency);

  /*
    🔴 THE BOUNDS COME FROM THE SERVER'S SETTINGS. An integer amount in minor
    units, between the operator's minimum and maximum — a package is simply
    an amount inside that window, so a custom amount is judged by the same
    rule. The message names the bounds so a member typing a custom amount can
    be wrong in a way they can fix.
  */
  const amount = (body as { amountCents?: unknown })?.amountCents;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < recharge.minCents || amount > recharge.maxCents) {
    return NextResponse.json(
      { error: `Enter an amount between ${formatCents(recharge.minCents, symbol)} and ${formatCents(recharge.maxCents, symbol)}.` },
      { status: 400 },
    );
  }

  const reference = `${CHARACTER_REPLACE_TOPUP_PURPOSE}_${randomUUID()}`;
  try {
    const url = await initializeAiTopup({
      email,
      userId: user.id,
      amount,
      currency: settings.frenzAiCurrency,
      reference,
      purpose: CHARACTER_REPLACE_TOPUP_PURPOSE,
      callbackUrl: `${SITE_URL}${safeReturnTo((body as { returnTo?: unknown })?.returnTo)}`,
    });
    after(() => recordTopupAttempt({ reference, userId: user.id, amountCents: amount, currency: settings.frenzAiCurrency }));
    return NextResponse.json({ url });
  } catch (e) {
    // Never the provider's message: it can carry the request back, with the email in it.
    console.error("[ai/cr/topup] initialize failed", { userId: user.id, error: String(e) });
    return NextResponse.json({ error: "We couldn't start that payment. Try again." }, { status: 502 });
  }
}

/** Where Paystack may send the member back. Anything else becomes the workspace. */
const RETURN_PATHS = new Set(["/ai", "/ai/character-replace", "/ai/usage", "/studio/ai", "/studio/ai/character-replace", "/studio/ai/usage"]);
const DEFAULT_RETURN = "/ai/character-replace";

function safeReturnTo(value: unknown): string {
  return typeof value === "string" && RETURN_PATHS.has(value) ? value : DEFAULT_RETURN;
}
