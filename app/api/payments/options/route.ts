import { NextResponse } from "next/server";

import { getLandingSettings } from "@/lib/landing/settings";
import { paymentOptions } from "@/lib/payments/options";
import { paymentMarket } from "@/lib/payments/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/payments/options — which payment providers the top-up and plan
 * sheets may offer this visitor (lib/payments/options.ts). Fetched only when a
 * sheet opens. The market is the edge's (never the browser's); no secret,
 * price or id leaves — only provider names.
 */
export async function GET(request: Request) {
  const settings = await getLandingSettings();
  const options = await paymentOptions(paymentMarket(request.headers), settings.frenzAiPlans);
  return NextResponse.json(options, { headers: { "cache-control": "private, no-store" } });
}
