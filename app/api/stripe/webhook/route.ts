import { NextResponse } from "next/server";

import {
  getSubscription,
  verifyStripeSignature,
  type StripeSubscription,
} from "@/lib/stripe/stripe";
import { syncSubscription } from "@/lib/stripe/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook. Verifies the signature against the RAW body, then syncs
 * subscription changes into Supabase. Handles checkout completion and the
 * subscription lifecycle (create/update/cancel).
 */
export async function POST(request: Request) {
  const payload = await request.text(); // raw body — required for signature check
  const sig = request.headers.get("stripe-signature");

  if (!verifyStripeSignature(payload, sig)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as { subscription?: string };
        if (session.subscription) {
          const sub = await getSubscription(session.subscription);
          await syncSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscription(event.data.object as unknown as StripeSubscription);
        break;
      }
      default:
        break;
    }
  } catch {
    // Acknowledge anyway so Stripe doesn't hammer retries on a transient error;
    // the next lifecycle event will re-sync.
    return NextResponse.json({ received: true });
  }

  return NextResponse.json({ received: true });
}
