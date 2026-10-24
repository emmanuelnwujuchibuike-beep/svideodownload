import { NextResponse } from "next/server";

import { flushFundingAlerts } from "@/lib/admin/funding-alerts";
import { reconcilePendingAdPayments } from "@/lib/ads-platform/payment-server";
import { expireFlutterwaveSitePlans, reconcileFlutterwaveRenewals } from "@/lib/ai/credits/flutterwave-plans";
import { reconcilePendingPlanAttempts } from "@/lib/ai/credits/plan-attempts";
import { reconcilePendingTopups } from "@/lib/ai/wallet/reconcile-topups";
import { getLandingSettings } from "@/lib/landing/settings";
import { sweepAiJobs } from "@/lib/ai/recovery";
import { awardClosedWeek } from "@/lib/ai/weekly-top";
import { verifyProcessingPayouts } from "@/lib/rewards/paystack-payouts";
import { sweepAffiliateCommissions, sweepFollowerMilestones } from "@/lib/rewards/v2-sweeps";
import { sweepAutoWithdrawals } from "@/lib/sub/payout-account";
import { sweepFanout } from "@/lib/sub/fanout";
import { sweepSubReminders } from "@/lib/sub/reminders";
import { reconcilePendingSubPurchases } from "@/lib/sub/server";
import { sweepPrivacyExpiry } from "@/lib/privacy/center";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One page of live rows and one step each — never a backlog catch-up in one call. */
export const maxDuration = 120;

/**
 * The AI reconciliation sweep (Character Replace Part 5, §13 · §33).
 *
 * Finds the jobs nobody is polling — the member left the app, which is the
 * whole point of this Part — and moves each one step: a due finalization
 * retry is re-dispatched to the worker, a missed webhook is read from the
 * provider, a stalled row is ended and refunded, a pending announcement is
 * sent. Every step is the same idempotent function the live paths use
 * (lib/ai/recovery.ts), so running it beside a webhook changes nothing twice.
 *
 * Authorised exactly like every other cron here (lib/cron/auth.ts). NOT in
 * vercel.json — the Hobby plan's two cron slots are spent; GitHub Actions
 * (`.github/workflows/cron-ai-reconcile.yml`) is the clock, every ten
 * minutes, the same pattern as cron-ai-retention.
 */
async function run(request: Request) {
  if (!(await cronAuthorized(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // 2026-10-09: ad payments whose provider webhook never arrived are confirmed every 10 minutes too
  // 2026-10-12: SUB purchases too — a paid subscription whose webhook never came and whose payer never got past the return page
  /*
    Part 3 (2026-10-23): wallet top-ups (Paystack + Flutterwave, each asked of ITS OWN provider) and AI plan purchases
    whose webhook never came and whose member never came back. Bounded batches with time budgets; every attempt is
    claimed (compare-and-set) before its provider is asked, and settling is idempotent on the reference, so an overlap
    with a webhook, a return page or another run credits once. Aggregate counts only in the response.
  */
  const [ai, adPayments, subPurchases, walletTopups, aiPlanPurchases] = await Promise.all([
    sweepAiJobs(),
    reconcilePendingAdPayments(createAdminClient()).catch((e: unknown) => ({ error: String(e).slice(0, 160) })),
    reconcilePendingSubPurchases().catch((e: unknown) => ({ error: String(e).slice(0, 160) })),
    reconcilePendingTopups({ limit: 20, budgetMs: 45_000 }).catch(() => ({ error: "wallet top-up sweep failed" })),
    getLandingSettings()
      .then((s) => reconcilePendingPlanAttempts(s.frenzAiPlans, { limit: 10, budgetMs: 30_000 }))
      .catch(() => ({ error: "AI plan sweep failed" })),
  ]);
  // 0218: any payment alert a webhook did not send yet; and the weekly AI prizes once a week has closed
  const [fundingAlerts, weeklyAwards, payouts, autoWithdrawals, privacyExpiry, subReminders, subFanout, followerMilestones, affiliateCommissions, sitePlanExpiry, flutterwaveRenewals] = await Promise.all([
    flushFundingAlerts().catch((e: unknown) => ({ error: String(e).slice(0, 160) })),
    awardClosedWeek(createAdminClient()).catch((e: unknown) => ({ error: String(e).slice(0, 160) })),
    // Paystack payouts still processing whose webhook never came
    verifyProcessingPayouts().catch((e: unknown) => ({ error: String(e).slice(0, 160) })),
    // SUB auto-withdrawal: money a hold released, or left after an earlier payout finished
    sweepAutoWithdrawals().catch((e: unknown) => ({ error: String(e).slice(0, 160) })),
    // Part 17: temporary blocks and mutes that ended, and Boundary Modes whose time is up
    sweepPrivacyExpiry().catch((e: unknown) => ({ error: String(e).slice(0, 160) })),
    // Frenz Exclusive Part 5: renewal and expiry reminders for paid subscriptions (once each per period, 0250)
    sweepSubReminders().catch((e: unknown) => ({ error: String(e).slice(0, 160) })),
    // Part 6: announcement and private-post alerts still queued (0251): a few jobs, a few pages each
    sweepFanout().catch((e: unknown) => ({ error: String(e).slice(0, 160) })),
    // Rewards v2 (0255): follower milestones the follow trigger could not pay yet, and queued affiliate shares
    sweepFollowerMilestones().catch((e: unknown) => ({ error: String(e).slice(0, 160) })),
    sweepAffiliateCommissions().catch((e: unknown) => ({ error: String(e).slice(0, 160) })),
    // 2026-10-23: Pro / Business plans on Flutterwave whose paid period (plus grace) ran out with no renewal
    expireFlutterwaveSitePlans().catch(() => ({ error: "site plan expiry failed" })),
    // Part 3.3: Flutterwave renewals a webhook may have missed — listed, re-verified by id, through the one renewal ledger
    reconcileFlutterwaveRenewals({ limit: 10, budgetMs: 20_000 }).catch(() => ({ error: "flutterwave renewal sweep failed" })),
  ]);
  return NextResponse.json({ ...ai, adPayments, subPurchases, walletTopups, aiPlanPurchases, fundingAlerts, weeklyAwards, payouts, autoWithdrawals, privacyExpiry, subReminders, subFanout, followerMilestones, affiliateCommissions, sitePlanExpiry, flutterwaveRenewals });
}

export const GET = run;
export const POST = run;
