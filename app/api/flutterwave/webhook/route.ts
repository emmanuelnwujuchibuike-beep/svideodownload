import { after, NextResponse } from "next/server";

import { handleFlutterwaveAdCharge } from "@/lib/ads-platform/payment-server";
import { handleFlutterwaveRenewal, handleFlutterwaveSubscriptionCancelled } from "@/lib/ai/credits/flutterwave-plans";
import { settleFlutterwavePlanTransaction } from "@/lib/ai/credits/plan-webhook";
import { settleFlutterwaveTopup } from "@/lib/ai/wallet/flutterwave-settle";
import { verifyFlutterwaveById, verifyFlutterwaveWebhook } from "@/lib/flutterwave/client";
import { getLandingSettings } from "@/lib/landing/settings";
import { claimProviderEventStrict, markProviderEvent } from "@/lib/payments/events";
import { flutterwaveReferencePurpose } from "@/lib/payments/references";
import { confirmVerificationPayment } from "@/lib/social/paid-verification";
import { verifyFlutterwaveTransfer } from "@/lib/flutterwave/client";
import { isFlutterwavePayoutRef } from "@/lib/rewards/payout-refs";
import { settlePaystackTransfer } from "@/lib/rewards/paystack-payouts";
import { confirmSubPayment } from "@/lib/sub/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/flutterwave/webhook (Part 2; AI plans 2026-10-23)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1. `verif-hash` must equal the dashboard's secret hash (constant time). It is
 *      a static shared secret, not a signature of the body — so it proves the
 *      sender, and NOTHING in the body is believed after it.
 *   2. The delivery is claimed in `payment_provider_events` (provider + event key):
 *      a processed duplicate is acknowledged and does nothing.
 *   3. The transaction is RE-VERIFIED with Flutterwave's API by its id
 *      (GET /v3/transactions/{id}/verify), and the verified `tx_ref` must be the
 *      reference the event named. Only that verified charge reaches settlement.
 *   4. Routed by OUR reference shape (lib/payments/references.ts) to the same
 *      settle function the return page uses; each one checks the charge against
 *      the attempt row written before the checkout, and is idempotent. An AI plan's
 *      first charge settles through its attempt row (exact amount, leased).
 *   5. A charge.completed that is NOT our reference may be a payment-plan RENEWAL:
 *      verified by id, it extends a Flutterwave subscriber's period only at exactly
 *      the plan's price (lib/ai/credits/flutterwave-plans.ts).
 *   6. subscription.cancelled is checked against Flutterwave's subscription list
 *      before anything changes.
 *
 * Answers: 200 for a final outcome (settled, failed, not ours, ignored); 500 when
 * a retry could help (Flutterwave unreachable, a database error, still pending) —
 * the delivery stays unprocessed so the retry runs. Flutterwave retries only when
 * "retries" are switched on in its dashboard (Part 6 checklist).
 */

const ACK = (extra: Record<string, unknown> = {}) => NextResponse.json({ received: true, ...extra });
const RETRY = () => NextResponse.json({ error: "Retry" }, { status: 500 });

interface FlutterwaveEvent {
  event?: string;
  "event.type"?: string;
  /**
   * charge.completed: id, tx_ref, status, customer… — subscription.cancelled (docs): status "deactivated", amount,
   * customer { email }, and plan as an OBJECT { id, name, amount, currency, interval, … } (a bare id is tolerated).
   */
  data?: { id?: number | string; tx_ref?: string; status?: string; customer?: { email?: string } | null; plan?: { id?: number | string } | number | string | null };
}

const isPlanPurpose = (p: string | null): p is "ai_subscription" | "site_subscription" => p === "ai_subscription" || p === "site_subscription";

