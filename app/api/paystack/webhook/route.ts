import { after, NextResponse } from "next/server";

import { announceCharacterReplaceRecharge, creditVerifiedCharacterReplaceRecharge } from "@/lib/ai/character-replace/recharge-server";
import { resolveCredit } from "@/lib/ai/character-replace/topup-fx";
import { getLandingSettings } from "@/lib/landing/settings";
import { AI_TOPUP_PURPOSE, CHARACTER_REPLACE_TOPUP_PURPOSE, verifyPaystackSignature, type PaystackEventData } from "@/lib/paystack/paystack";
import { isAiPlanEvent, syncAiPlanEvent } from "@/lib/ai/credits/paystack";
import { syncPaystackEvent } from "@/lib/paystack/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HANDLED = new Set([
  "charge.success",
  "subscription.create",
  "subscription.disable",
  "subscription.not_renew",
  "invoice.update",
  "invoice.payment_failed",
]);

/**
 * Paystack webhook. Verifies the HMAC-SHA512 signature against the RAW body,
 * then syncs subscription changes into Supabase.
 */
export async function POST(request: Request) {
  const payload = await request.text(); // raw body — required for signature
  const sig = request.headers.get("x-paystack-signature");

  if (!(await verifyPaystackSignature(payload, sig))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: { event: string; data: PaystackEventData };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  /*
    ═══════════════════════════════════════════════════════════════════════════
     🔴 A FRENZ AI TOP-UP IS A `charge.success` TOO, AND IT IS NOT A PLAN
    ═══════════════════════════════════════════════════════════════════════════

    Owner, 2026-09-09, standing rule §13: "Payment confirmation must be verified
    server-side. Do not credit the balance based solely on a frontend success
    callback."

    This branch is what makes that true — the credit happens HERE, after the
    HMAC check above, and nowhere else. The browser's return from Paystack
    navigates and refreshes; it grants nothing.

    It comes BEFORE `syncPaystackEvent` and returns, because that function's job
    is to resolve a charge to a subscription plan. A top-up has no plan, so
    letting it fall through would at best do nothing and at worst match a stale
    subscription row and change somebody's tier because they bought AI credit.

    ── What is trusted, and what is not ──────────────────────────────────────

    · the AMOUNT comes from Paystack (`data.amount`), never from our own
      `ai_topup_cents` metadata. Metadata is what we asked for; `amount` is what
      settled, and if they ever disagree the money that moved is the truth.
    · the USER comes from metadata we set at initialisation. It is echoed back
      unchanged, and the alternative — matching on email — would credit the
      wrong account for anyone paying with a different address than they
      registered with.
    · the REFERENCE is ours and is the idempotency key. `credit_ai_balance` has
      a unique index on it, so this same delivery arriving three times credits
      once.

    A `status` that is not "success" is ignored outright: Paystack sends
    `charge.success` only on success, but the field exists and reading it costs
    nothing next to crediting a failed payment.
  */
  /*
    ── A CHARACTER REPLACE RECHARGE (Part 3, §3) ───────────────────────────────

    The signature above has already been verified. Its own purpose routes it
    to the PRODUCT wallet — `ai_product_balances`, never `ai_balances` — and
    the credit is idempotent on the reference, so a redelivery, or the
    verify-on-return route landing first, writes nothing twice. Same answers
    as the AI branch below: missing fields are a logged 200 (a retry would
    fail identically), a failed credit is a 500 (a retry can succeed).
  */
  if (event.event === "charge.success" && event.data?.metadata?.purpose === CHARACTER_REPLACE_TOPUP_PURPOSE) {
    const userId = event.data.metadata.user_id;
    const amount = Number(event.data.amount);
    const reference = event.data.reference;
    if (!userId || !reference || !Number.isFinite(amount) || amount <= 0) {
      console.error("[paystack] cr topup missing fields", { hasUser: !!userId, hasReference: !!reference, amount });
      return NextResponse.json({ received: true });
    }
    try {
      /*
        A USD wallet paid for in naira (2026-09-20): what is credited is what
        the pin says the settled naira bought, in the wallet's currency —
        lib/ai/character-replace/topup-fx.ts, the same rule as verify.
      */
      const { frenzAiCurrency: walletCurrency } = await getLandingSettings();
      const credit = resolveCredit({ amount, currency: event.data.currency }, event.data.metadata, walletCurrency);
      if (!credit.ok) {
        console.error("[paystack] cr topup not creditable", { reference, reason: credit.reason, got: event.data.currency, amount, wallet: walletCurrency });
        return NextResponse.json({ received: true });
      }
      const currency = credit.currency;
      const balanceAfterCents = await creditVerifiedCharacterReplaceRecharge({
        userId,
        reference,
        amountCents: credit.amountCents,
        currency,
        channel: event.data.channel ?? null,
        paidAt: event.data.paid_at ?? null,
        gatewayResponse: event.data.gateway_response ?? null,
      });
      after(() =>
        announceCharacterReplaceRecharge({
          userId,
          reference,
          amountCents: credit.amountCents,
          currency,
          balanceAfterCents,
          channel: event.data.channel ?? null,
          paidAt: event.data.paid_at ?? null,
          gatewayResponse: event.data.gateway_response ?? null,
        }),
      );
    } catch (e) {
      console.error("[paystack] cr topup credit failed", { reference, error: String(e) });
      return NextResponse.json({ error: "credit failed" }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  if (event.event === "charge.success" && event.data?.metadata?.purpose === AI_TOPUP_PURPOSE) {
    const userId = event.data.metadata.user_id;
    const amount = Number(event.data.amount);
    const reference = event.data.reference;

    if (!userId || !reference || !Number.isFinite(amount) || amount <= 0) {
      console.error("[paystack] ai topup missing fields", {
        hasUser: !!userId,
        hasReference: !!reference,
        amount,
      });
      // 🔴 Still a 200. A non-2xx makes Paystack retry a delivery that will
      // fail identically forever, and the problem is ours to find in this log.
      return NextResponse.json({ received: true });
    }

    try {
      // 🔴 ONE WALLET (owner, 2026-09-14; 0155): a legacy AI-purpose payment
      // credits the product wallet. `ai_balances` is retired at zero.
      // 2026-09-20: nothing initialises this purpose any more; a stale
      // checkout that settles still goes through the one crediting rule, so
      // kobo can never land in a dollar wallet as cents.
      const { frenzAiCurrency: legacyWallet } = await getLandingSettings();
      const legacyCredit = resolveCredit({ amount, currency: event.data.currency }, event.data.metadata, legacyWallet);
      if (!legacyCredit.ok) {
        console.error("[paystack] legacy ai topup not creditable", { reference, reason: legacyCredit.reason, got: event.data.currency, amount, wallet: legacyWallet });
        return NextResponse.json({ received: true });
      }
      const balanceAfterCents = await creditVerifiedCharacterReplaceRecharge({
        userId,
        reference,
        amountCents: legacyCredit.amountCents,
        currency: legacyCredit.currency,
        channel: event.data.channel ?? null,
        paidAt: event.data.paid_at ?? null,
        gatewayResponse: event.data.gateway_response ?? null,
      });
      /*
        Off the money path (owner, 2026-09-13: push + email invoice on every
        deposit). Both are `void`: the credit above is the thing Paystack must
        see acknowledged, and neither a slow email provider nor a missing
        profile address may turn it into a retry. `notifyTopupSuccess` claims
        the ledger row's `notified_at` first, so if the verify-on-return got
        here a moment earlier this sends nothing.
      */
      // `after()`, not `void`: a serverless function can be frozen the moment
      // the response is sent, and a fire-and-forget promise freezes with it.
      // `after()` is how this platform keeps the invocation alive for work
      // that must not delay the response — the same as the Replicate webhook.
      after(() =>
        announceCharacterReplaceRecharge({
          userId,
          reference,
          amountCents: legacyCredit.amountCents,
          currency: legacyCredit.currency,
          balanceAfterCents,
          channel: event.data.channel ?? null,
          paidAt: event.data.paid_at ?? null,
          gatewayResponse: event.data.gateway_response ?? null,
        }),
      );
    } catch (e) {
      console.error("[paystack] ai topup credit failed", { reference, error: String(e) });
      /*
        🔴 A 500 HERE IS CORRECT, and it is the one place in this route that
        wants a retry. The member has paid and has not been credited; Paystack
        redelivers on a non-2xx, and the unique reference means a later success
        credits exactly once. Acknowledging would strand their money.
      */
      return NextResponse.json({ error: "credit failed" }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  /*
    ── AN AI PLAN (0167) IS A SUBSCRIPTION TOO, AND IT IS NOT THE SITE PLAN ──
    Routed by its purpose (set at checkout, echoed back), by one of the AI
    plan codes, or by a subscription code already on ai_subscriptions —
    BEFORE the site-plan sync, so an AI Max charge can never rewrite a
    member's Pro/Business row or their profile role. The write is idempotent
    by member and reference (lib/ai/credits/subscription.ts).
  */
  if (HANDLED.has(event.event)) {
    try {
      const plans = (await getLandingSettings()).frenzAiPlans;
      if (await isAiPlanEvent(event.data, plans)) {
        await syncAiPlanEvent(event.event, event.data, plans);
        return NextResponse.json({ received: true, aiPlan: true });
      }
    } catch (e) {
      console.error("[paystack] ai plan sync threw", { event: event.event, error: String(e).slice(0, 200) });
      // A redelivery can succeed; the site-plan sync must not see this event.
      return NextResponse.json({ error: "ai plan sync failed" }, { status: 500 });
    }
    try {
      await syncPaystackEvent(event.event, event.data);
    } catch {
      // Acknowledge anyway; the next lifecycle event re-syncs.
      return NextResponse.json({ received: true });
    }
  }

  return NextResponse.json({ received: true });
}
