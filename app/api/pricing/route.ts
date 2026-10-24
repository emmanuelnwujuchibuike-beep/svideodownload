import { NextResponse } from "next/server";

import { getPricing } from "@/lib/monetization/pricing";

export const runtime = "nodejs";
export const revalidate = 300;

/**
 * GET /api/pricing — the Pro and Business DISPLAY prices (Admin → Pricing), for the small upgrade prompts that show a
 * price (the result card's Pro banner, 2026-10-24). Public, the same strings /pricing renders; cached at the edge for
 * five minutes so an admin price change reaches them quickly. Never an amount a checkout trusts.
 */
export async function GET() {
  const p = await getPricing();
  return NextResponse.json(
    { pro: { price: p.pro.price, period: p.pro.period }, business: { price: p.business.price, period: p.business.period } },
    { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=3600" } },
  );
}