export async function POST(request: Request) {
  const payload = await request.text();
  if (!(await verifyFlutterwaveWebhook(request.headers.get("verif-hash")))) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let event: FlutterwaveEvent;
  try {
    event = JSON.parse(payload) as FlutterwaveEvent;
  } catch {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  const type = String(event.event ?? event["event.type"] ?? "");

  // 6 — a payment plan stopped: checked with Flutterwave against the STORED subscription id first (Part 3.3)
  if (type === "subscription.cancelled") {
    try {
      const out = await handleFlutterwaveSubscriptionCancelled(event.data ?? {});
      if (!out.ack) return RETRY();
      // recorded for the audit trail (no raw email in the key); the handling itself is idempotent
      if (out.eventKey && (await claimProviderEventStrict("flutterwave", out.eventKey, type, null)) !== "unavailable") await markProviderEvent("flutterwave", out.eventKey, out.outcome);
      return ACK({ outcome: out.outcome });
    } catch {
      return RETRY();
    }
  }

  /*
    2026-10-24 — a withdrawal payout (frenz_fwd_<id>). The body is never believed: Flutterwave is asked about the
    reference, and only SUCCESSFUL / FAILED settle (the shared transfer rules in lib/rewards/paystack-payouts.ts, which
    ask the rail that sent it). Anything unclear answers 500 so the delivery is retried; the reconcile cron also checks.
  */
  if (type === "transfer.completed") {
    const tref = typeof (event.data as { reference?: unknown } | undefined)?.reference === "string" ? String((event.data as { reference: string }).reference) : "";
    if (!isFlutterwavePayoutRef(tref)) return ACK({ ignored: "not a Frenz payout" });
    const v = await verifyFlutterwaveTransfer(tref);
    if (v.kind === "unknown") return RETRY();
    if (v.kind === "not_found") return ACK({ ignored: "transfer not found" });
    try {
      return (await settlePaystackTransfer(v.kind === "success" ? "transfer.success" : "transfer.failed", tref)) ? ACK({ outcome: v.kind }) : RETRY();
    } catch {
      return RETRY();
    }
  }

  const id = event.data?.id !== undefined && event.data?.id !== null ? String(event.data.id) : "";
  const ref = typeof event.data?.tx_ref === "string" ? event.data.tx_ref : "";
  // transfers and refunds are not integrated — acknowledged so they are not retried forever
  if (type !== "charge.completed") return ACK({ ignored: type || "unknown" });
  if (!/^\d{1,20}$/.test(id)) return ACK({ ignored: "no transaction id" });
  const purpose = flutterwaveReferencePurpose(ref);

  // Part 3.3: the claim never fails open — if the event log can't be written, Flutterwave is asked to retry
  const key = `charge.completed:${id}`;
  const claim = await claimProviderEventStrict("flutterwave", key, type, ref || null);
  if (claim === "unavailable") return RETRY();
  if (claim === "done") return ACK({ duplicate: true });

  try {
    // 🔴 the API's answer, never the body's: status, amount, currency and reference come from here
    const charge = await verifyFlutterwaveById(id);
    const settings = () => getLandingSettings().then((s) => s.frenzAiPlans);
    /** a possible renewal: final outcomes are marked processed; a PENDING one is acknowledged but left open for its next delivery */
    const renewal = async () => {
      const out = await handleFlutterwaveRenewal(charge, { source: "webhook" });
      if (!out.ack) return RETRY();
      if (out.final) await markProviderEvent("flutterwave", key, out.outcome);
      return ACK({ outcome: out.outcome });
    };

    // 5 — not one of our references (by the VERIFIED reference too): a payment-plan renewal, or nothing of ours
    if (!purpose) {
      if (charge.status === "not_found") {
        await markProviderEvent("flutterwave", key, "ignored:not_found");
        return ACK({ ignored: "not found" });
      }
      const verifiedPurpose = charge.reference ? flutterwaveReferencePurpose(charge.reference) : null;
      if (verifiedPurpose && !isPlanPurpose(verifiedPurpose)) {
        await markProviderEvent("flutterwave", key, "ignored:not_a_renewal");
        return ACK({ ignored: "not a Frenz reference" });
      }
      if (!verifiedPurpose) return renewal();
      // the body named no (or another) reference but Flutterwave's record carries one of our plan references: decided by
      // the VERIFIED reference and transaction id, exactly like the case below
      const out = await settleFlutterwavePlanTransaction(charge.reference!, await settings(), charge);
      if (out.subsequent) return renewal();
      if (!out.ack) return RETRY();
      await markProviderEvent("flutterwave", key, `${verifiedPurpose}:${out.outcome}`);
      return ACK();
    }

    if (charge.status !== "not_found" && charge.reference !== ref) {
      console.error("[flutterwave] verified transaction is for another reference", { id, event: ref, verified: charge.reference });
      await markProviderEvent("flutterwave", key, "ignored:reference_mismatch");
      return ACK({ ignored: "reference mismatch" });
    }
    if (charge.status === "not_found") {
      await markProviderEvent("flutterwave", key, "ignored:not_found");
      return ACK({ ignored: "not found" });
    }

    let outcome = "unknown";
    let final = true;
    switch (purpose) {
      case "wallet_topup": {
        const out = await settleFlutterwaveTopup(ref, { charge });
        if (out.kind === "credited") after(out.announce);
        outcome = out.kind;
        final = out.kind !== "pending";
        break;
      }
      case "sub_purchase": {
        const out = await confirmSubPayment(ref, { flutterwaveCharge: charge });
        outcome = out.status;
        final = out.status !== "pending";
        break;
      }
      case "verification": {
        const out = await confirmVerificationPayment(ref, { flutterwaveCharge: charge });
        outcome = out;
        final = out !== "pending";
        break;
      }
      case "ad_campaign": {
        outcome = await handleFlutterwaveAdCharge(createAdminClient(), charge);
        break;
      }
      case "ai_subscription":
      // Pro / Business first charges settle through the same plan-attempt path (the row says which plan)
      case "site_subscription": {
        // Part 3.3 (H5): the attempt's FIRST charge is the one whose transaction id settled it; another transaction on
        // the same reference is a later charge — routed as a possible renewal, never "already settled"
        const out = await settleFlutterwavePlanTransaction(ref, await settings(), charge);
        if (out.subsequent) return renewal();
        outcome = out.outcome;
        final = out.ack;
        break;
      }
    }
    if (!final) return RETRY();
    await markProviderEvent("flutterwave", key, `${purpose}:${outcome}`);
    return ACK();
  } catch (e) {
    console.error("[flutterwave] webhook processing failed — asking for a retry", { id, reference: ref, error: e instanceof Error ? e.name : "unknown" });
    return RETRY();
  }
}
