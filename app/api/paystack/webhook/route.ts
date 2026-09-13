import { after, NextResponse } from "next/server";

import { creditAiBalance } from "@/lib/ai/balance";
import { markTopupAttempt } from "@/lib/ai/topup-attempts";
import { notifyTopupSuccess } from "@/lib/ai/topup-notify";
import { AI_TOPUP_PURPOSE, verifyPaystackSignature, type PaystackEventData } from "@/lib/paystack/paystack";
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
      const balanceAfterCents = await creditAiBalance({ userId, amountCents: amount, kind: "topup", reference });
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
      after(async () => {
        await markTopupAttempt(reference, {
          status: "success",
          gatewayResponse: event.data.gateway_response ?? null,
          channel: event.data.channel ?? null,
          paidAt: event.data.paid_at ?? null,
        });
        await notifyTopupSuccess({
          userId,
          reference,
          amountCents: amount,
          currency: event.data.currency ?? "",
          balanceAfterCents,
          channel: event.data.channel ?? null,
          paidAt: event.data.paid_at ?? null,
        });
      });
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

  if (HANDLED.has(event.event)) {
    try {
      await syncPaystackEvent(event.event, event.data);
    } catch {
      // Acknowledge anyway; the next lifecycle event re-syncs.
      return NextResponse.json({ received: true });
    }
  }

  return NextResponse.json({ received: true });
}
