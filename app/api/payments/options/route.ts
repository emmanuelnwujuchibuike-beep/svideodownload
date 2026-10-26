import { NextResponse } from "next/server";

import { getLandingSettings } from "@/lib/landing/settings";
import { ngPlanBilling } from "@/lib/payments/ng-plan-billing";
import { paymentOptions } from "@/lib/payments/options";
import { localCurrencyFor } from "@/lib/payments/flutterwave-charge";
import { paymentCountry, paymentMarket } from "@/lib/payments/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/payments/options — which payment providers the top-up and plan
 * sheets may offer this visitor (lib/payments/options.ts). Fetched only when a
 * sheet opens. The market is the edge's (never the browser's); no secret or
 * id leaves — provider names, and in Nigeria the two plan buttons' prices.
 */
export async function GET(request: Request) {
  const settings = await getLandingSettings();
  const market = paymentMarket(request.headers);
  const options = await paymentOptions(market, settings.frenzAiPlans, settings.frenzAiCurrency);
  // Nigeria (2026-10-24), and Ghana / Kenya / South Africa in their own currency (2026-10-26): the two plan buttons, each
  // with the amount it charges (display only — the checkout re-decides)
  const country = paymentCountry(request.headers);
  const ngBilling = localCurrencyFor(market, country) ? await ngPlanBilling(settings.frenzAiPlans, settings.frenzAiCurrency, market, country).catch(() => null) : null;
  return NextResponse.json({ ...options, ngBilling, market }, { headers: { "cache-control": "private, no-store" } });
}
