import { after, NextResponse } from "next/server";

import { getLandingSettings } from "@/lib/landing/settings";
import { announceCharacterReplaceRecharge, creditVerifiedCharacterReplaceRecharge } from "@/lib/ai/character-replace/recharge-server";
import { getCharacterReplaceBalanceCents } from "@/lib/ai/character-replace/wallet";
import { WALLET_UNIT } from "@/lib/ai/credits/units";
import { creditBachsTopup, readBachsAttempt } from "@/lib/ai/wallet/bachs-topup";
import { settleCharacterReplaceCharge, settleUnpaidTopup } from "@/lib/ai/wallet/paystack-settle";
import { BACHS_TOPUP_PREFIX, bachsConfigured, bachsStatusIsPaid, getBachsCheckout } from "@/lib/payments/bachs";
import { AI_TOPUP_PURPOSE, CHARACTER_REPLACE_TOPUP_PURPOSE, paystackEnabled, verifyTransaction } from "@/lib/paystack/paystack";
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

  /*
    ── BACHS (2026-10-07) ─────────────────────────────────────────────────
    A Bachs reference is ours (`frenz_bachs_topup_…`) and its attempt row says
    whose it is, what it was priced at and which checkout it opened. The
    session is asked as Bachs holds it now; only SUCCEEDED credits, through
    the same once-only function as the webhook. Anything else answers
    "pending" — the signed webhook is the source of truth and will credit
    when it lands. The browser's return is never proof by itself.
  */
  if (reference.startsWith(BACHS_TOPUP_PREFIX)) {
    try {
      const attempt = await readBachsAttempt(reference);
      if (!attempt || attempt.user_id !== user.id) return NextResponse.json({ credited: false });
      if (!attempt.external_id || !bachsConfigured()) return NextResponse.json({ credited: false, pending: true });
      const session = await getBachsCheckout(attempt.external_id);
      if (!bachsStatusIsPaid(session.status) || (session.reference && session.reference !== reference)) {
        return NextResponse.json({ credited: false, pending: true });
      }
      const { credited, announce } = await creditBachsTopup(attempt, { via: "return" });
      after(announce);
      return NextResponse.json({ credited: true, balanceCents: credited.balanceAfterCents, balanceCredits: credited.balanceAfterCents, creditsAdded: credited.credits + credited.bonusCredits, product: "character_replace" });
    } catch (e) {
      // ambiguous ≠ failed: the payment may well have gone through — the webhook will credit it
      console.error("[ai/topup-verify] bachs check failed", { reference, error: String(e).slice(0, 200) });
      return NextResponse.json({ credited: false, pending: true });
    }
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
      /*
        ── A DECLINE IS A FACT THE MEMBER IS OWED (owner, 2026-09-13) ─────────

        "failed" is Paystack's word for a charge that was attempted and
        refused — a declined card, insufficient funds. It is recorded on the
        attempt row and announced ONCE (push + email), with Paystack's own
        customer-facing reason line and nothing else of theirs.

        "abandoned" is a member who closed the checkout without paying; it is
        recorded so the statement is complete and, since 2026-10-07 (owner:
        "a push notification when their deposit was successful or cancelled"),
        announced once by push — "cancelled, nothing was charged" — never by
        email, there being no invoice for money that never moved. "pending" is left alone: the
        dashboard keeps polling it.

        Ownership is checked the same way as the success path below — the
        session's id against what Paystack echoed from initialisation.
      */
      if (
        (charge.status === "failed" || charge.status === "abandoned") &&
        (charge.metadata?.purpose === AI_TOPUP_PURPOSE || charge.metadata?.purpose === CHARACTER_REPLACE_TOPUP_PURPOSE) &&
        charge.metadata?.user_id === user.id
      ) {
        const outcome = charge.status;
        // `after()`: kept alive past the response — see the webhook for why.
        // 2026-10-07 (owner): a cancelled checkout is announced too — "cancelled, nothing was charged"
        after(() =>
          settleUnpaidTopup({
            userId: user.id,
            reference,
            outcome,
            amountCents: Number(charge.amount),
            currency: charge.currency ?? "",
            gatewayResponse: charge.gateway_response ?? null,
            channel: charge.channel ?? null,
          }),
        );
      }
      return NextResponse.json({ credited: false, pending: charge.status === "pending" });
    }

    /*
      ── CHARACTER REPLACE (Part 3, §3) ──────────────────────────────────────

      Its own purpose, its own wallet. The same three checks the AI branch
      below makes — ownership, currency, amount — and then the PRODUCT credit,
      never `creditAiBalance`. Placed before the AI branch so a Character
      Replace reference can never fall through into it.
    */
    if (charge.metadata?.purpose === CHARACTER_REPLACE_TOPUP_PURPOSE) {
      if (charge.metadata?.user_id !== user.id) {
        console.warn("[ai/topup-verify] cr reference does not belong to caller", { userId: user.id, reference });
        return NextResponse.json({ credited: false });
      }
      // the one settle path, shared with the reconciler (lib/ai/wallet/paystack-settle.ts)
      const settled = await settleCharacterReplaceCharge(user.id, reference, charge);
      if (settled.kind !== "credited") return NextResponse.json({ credited: false });
      after(settled.announce);
      return NextResponse.json({ credited: true, balanceCents: settled.balanceAfterCents, balanceCredits: settled.balanceAfterCents, creditsAdded: settled.creditsAdded, product: "character_replace" });
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
    /*
      ── 🔴 ONE WALLET (owner, 2026-09-14; migration 0155) ─────────────────────
      A legacy `frenz_ai_topup` reference — a payment started before the
      wallets were unified and completed after — credits the SAME product
      wallet a `frenz_cr_topup` one does. `ai_balances` is retired at zero;
      nothing writes it any more. Idempotent on the reference as before.
    */
    const legacyCredited = await creditVerifiedCharacterReplaceRecharge({
      userId: user.id,
      reference,
      amountCents: amount,
      currency: frenzAiCurrency,
      packId: charge.metadata?.ai_topup_pack,
      channel: charge.channel ?? null,
      paidAt: charge.paid_at ?? null,
      gatewayResponse: charge.gateway_response ?? null,
    });
    after(() =>
      announceCharacterReplaceRecharge({
        userId: user.id,
        reference,
        amountCents: legacyCredited.credits + legacyCredited.bonusCredits,
        currency: WALLET_UNIT,
        balanceAfterCents: legacyCredited.balanceAfterCents,
        channel: charge.channel ?? null,
        paidAt: charge.paid_at ?? null,
        gatewayResponse: charge.gateway_response ?? null,
      }),
    );

    return NextResponse.json({ credited: true, balanceCents: legacyCredited.balanceAfterCents, balanceCredits: legacyCredited.balanceAfterCents, creditsAdded: legacyCredited.credits + legacyCredited.bonusCredits, product: "character_replace" });
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
      return NextResponse.json({ credited: false, balanceCents: await getCharacterReplaceBalanceCents(user.id) });
    } catch {
      return NextResponse.json({ error: "We couldn't check that payment. Try again." }, { status: 503 });
    }
  }
}
