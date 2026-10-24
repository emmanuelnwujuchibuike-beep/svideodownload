import "server-only";

import type { PaymentPurpose, TopupProviderId } from "@/lib/ai/credits/wallet-config";
import { flutterwaveUsableFor, getFlutterwaveConfig } from "@/lib/flutterwave/config";
import { paystackEnabled } from "@/lib/paystack/paystack";

/**
 * Which rails may take a NEW checkout for this purpose — the `usable` every caller hands the
 * router (Part 2). Paystack: configured (its existing rule). Flutterwave: the account capability
 * gate (key + webhook secret + a CONFIRMED currency + the purpose switched on), never the key
 * alone. Subscriptions never route to Flutterwave (no payment-plan integration yet).
 */
export async function usableRails(purpose: PaymentPurpose): Promise<(p: TopupProviderId) => boolean> {
  const paystackOk = await paystackEnabled();
  const flutterwaveOk = flutterwaveUsableFor(purpose, await getFlutterwaveConfig());
  return (p) => (p === "paystack" ? paystackOk : p === "flutterwave" ? flutterwaveOk : false);
}

export { firstRail, type RailAttempt } from "@/lib/payments/router";
