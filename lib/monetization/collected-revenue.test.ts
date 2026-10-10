import { describe, expect, it } from "vitest";

import { aggregateCollected } from "./collected-revenue";

const NOW = Date.parse("2026-10-10T15:00:00Z");
const row = (amount: number, currency: string, purpose: string | null, at: string) => ({ amount_cents: amount, currency, purpose, created_at: at });

describe("collected revenue (owner, 2026-10-10: funding in the total, not just subscribers)", () => {
  it("adds every source into the total, per window", () => {
    const c = aggregateCollected(
      [
        row(1000, "USD", "wallet_topup", "2026-10-10T09:00:00Z"),
        row(2000, "USD", "ad_campaign", "2026-10-08T09:00:00Z"),
        row(500, "USD", "ai_subscription", "2026-09-20T09:00:00Z"),
        row(9000, "USD", "wallet_topup", "2026-01-01T09:00:00Z"),
      ],
      NOW,
    ).currencies.USD!;
    expect(c.today).toMatchObject({ total: 1000, payments: 1 });
    expect(c.d7).toMatchObject({ total: 3000, bySource: { funding: 1000, advertisers: 2000, ai_subscription: 0 } });
    expect(c.d30.total).toBe(3500);
    expect(c.all.total).toBe(12500);
  });

  it("teeth: two currencies are never added together", () => {
    const c = aggregateCollected([row(1000, "USD", "wallet_topup", "2026-10-10T09:00:00Z"), row(50000, "ngn", "wallet_topup", "2026-10-10T09:00:00Z")], NOW);
    expect(Object.keys(c.currencies).sort()).toEqual(["NGN", "USD"]);
    expect(c.currencies.USD!.all.total).toBe(1000);
    expect(c.currencies.NGN!.all.total).toBe(50000);
  });

  it("an unknown or missing purpose counts as credit funding (the column's default)", () => {
    expect(aggregateCollected([row(100, "USD", null, "2026-10-10T09:00:00Z")], NOW).currencies.USD!.all.bySource.funding).toBe(100);
  });
});
