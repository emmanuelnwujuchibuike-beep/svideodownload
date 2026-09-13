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

const { getAiEntitlement, usageForClient } = await import("./entitlement");
const { guestSubject, userSubject } = await import("./subject");
const { aiFeature } = await import("./jobs");

const feature = aiFeature("ai_clean")!;
const member = userSubject("u1");
const guest = guestSubject("aaaaaaaaaaaaaaaaaaaaaa");

beforeEach(() => {
  getUserPlan.mockReset();
});

describe("getAiEntitlement", () => {
  it("gives a free member two a day, with no ad, one at a time", async () => {
    getUserPlan.mockResolvedValue("free");
    const e = await getAiEntitlement(member, feature);
    expect(e).toEqual({
      audience: "free",
      feature: "ai_clean",
      allowed: true,
      // With no Supabase in the test env the settings read returns defaults,
      // which is the same 2 the policy table carries.
      dailyLimit: 2,
      unlimited: false,
      maxConcurrent: 1,
      // 🔴 Standing rule §6: no rewarded ad for AI, on any tier. This was
      // `true`, and it is what held every free member's job at "queued".
      requiresReward: false,
      rewardsPerJob: 0,
      rewardScope: "job",
      // 🔴 Null for a member: an office or a campus is not one abuser.
      ipCeiling: null,
    });
  });

  it("gives Pro five a day, and no ad either", async () => {
    getUserPlan.mockResolvedValue("pro");
    const e = await getAiEntitlement(member, feature);
    expect(e.audience).toBe("pro");
    expect(e.dailyLimit).toBe(5);
    expect(e.rewardScope).toBe("day");
    expect(e.ipCeiling).toBeNull();
  });

  it("resolves max_ai to 30 without any billing change", async () => {
    // `getUserPlan` returns whatever string the subscriptions row holds; the AI
    // layer is where it is checked against a real list. Nothing in billing had
    // to learn a new plan for this to work.
    getUserPlan.mockResolvedValue("max_ai" as BillingPlan);
    const e = await getAiEntitlement(member, feature);
    expect(e.audience).toBe("max_ai");
    expect(e.dailyLimit).toBe(30);
  });

  it("🔴 falls to free for an unrecognised plan, never to the top tier", async () => {
    getUserPlan.mockResolvedValue("enterprise" as BillingPlan);
    const e = await getAiEntitlement(member, feature);
    expect(e.audience).toBe("free");
    expect(e.dailyLimit).toBe(2);
  });
});

describe("🔴 a guest never touches the subscription system", () => {
  it("resolves without asking for a plan at all", async () => {
    const e = await getAiEntitlement(guest, feature);
    expect(e.audience).toBe("guest");
    expect(e.dailyLimit).toBe(2);
    expect(e.requiresReward).toBe(false);
    expect(e.rewardScope).toBe("job");
    /*
      There is no account to look up, so there is no lookup. Not just a
      performance point — a guest path that queried `subscriptions` would be
      asking a question with no possible answer, and whatever it did with the
      empty result would eventually be wrong.
    */
    expect(getUserPlan).not.toHaveBeenCalled();
  });

  it("carries an address ceiling, and it is well above one visitor's allowance", async () => {
    const e = await getAiEntitlement(guest, feature);
    expect(e.ipCeiling).not.toBeNull();
    // Carrier-grade NAT means thousands of unrelated people share an address in
    // this product's biggest markets. A ceiling near the per-visitor allowance
    // would break the feature for a whole network to stop one script.
    expect(e.ipCeiling!).toBeGreaterThan(e.dailyLimit * 3);
  });
});

describe("usageForClient", () => {
  it("reports a real count for a capped audience", async () => {
    getUserPlan.mockResolvedValue("pro");
    const e = await getAiEntitlement(member, feature);
    expect(usageForClient(e, 3)).toEqual({
      plan: "pro",
      unlimited: false,
      limit: 5,
      used: 3,
      remaining: 2,
    });
  });

  it("never reports a negative remaining", async () => {
    getUserPlan.mockResolvedValue("free");
    const e = await getAiEntitlement(member, feature);
    expect(usageForClient(e, 99).remaining).toBe(0);
  });
});
