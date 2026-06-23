import { NextResponse } from "next/server";

import { verifyPaystackSignature, type PaystackEventData } from "@/lib/paystack/paystack";
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

  if (!verifyPaystackSignature(payload, sig)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: { event: string; data: PaystackEventData };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
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
