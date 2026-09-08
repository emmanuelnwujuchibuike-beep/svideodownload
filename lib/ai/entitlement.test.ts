import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BillingPlan } from "@/lib/monetization/types";

/**
 * Entitlement, with the subscription helper stubbed.
 *
 * The stub is the point of the test as much as its subject: `getUserPlan` is
 * mocked because this file must NOT have its own opinion about what makes
 * somebody Pro. If a future edit resolved a plan here instead of asking, these
 * tests would keep passing while the product had two answers to the same
 * question — so the mock is also the assertion that only one call is made.
 */

const getUserPlan = vi.fn<(userId: string | null | undefined) => Promise<BillingPlan>>();
vi.mock("@/lib/monetization/plan", () => ({ getUserPlan: (id: string) => getUserPlan(id) }));

const { getUserAIEntitlement, usageForClient } = await import("./entitlement");
const { aiFeature } = await import("./jobs");

const feature = aiFeature("ai_clean")!;

beforeEach(() => {
  getUserPlan.mockReset();
});

describe("getUserAIEntitlement", () => {
  it("gives a free member the owner's three a day, and one at a time", async () => {
    getUserPlan.mockResolvedValue("free");
    const e = await getUserAIEntitlement("u1", feature);
    expect(e).toEqual({
      plan: "free",
      feature: "ai_clean",
      allowed: true,
      dailyLimit: 3,
      unlimited: false,
      maxConcurrent: 1,
      // Part 5: a free clean is unlocked by one rewarded ad.
      requiresReward: true,
      rewardsPerJob: 1,
    });
  });

  it("🔴 Part 5: whether an ad is owed comes from the PLAN, never from a request", async () => {
    /*
      The brief forbids the client asserting `plan`, `skipAd` or `remaining`.
      This is the other half of that: the answer is derived from the plan the
      subscription helper reports, so there is no argument a caller could pass
      that changes it.
    */
    getUserPlan.mockResolvedValue("free");
    expect((await getUserAIEntitlement("u1", feature)).requiresReward).toBe(true);

    getUserPlan.mockResolvedValue("pro");
    expect((await getUserAIEntitlement("u1", feature)).requiresReward).toBe(false);

    getUserPlan.mockResolvedValue("business");
    expect((await getUserAIEntitlement("u1", feature)).requiresReward).toBe(false);
  });

  it("🔴 meters Pro as well, at an abuse ceiling far above any real use", async () => {
    // Pro is not exempt from the counter — a class of member on a different
    // code path is a class of member whose code path is never tested, and the
    // day an account is stolen there is nothing between it and the bill.
    getUserPlan.mockResolvedValue("pro");
    const e = await getUserAIEntitlement("u1", feature);
    expect(e.unlimited).toBe(true);
    expect(e.dailyLimit).toBeGreaterThan(feature.freeDailyJobs * 10);
    expect(e.maxConcurrent).toBeGreaterThan(1);
  });

  it("gives business a higher ceiling than pro", async () => {
    getUserPlan.mockResolvedValue("pro");
    const pro = await getUserAIEntitlement("u1", feature);
    getUserPlan.mockResolvedValue("business");
    const business = await getUserAIEntitlement("u1", feature);
    expect(business.dailyLimit).toBeGreaterThan(pro.dailyLimit);
    expect(business.unlimited).toBe(true);
  });

  it("asks the existing subscription helper, exactly once, with the real user id", async () => {
    getUserPlan.mockResolvedValue("free");
    await getUserAIEntitlement("user-42", feature);
    expect(getUserPlan).toHaveBeenCalledTimes(1);
    expect(getUserPlan).toHaveBeenCalledWith("user-42");
  });
});

describe("usageForClient", () => {
  it("tells a free member the truth about a real cap", async () => {
    getUserPlan.mockResolvedValue("free");
    const e = await getUserAIEntitlement("u1", feature);
    expect(usageForClient(e, 2)).toEqual({
      plan: "free",
      unlimited: false,
      limit: 3,
      used: 2,
      remaining: 1,
    });
  });

  it("never reports a negative remainder", async () => {
    getUserPlan.mockResolvedValue("free");
    const e = await getUserAIEntitlement("u1", feature);
    expect(usageForClient(e, 9).remaining).toBe(0);
  });

  it("🔴 never quotes the abuse ceiling to a paid member", async () => {
    // Showing "97 left today" would invent a restriction Pro is not under, and
    // it would be the only place in the product that suggested one existed.
    getUserPlan.mockResolvedValue("pro");
    const e = await getUserAIEntitlement("u1", feature);
    const view = usageForClient(e, 3);
    expect(view).toEqual({ plan: "pro", unlimited: true, limit: null, used: 3, remaining: null });
    expect(JSON.stringify(view)).not.toContain(String(e.dailyLimit));
  });
});
