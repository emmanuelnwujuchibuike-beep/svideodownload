import { after, NextResponse } from "next/server";

import { handleBachsAdCollection, handleBachsAdReversal } from "@/lib/ads-platform/payment-server";
import { activateBachsPlan, syncBachsSubscriptionEvent } from "@/lib/ai/credits/bachs-plans";
import { markTopupAttempt } from "@/lib/ai/topup-attempts";
import { bachsAmountCovers, creditBachsTopup, readBachsAttempt } from "@/lib/ai/wallet/bachs-topup";
import { getLandingSettings } from "@/lib/landing/settings";
import { verifyBachsSignature } from "@/lib/payments/bachs";
import { claimProviderEvent, markProviderEvent } from "@/lib/payments/events";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/bachs/webhook — Bachs reports a payment or a subscription change.
 *
 * 🔴 The raw body is read ONCE as text and verified before anything is
 * parsed (X-Bachs-Signature-V2: HMAC-SHA256 of "{t}.{body}", 300 s window —
 * lib/payments/bachs.ts). Unsigned, wrongly signed or stale = 401, nothing
 * changes. Then the delivery is logged once (payment_provider_events, 0186):
 * an event already processed is acknowledged without repeating anything.
 *
 *   collection.succeeded  our reference → the attempt row → a credit pack
 *                         (credited once, the one crediting function) or an
 *                         AI plan (activated, the one subscription store)
 *   collection.failed     the attempt is marked failed — nothing granted
 *   customer.subscription.created / updated / deleted, invoice.*
 *                         → the member's one AI plan row
 *
 * A delivery we cannot act on (not our reference, an amount short) is
 * acknowledged with 200 and logged — a non-2xx would make Bachs retry
 * something that fails identically. A failure of OURS is a 500 so Bachs
 * retries, and the half-done delivery completes (every step is idempotent).
 */
export async function POST(request: Request) {
  const secret = process.env.BACHS_WEBHOOK_SECRET?.trim() ?? "";
  const raw = await request.text();
  const verdict = verifyBachsSignature(raw, request.headers.get("x-bachs-signature-v2"), secret);
  if (!verdict.ok) {
    console.warn("[bachs] webhook refused", { reason: verdict.reason });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let event: { id?: string; type?: string; created_at?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const type = typeof event.type === "string" ? event.type : "";
  const data = event.data ?? {};
  const reference = typeof data.reference === "string" ? data.reference : null;
  console.info("[payments] payment_webhook_verified", { provider: "bachs", type, event: event.id, reference });

  const claim = await claimProviderEvent("bachs", event.id, type || "unknown", reference);
  if (claim === "done") {
    console.info("[payments] webhook duplicate", { provider: "bachs", event: event.id });
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    const outcome = await handle(type, event, data, reference);
    await markProviderEvent("bachs", event.id, outcome);
    return NextResponse.json({ received: true });
  } catch (e) {
    console.error("[payments] webhook processing failed", { provider: "bachs", type, event: event.id, reference, error: String(e).slice(0, 300) });
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}

async function handle(type: string, event: { id?: string; created_at?: string }, data: Record<string, unknown>, reference: string | null): Promise<string> {
  if (type.startsWith("customer.subscription.") || type.startsWith("invoice.")) {
    const settings = await getLandingSettings();
    const r = await syncBachsSubscriptionEvent(type, event.id ?? null, data, settings.frenzAiPlans);
    return r.handled ? `subscription ${r.status}` : "subscription event: no member matched";
  }
  /*
    0197: refunds and disputes name the CHARGE, not our reference. Only an ad
    payment is matched (by the charge id stored when it settled); anything
    else stays "ignored", exactly as before.
  */
  if (type === "refund.paid" || type === "dispute.created" || type === "dispute.updated") {
    return (await handleBachsAdReversal(createAdminClient(), type, data)) ?? "ignored";
  }
  if (type !== "collection.succeeded" && type !== "collection.failed" && type !== "collection.underpaid") return "ignored";

  const attempt = reference ? await readBachsAttempt(reference) : null;
  if (!attempt) {
    console.warn("[bachs] event for a reference we did not create", { type, reference: reference?.slice(0, 80), event: event.id });
    return "not ours";
  }
  // 🔴 0197: an AD payment settles campaigns, never a wallet. Before every wallet line below.
  if (attempt.purpose === "ad_campaign") return handleBachsAdCollection(createAdminClient(), type, data, attempt);
  if (type === "collection.underpaid") return "ignored";
  if (type === "collection.failed") {
    await markTopupAttempt(attempt.reference, { status: "failed", gatewayResponse: typeof data.failure_reason === "string" ? data.failure_reason.slice(0, 200) : "payment failed" });
    console.info("[payments] payment_failed", { provider: "bachs", reference: attempt.reference, purpose: attempt.purpose });
    return "failed";
  }
  if (String(data.status ?? "SUCCEEDED").toUpperCase() !== "SUCCEEDED") return "not succeeded";
  if (!bachsAmountCovers(attempt, { amount: data.amount, currency: data.currency })) {
    console.error("[bachs] paid amount short of the priced amount — nothing granted", { reference: attempt.reference, amount: data.amount, currency: data.currency, priced: attempt.amount_cents });
    return "amount short";
  }
  const customer = (data.customer ?? null) as { id?: unknown } | null;
  if (attempt.purpose === "ai_subscription") {
    const settings = await getLandingSettings();
    const r = await activateBachsPlan(attempt, settings.frenzAiPlans, { customerId: typeof customer?.id === "string" ? customer.id : null, via: "webhook" });
    return r.ok ? `plan ${r.plan} active` : r.reason;
  }
  const { credited, announce } = await creditBachsTopup(attempt, { paidAt: typeof event.created_at === "string" ? event.created_at : null, channel: typeof data.payment_method === "string" ? data.payment_method : "bachs", via: "webhook" });
  console.info("[payments] wallet_credited", { provider: "bachs", reference: attempt.reference, credits: credited.credits, bonus: credited.bonusCredits, event: event.id });
  after(announce);
  return `credited ${credited.credits + credited.bonusCredits}`;
}
