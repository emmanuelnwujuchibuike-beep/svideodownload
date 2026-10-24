import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { commissionUsdCents, needsMarketRate } from "./affiliate-fx";

const row = (amount_minor: number, currency: string, fx_minor_per_usd: number | null = null) => ({ amount_minor, currency, fx_minor_per_usd });

describe("commissionUsdCents (Rewards v2 affiliate share)", () => {
  it("USD is taken as is, even when a rate is pinned (ads store USD with the provider's rate)", () => {
    expect(commissionUsdCents(row(2000, "USD"), null)).toBe(2000);
    expect(commissionUsdCents(row(2000, "usd", 150_000), 9999)).toBe(2000);
  });

  it("the rate pinned at checkout wins over the market", () => {
    // ₦30,000.00 at ₦1,500/$ = $20.00
    expect(commissionUsdCents(row(3_000_000, "NGN", 150_000), 1)).toBe(2000);
  });

  it("the market rate (units per $1) only when nothing is pinned", () => {
    expect(commissionUsdCents(row(3_000_000, "NGN"), 1500)).toBe(2000);
  });

  it("rounds down, never pays a fraction of a cent", () => {
    expect(commissionUsdCents(row(100, "NGN", 150_000), null)).toBe(0);
    expect(commissionUsdCents(row(3_000_149, "NGN"), 1500)).toBe(2000);
  });

  it("no rate at all is null (stays queued), never a guess", () => {
    expect(commissionUsdCents(row(3_000_000, "NGN"), null)).toBeNull();
    expect(commissionUsdCents(row(3_000_000, "NGN", 0), 0)).toBeNull();
    expect(commissionUsdCents(row(0, "USD"), null)).toBeNull();
  });

  it("asks for a market rate only when it must", () => {
    expect(needsMarketRate(row(1, "USD"))).toBe(false);
    expect(needsMarketRate(row(1, "NGN", 150_000))).toBe(false);
    expect(needsMarketRate(row(1, "NGN"))).toBe(true);
  });
});

describe("the 10-minute cron runs both Rewards v2 sweeps", () => {
  const cron = readFileSync(join(process.cwd(), "app/api/cron/ai-reconcile/route.ts"), "utf8");
  const sweeps = readFileSync(join(process.cwd(), "lib/rewards/v2-sweeps.ts"), "utf8");

  it("each is called, fails open, and is reported", () => {
    for (const fn of ["sweepFollowerMilestones", "sweepAffiliateCommissions"]) {
      expect(cron).toContain(`${fn}().catch(`);
    }
    expect(cron).toMatch(/followerMilestones, affiliateCommissions[,\s}]/);
  });

  it("pushes only after the database granted, and the commission is converted before the grant", () => {
    expect(sweeps.indexOf('rpc("sweep_follower_milestones"')).toBeLessThan(sweeps.indexOf("await pushRewards(granted)"));
    expect(sweeps.indexOf("commissionUsdCents(row")).toBeLessThan(sweeps.indexOf('rpc("grant_affiliate_commission"'));
    expect(sweeps).toContain("p_credits_per_usd: creditsPerUsd");
  });
});
