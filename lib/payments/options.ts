import "server-only";

import { AI_PLAN_IDS, type AiPlanId, type AiPlansConfig } from "@/lib/ai/credits/config";
import type { PaymentMarket, TopupProviderId } from "@/lib/ai/credits/wallet-config";
import { FLUTTERWAVE_CHECKOUT_CURRENCY } from "@/lib/flutterwave/config";
import { usableRails } from "@/lib/payments/rails";
import { offeredProviders } from "@/lib/payments/router";
import { paystackEnabled } from "@/lib/paystack/paystack";

/**
 * The providers each checkout sheet may show THIS member. The same usability
 * rules the checkout routes apply — a provider must be configured on the
 * server, and for a plan, the plan must carry that provider's id — in the
 * admin route's order. Display only: the checkout re-decides from scratch.
 * Flutterwave (Part 2) appears only when its account capability gate allows the purpose.
 */
export interface PaymentOptions {
  walletTopup: TopupProviderId[];
  plans: Record<AiPlanId, TopupProviderId[]>;
}

export async function paymentOptions(market: PaymentMarket, plans: AiPlansConfig, walletCurrency: string): Promise<PaymentOptions> {
  const paystackOk = await paystackEnabled();
  const walletRails = await usableRails("wallet_topup");
  const planRails = await usableRails("ai_subscription");
  const routing = plans.wallet.routing;
  const memberChoice = plans.wallet.memberChoice;
  // Flutterwave charges the USD price as it is, so it is offered only for a USD wallet (the checkout's own rule)
  const walletUsd = walletCurrency.toUpperCase() === FLUTTERWAVE_CHECKOUT_CURRENCY;
  return {
    walletTopup: offeredProviders({ purpose: "wallet_topup", market, routing, memberChoice, usable: (p) => walletRails(p) && (p !== "flutterwave" || walletUsd) }),
    plans: Object.fromEntries(
      AI_PLAN_IDS.map((id) => {
        const p = plans.plans[id];
        // AI plans: Flutterwave first (a USD payment plan, card) when its gate allows AI plans and the plan has its id; Paystack (NGN) the backup
        return [id, offeredProviders({ purpose: "ai_subscription", market, routing, memberChoice, usable: (r) => (r === "flutterwave" ? planRails("flutterwave") && !!p.flutterwavePlanId : r === "paystack" && paystackOk && !!p.paystackPlanCode) })];
      }),
    ) as Record<AiPlanId, TopupProviderId[]>,
  };
}
