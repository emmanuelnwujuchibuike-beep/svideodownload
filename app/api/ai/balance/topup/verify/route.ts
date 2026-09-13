import { NextResponse } from "next/server";

import { creditAiBalance, getAiBalanceCents } from "@/lib/ai/balance";
import { getLandingSettings } from "@/lib/landing/settings";
import { AI_TOPUP_PURPOSE, paystackEnabled, verifyTransaction } from "@/lib/paystack/paystack";
import { aiJobReadLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/ai/balance/topup/verify — settle a top-up the webhook has not
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "i just recharged but it didnt show in the dashboard."
 *
 * ── 🔴 WHAT WAS ACTUALLY BROKEN ─────────────────────────────────────────────
 *
 * Everything downstream of the webhook worked. `credit_ai_balance` is atomic,
 * idempotent on the reference, and writes the ledger row in the same statement
 * pair. The gap was in front of it: the browser came back from Paystack to a
 * fixed `/studio/ai?topup=done`, that query string was read by NO code, and the
 * page it landed on fetched the balance exactly once on mount — usually before
 * the webhook had been delivered, and forever if it never was.
 *
 * So a member paid, was returned to a screen showing their old balance, and had
 * no way to make it change. From where they sit that is a payment that vanished.
 *
 * ── 🔴 THIS IS NOT A FRONTEND SUCCESS CALLBACK ──────────────────────────────
 *
 * §13: "Payment confirmation must be verified server-side. Do not credit the
 * balance based solely on a frontend success callback."
 *
 * The browser sends ONE thing: a reference. It does not send an amount, a
 * status, a currency or a user — and none of those are read from it. This route
 * asks Paystack directly, with the secret key, and believes only that answer:
 *
 *   1. Paystack must say `status === "success"`. Not "pending", not "abandoned".
 *   2. The transaction's metadata must carry OUR `purpose` marker, so a
 *      subscription charge cannot be replayed here as AI credit.
 *   3. `metadata.user_id` must be the SESSION user. This is the check that
 *      matters most: references are uuids and unguessable, but "unguessable" is
 *      not an authorisation model, and without this a leaked reference would
 *      credit whoever presented it rather than whoever paid.
 *   4. The currency must be the one we are configured to sell in, so a
 *      transaction in a currency we did not price cannot be credited 1:1.
 *   5. The amount credited is Paystack's `amount` — what SETTLED — never
 *      anything the request said and never our own metadata copy of it.
 *
 * ── 🔴 IT CANNOT DOUBLE-CREDIT, AND THAT IS NOT LUCK ────────────────────────
 *
 * The webhook and this route both call `credit_ai_balance` with the same
 * Paystack reference, which carries a unique index in migration 0149. Whichever
 * arrives first credits; the other is a no-op that returns the same balance.
 * That is precisely why this could be added without weakening anything: it is a
 * second door onto an operation that was already idempotent.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Sign in to check that payment." }, { status: 401 });

  const burst = await aiJobReadLimiter.limit(`ai-topup-verify:${user.id}`);
  if (!burst.success) {
    return NextResponse.json({ error: "You're going a bit fast — give it a moment." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const reference = (body as { reference?: unknown })?.reference;
  /*
    Shape-checked before it is put in a URL. Our own references are
    `frenz_ai_topup_<uuid>`, and Paystack's own charset for a reference is
    alphanumerics with `-._=:` — anything outside that is not a reference we
    could have minted, so it is refused rather than sent upstream.
  */
  if (typeof reference !== "string" || !/^[A-Za-z0-9_\-.=:]{8,120}$/.test(reference)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!(await paystackEnabled())) {
    return NextResponse.json({ error: "Payments aren't available right now." }, { status: 503 });
  }

  try {
    const charge = await verifyTransaction(reference);

    /*
      🔴 NOT AN ERROR. A member returning from an abandoned checkout, or landing
      here while Paystack still shows the charge as pending, has done nothing
      wrong — and `credited: false` is exactly what the dashboard needs to know
      to keep its existing balance on screen rather than show a failure.
    */
    if (charge.status !== "success") {
      return NextResponse.json({ credited: false, pending: charge.status === "pending" });
    }

    if (charge.metadata?.purpose !== AI_TOPUP_PURPOSE) {
      // A real Paystack transaction, but not an AI top-up. Crediting it would
      // hand somebody AI balance for their subscription payment.
      return NextResponse.json({ credited: false });
    }

    /*
      🔴 THE OWNERSHIP CHECK. Standing rule §21: "Never trust a user-supplied
      user ID." The id compared here is the SESSION'S, and the one it is
      compared against is the one Paystack echoed back from initialisation —
      neither of them came from this request body.
    */
    if (charge.metadata?.user_id !== user.id) {
      console.warn("[ai/topup-verify] reference does not belong to caller", {
        userId: user.id,
        reference,
      });
      return NextResponse.json({ credited: false });
    }

    const { frenzAiCurrency } = await getLandingSettings();
    if (charge.currency && charge.currency !== frenzAiCurrency) {
      /*
        🔴 Minor units are only comparable within one currency. Crediting 200000
        kobo as 200000 cents would be a ~1500× gift, and the operator can change
        the billing currency between a checkout starting and it settling.
      */
      console.error("[ai/topup-verify] currency mismatch", {
        reference,
        got: charge.currency,
        expected: frenzAiCurrency,
      });
      return NextResponse.json({ credited: false });
    }

    const amount = Number(charge.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ credited: false });
    }

    /*
      Idempotent on `reference` — see migration 0149's unique index. If the
      webhook already credited this, the function returns the existing balance
      and writes nothing, which is why calling this on every return is safe.
    */
    const balanceCents = await creditAiBalance({
      userId: user.id,
      amountCents: amount,
      kind: "topup",
      reference,
    });

    return NextResponse.json({ credited: true, balanceCents });
  } catch (e) {
    /*
      🔴 Never the provider's message, and never a stack. §22: "Do not expose
      technical errors… Replicate errors, model names, API errors, or backend
      details." A Paystack error body can carry the original request back, and
      that request carries an email address.

      The balance is re-read so the panel still gets a true number: a verify that
      could not run is not a reason to show somebody a wrong balance.
    */
    console.error("[ai/topup-verify] failed", { userId: user.id, reference, error: String(e) });
    try {
      return NextResponse.json({ credited: false, balanceCents: await getAiBalanceCents(user.id) });
    } catch {
      return NextResponse.json({ error: "We couldn't check that payment. Try again." }, { status: 502 });
    }
  }
}
