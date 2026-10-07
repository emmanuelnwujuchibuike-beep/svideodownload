import { NextResponse } from "next/server";

import { getLandingSettings } from "@/lib/landing/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rewards/public — the referral amounts and withdrawal rules anyone
 * may read (the referral banner after a download shows them to guests too).
 * Amounts and thresholds only. Asked once per browser session (the banner keeps
 * the answer in sessionStorage), only when the
 * banner is about to show. no-store, like every API answer here, so no cache
 * holds a stale amount
 * after the operator changes it (Cloudflare stretches public caching to 2 h).
 */
export async function GET() {
  const rules = (await getLandingSettings()).frenzRewards;
  const referrer = Object.values(rules.events).filter((r) => r.enabled && r.referrerCredits > 0).map((r) => r.referrerCredits);
  return NextResponse.json(
    {
      enabled: rules.enabled && referrer.length > 0,
      referralCredits: referrer.length ? Math.max(...referrer) : 0,
      qualification: rules.qualification,
      withdrawals: rules.withdrawals.enabled ? { creditsPerUsd: rules.withdrawals.creditsPerUsd, minCredits: rules.withdrawals.minCredits } : null,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
