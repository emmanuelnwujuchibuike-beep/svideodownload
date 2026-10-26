import { after, NextResponse } from "next/server";

import { announceCharacterReplaceRecharge, creditVerifiedCharacterReplaceRecharge } from "@/lib/ai/character-replace/recharge-server";
import { resolveCredit } from "@/lib/ai/character-replace/topup-fx";
import { WALLET_UNIT } from "@/lib/ai/credits/units";
import { getLandingSettings } from "@/lib/landing/settings";
import { AD_CAMPAIGN_PURPOSE, AI_TOPUP_PURPOSE, CHARACTER_REPLACE_TOPUP_PURPOSE, SUB_PURPOSE, VERIFICATION_PURPOSE, verifyPaystackSignature, type PaystackEventData } from "@/lib/paystack/paystack";
import { confirmVerificationPayment, reversePaidVerification } from "@/lib/social/paid-verification";
import { confirmSubPayment, reverseSub, reverseSubForRefund } from "@/lib/sub/server";
import { isAiPlanEvent } from "@/lib/ai/credits/paystack";
import { handleAiPlanWebhook } from "@/lib/ai/credits/plan-webhook";
import { syncPaystackEvent } from "@/lib/paystack/sync";
import { handlePaystackAdCharge, handlePaystackAdReversal } from "@/lib/ads-platform/payment-server";
import { claimProviderEvent, markProviderEvent } from "@/lib/payments/events";
import { handlePaystackTopupReversal } from "@/lib/ai/wallet/topup-reversals";
import { settlePaystackTransfer } from "@/lib/rewards/paystack-payouts";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HANDLED = new Set([
  "charge.success",
  "subscription.create",
  "subscription.disable",
  "subscription.not_renew",
  "invoice.update",
  "invoice.payment_failed",
  // owner 2026-10-11: withdrawals paid out through Paystack Transfers (lib/rewards/paystack-payouts.ts)
  "transfer.success",
  "transfer.failed",
  "transfer.reversed",
  // 0227: SUB refunds and chargebacks take the access back and claw the earnings back
  "refund.processed",
  "charge.dispute.create",
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
    ── A WITHDRAWAL PAYOUT (owner 2026-10-11) — before everything else ─────────
    Our transfers carry the reference frenz_wd_<withdrawal>. Settling is
    idempotent (a finished withdrawal is left alone); a failure of ours is a 500
    so Paystack redelivers, and the reconcile cron verifies anything still open.
  */
  if (event.event === "transfer.success" || event.event === "transfer.failed" || event.event === "transfer.reversed") {
    try {
      await settlePaystackTransfer(event.event, event.data?.reference ?? undefined);
      return NextResponse.json({ received: true });
    } catch {
      return NextResponse.json({ error: "Retry" }, { status: 500 });
    }
  }

  /*
    ── A SUB PAYMENT (0227) — its own purpose, so it can never credit a wallet ───
    confirmSubPayment re-verifies the reference with Paystack and settles in the
    database (idempotent). A refund or a dispute on a SUB charge reverses it.
  */
  if (event.event === "charge.success" && event.data?.metadata?.purpose === SUB_PURPOSE) {
    const ref = event.data.reference ?? "";
    const key = `charge.success:${ref}`;
    if ((await claimProviderEvent("paystack", key, event.event, ref)) === "done") return NextResponse.json({ received: true, duplicate: true });
    const out = await confirmSubPayment(ref);
    if (out.status === "pending") return NextResponse.json({ error: "Retry" }, { status: 500 });
    await markProviderEvent("paystack", key, out.status);
    return NextResponse.json({ received: true });
  }
  /*
    ── PAID VERIFICATION (0268) — its own purpose, so it can never credit a wallet or settle a SUB ──
    confirmVerificationPayment re-verifies the reference with Paystack and grants the tick once
    (a conditional update — the return page may get there first). Unsettled = 500, Paystack redelivers.
  */
  if (event.event === "charge.success" && event.data?.metadata?.purpose === VERIFICATION_PURPOSE) {
    const ref = event.data.reference ?? "";
    const key = `charge.success:${ref}`;
    if ((await claimProviderEvent("paystack", key, event.event, ref)) === "done") return NextResponse.json({ received: true, duplicate: true });
    const out = await confirmVerificationPayment(ref);
    if (out === "pending") return NextResponse.json({ error: "Retry" }, { status: 500 });
    await markProviderEvent("paystack", key, out);
    return NextResponse.json({ received: true });
  }
  /*
    ── A WALLET TOP-UP REFUNDED OR DISPUTED (Frenz Coin Part 2, 0278) ─────────
    A paid deposit is withdrawable credit (0202), so its refund or chargeback takes the credits back — once per
    event, never more than the top-up credited, never below zero (a shortfall restricts the account for review).
    The original charge is re-verified with Paystack first (lib/ai/wallet/topup-reversals.ts). Not a wallet
    top-up → null, and the branches below carry on exactly as before.
  */
  if (event.event === "refund.processed" || event.event.startsWith("charge.dispute.")) {
    try {
      const out = await handlePaystackTopupReversal(event.event, (event.data ?? {}) as unknown as Record<string, unknown>);
      if (out) {
        if (out.retry) return NextResponse.json({ error: "Retry" }, { status: 500 });
        return NextResponse.json({ received: true, outcome: out.outcome });
      }
    } catch (e) {
      console.error("[paystack] wallet top-up reversal failed, asking for a retry", { event: event.event, error: e instanceof Error ? e.name : "unknown" });
      return NextResponse.json({ error: "Retry" }, { status: 500 });
    }
  }
  if (event.event === "refund.processed" || event.event === "charge.dispute.create") {
    const ref = event.data?.transaction_reference ?? event.data?.transaction?.reference ?? event.data?.reference ?? "";
    // 0268: a refunded or disputed verification charge takes the paid tick back
    if (ref.startsWith("frenz_vf_")) {
      const key = `${event.event}:${ref}`;
      if ((await claimProviderEvent("paystack", key, event.event, ref)) === "done") return NextResponse.json({ received: true, duplicate: true });
      try {
        await markProviderEvent("paystack", key, await reversePaidVerification(ref));
        return NextResponse.json({ received: true });
      } catch {
        return NextResponse.json({ error: "Retry" }, { status: 500 });
      }
    }
    if (ref.startsWith("frenz_sub_")) {
      /*
        🔴 Part 2 (2026-10-16, audit S2): a failed reversal used to be answered 200, so Paystack
        never redelivered it and a refunded subscriber kept access while the creator kept the
        money. Now only a final answer is acknowledged: done, already done (the SQL is
        idempotent on the reference, so a redelivery can never claw back twice), or a
        permanently invalid event (an unknown reference). Anything else — a database error, a
        timeout — is a 500, and the delivery log is left unprocessed so the retry runs.
      */
      const key = `${event.event}:${ref}`;
      if ((await claimProviderEvent("paystack", key, event.event, ref)) === "done") return NextResponse.json({ received: true, duplicate: true });
      // Part 12: a refund reverses only when it refunds the whole charge (reverseSubForRefund); a dispute always does
      const out = await (event.event === "refund.processed"
        ? reverseSubForRefund(ref, { minor: event.data?.amount, currency: event.data?.currency })
        : reverseSub(ref, "disputed", null, `Paystack ${event.event}`)
      ).catch(() => ({ ok: false as const, error: "threw", status: 500, reason: undefined }));
      if (out.ok) {
        await markProviderEvent("paystack", key, "review" in out && out.review ? "review_partial_refund" : "reversed");
        return NextResponse.json({ received: true });
      }
      if (out.status >= 500) {
        console.error("[paystack] SUB reversal failed, asking for a retry", { reference: ref, event: event.event });
        return NextResponse.json({ error: "Retry" }, { status: 500 });
      }
      await markProviderEvent("paystack", key, `ignored:${out.reason ?? "invalid"}`);
      return NextResponse.json({ received: true, note: out.error });
    }
  }

  /*
    ── AN AD CAMPAIGN (0197) — before every wallet and plan branch ─────────────
    Its own purpose (set at initialize, echoed back), so it can never credit a
    wallet or touch a plan. Paystack sends no event id, so the delivery log key
    is event + reference. Settling is idempotent in the database either way; a
    failure of ours is a 500 so Paystack redelivers.
  */
  if (event.event === "charge.success" && event.data?.metadata?.purpose === AD_CAMPAIGN_PURPOSE) {
    const ref = event.data.reference ?? null;
    const key = `charge.success:${ref}`;
    if ((await claimProviderEvent("paystack", key, event.event, ref)) === "done") return NextResponse.json({ received: true, duplicate: true });
    try {
      const outcome = await handlePaystackAdCharge(createAdminClient(), event.data as PaystackEventData & { id?: number });
      await markProviderEvent("paystack", key, outcome);
      return NextResponse.json({ received: true });
    } catch (e) {
      console.error("[paystack] ad charge failed", { reference: ref, error: String(e).slice(0, 200) });
      return NextResponse.json({ error: "processing failed" }, { status: 500 });
    }
  }
  if (event.event.startsWith("refund.") || event.event.startsWith("charge.dispute.")) {
    try {
      const raw = event.data as unknown as Record<string, unknown>;
      const outcome = await handlePaystackAdReversal(createAdminClient(), event.event, raw);
      if (outcome !== null) {
        const id = typeof raw.id === "number" || typeof raw.id === "string" ? String(raw.id) : "";
        await claimProviderEvent("paystack", `${event.event}:${id}`, event.event, null);
        await markProviderEvent("paystack", `${event.event}:${id}`, outcome);
        return NextResponse.json({ received: true });
      }
    } catch (e) {
      console.error("[paystack] ad reversal failed", { event: event.event, error: String(e).slice(0, 200) });
      return NextResponse.json({ error: "processing failed" }, { status: 500 });
    }
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
      const credited = await creditVerifiedCharacterReplaceRecharge({
        userId,
        reference,
        amountCents: credit.amountCents,
        currency,
        packId: event.data.metadata?.ai_topup_pack,
        channel: event.data.channel ?? null,
        paidAt: event.data.paid_at ?? null,
        gatewayResponse: event.data.gateway_response ?? null,
      });
      after(() =>
        announceCharacterReplaceRecharge({
          userId,
          reference,
          amountCents: credited.credits + credited.bonusCredits,
          currency: WALLET_UNIT,
          balanceAfterCents: credited.balanceAfterCents,
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
      const legacyCredited = await creditVerifiedCharacterReplaceRecharge({
        userId,
        reference,
        amountCents: legacyCredit.amountCents,
        currency: legacyCredit.currency,
        packId: event.data.metadata?.ai_topup_pack,
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
          amountCents: legacyCredited.credits + legacyCredited.bonusCredits,
          currency: WALLET_UNIT,
          balanceAfterCents: legacyCredited.balanceAfterCents,
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
        /*
          Part 3.1: what an AI plan event may GRANT is decided in lib/ai/credits/plan-webhook.ts — a first purchase only on a
          charge re-verified with Paystack and EXACTLY matched (our attempt row, or the Paystack plan's own price for an
          older checkout); renewals and lifecycle of a subscription the member already holds keep the established path.
          Not final (verification unreachable, a purchase still in flight) → 500, Paystack redelivers.
        */
        const key = event.event === "charge.success" && event.data?.reference ? `charge.success:${event.data.reference}` : null;
        if (key && (await claimProviderEvent("paystack", key, event.event, event.data.reference ?? null)) === "done") return NextResponse.json({ received: true, duplicate: true });
        const out = await handleAiPlanWebhook(event.event, event.data, plans);
        if (!out.ack) return NextResponse.json({ error: "Retry" }, { status: 500 });
        if (key) await markProviderEvent("paystack", key, `ai_plan:${out.outcome}`);
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
