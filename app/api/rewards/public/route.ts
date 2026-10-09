import { NextResponse } from "next/server";

import { getLandingSettings } from "@/lib/landing/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rewards/public — the referral amounts and withdrawal rules anyone
 * may read (the referral banner after a download shows them to guests too).
 * Amounts and thresholds only. Asked once per browser session (the banner keeps
 * the answer in sessionStorage), only when the banner is about to show.
 * CDN-cached for 5 minutes (Part 9): it is the same for every visitor.
 *
 * 2026-10-07: the referral amounts per event (owner: "sign in 2 credits, top
 * up 10 credits, subscribe 10 credits") so the banner can say each one.
 */
export async function GET() {
  const rules = (await getLandingSettings()).frenzRewards;
  const ref = (k: keyof typeof rules.events) => (rules.events[k].enabled ? rules.events[k].referrerCredits : 0);
  const referrer = Object.values(rules.events).filter((r) => r.enabled && r.referrerCredits > 0).map((r) => r.referrerCredits);
  return NextResponse.json(
    {
      enabled: rules.enabled && referrer.length > 0,
      referralCredits: referrer.length ? Math.max(...referrer) : 0,
      referral: { signup: ref("account_created"), topup: ref("wallet_topup"), subscribe: ref("subscription_started") },
      qualification: rules.qualification,
      withdrawals: rules.withdrawals.enabled ? { creditsPerUsd: rules.withdrawals.creditsPerUsd, minCredits: rules.withdrawals.minCredits } : null,
    },
    // Part 9 (2026-10-09): the same answer for everyone (global settings, the request is
    // not read), so the CDN serves it for 5 minutes. A changed amount shows within one bucket.
    { headers: { "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60" } },
  );
}
