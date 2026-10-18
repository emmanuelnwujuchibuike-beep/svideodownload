import "server-only";

import { AI_PLAN_IDS, type AiPlanId, type AiPlansConfig } from "@/lib/ai/credits/config";
import type { PaymentMarket, TopupProviderId } from "@/lib/ai/credits/wallet-config";
import { offeredProviders } from "@/lib/payments/router";
import { paystackEnabled } from "@/lib/paystack/paystack";

/**
 * The providers each checkout sheet may show THIS member. The same usability
 * rules the checkout routes apply — a provider must be configured on the
 * server, and for a plan, the plan must carry that provider's id — in the
 * admin route's order. Display only: the checkout re-decides from scratch.
 * Paystack is the only provider since Bachs was removed (2026-10-17).
 */
export interface PaymentOptions {
  walletTopup: TopupProviderId[];
  plans: Record<AiPlanId, TopupProviderId[]>;
}

export async function paymentOptions(market: PaymentMarket, plans: AiPlansConfig): Promise<PaymentOptions> {
  const paystackOk = await paystackEnabled();
  const routing = plans.wallet.routing;
  const memberChoice = plans.wallet.memberChoice;
  return {
    walletTopup: offeredProviders({ purpose: "wallet_topup", market, routing, memberChoice, usable: () => paystackOk }),
    plans: Object.fromEntries(
      AI_PLAN_IDS.map((id) => {
        const p = plans.plans[id];
        return [id, offeredProviders({ purpose: "ai_subscription", market, routing, memberChoice, usable: () => paystackOk && !!p.paystackPlanCode })];
      }),
    ) as Record<AiPlanId, TopupProviderId[]>,
  };
}
