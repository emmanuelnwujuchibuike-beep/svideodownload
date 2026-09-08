import { describe, expect, it } from "vitest";

import { applyConfiguredLimits, entitlementView, policyFor } from "./policy";
import type { BillingPlan } from "@/lib/monetization/types";

/**
 * The plan rules.
 *
 * These are the numbers that decide whether somebody is charged, shown an ad,
 * or refused — so they are pinned rather than trusted to stay right. The last
 * block is the one that matters most: it asserts the SHAPE that lets Part 10
 * change the product with a data edit instead of a rewrite.
 */

const PLANS: BillingPlan[] = ["free", "pro", "business"];

describe("policyFor", () => {
  it("gives free members two a day, with no ad (owner, 2026-09-08)", () => {
    // Changed from "3 behind an ad" the day after Part 5 shipped, because no
    // rewarded ad is running. Two fields on one row — see the module note.
    const free = policyFor("free");
    expect(free.dailyLimit).toBe(2);
    expect(free.unlimited).toBe(false);
    expect(free.requiresReward).toBe(false);
    expect(free.rewardsPerJob).toBe(0);
  });

  it("does not ask paid members for an ad in Part 5", () => {
    for (const plan of ["pro", "business"] as BillingPlan[]) {
      expect(policyFor(plan).requiresReward, plan).toBe(false);
      expect(policyFor(plan).unlimited, plan).toBe(true);
    }
  });

  it("🔴 meters EVERY plan, including the unlimited ones", () => {
    /*
      "Unlimited" is a product statement, not an architectural one. If Pro
      skipped the counter, that code path would stop being exercised and a
      stolen Pro session would have nothing between it and an unbounded
      provider bill. Every plan has a real number.
    */
    for (const plan of PLANS) {
      const policy = policyFor(plan);
      expect(policy.dailyLimit, plan).toBeGreaterThan(0);
      expect(Number.isFinite(policy.dailyLimit), plan).toBe(true);
      expect(policy.maxConcurrent, plan).toBeGreaterThan(0);
    }
  });

  it("treats an unknown plan as free rather than as unlimited", () => {
    // Failing open here would mean a corrupted plan string buying somebody
    // unlimited provider time.
    const unknown = policyFor("enterprise" as BillingPlan);
    expect(unknown.dailyLimit).toBe(2);
    expect(unknown.unlimited).toBe(false);
  });
});

describe("entitlementView", () => {
  const free = policyFor("free");

  it("counts down as a free member spends the day", () => {
    for (const [used, remaining] of [
      [0, 2],
      [1, 1],
      [2, 0],
    ] as const) {
      const view = entitlementView({ plan: "free", policy: free, usedToday: used });
      expect(view.remainingToday, `used ${used}`).toBe(remaining);
      expect(view.canStart, `used ${used}`).toBe(remaining > 0);
    }
  });

  it("🔴 stops asking for an ad once the allowance is gone", () => {
    // Vacuously true while free requires no ad — kept because the rule must
    // still hold the moment `requiresReward` goes back on.
    /*
      THE distinction in the brief: a rewarded ad unlocks a REMAINING session,
      it does not create an extra one. Showing a "Watch Ad" button that cannot
      buy anything is the worst thing this screen could do.
    */
    const spent = entitlementView({ plan: "free", policy: free, usedToday: free.dailyLimit });
    expect(spent.canStart).toBe(false);
    expect(spent.rewardRequired).toBe(false);
    expect(spent.rewardsPerJob).toBe(0);
  });

  it("never reports a negative remaining, even if the counter overshoots", () => {
    const view = entitlementView({ plan: "free", policy: free, usedToday: 9 });
    expect(view.remainingToday).toBe(0);
    expect(view.canStart).toBe(false);
  });

  it("🔴 hides the count from unlimited plans rather than inventing one", () => {
    // "97 left today" would tell a paying member about a restriction they are
    // not under and are not paying for.
    const view = entitlementView({ plan: "pro", policy: policyFor("pro"), usedToday: 3 });
    expect(view.unlimited).toBe(true);
    expect(view.dailyLimit).toBeNull();
    expect(view.remainingToday).toBeNull();
    expect(view.rewardRequired).toBe(false);
    expect(view.canStart).toBe(true);
  });

  it("still refuses an unlimited plan that reached its abuse ceiling", () => {
    const pro = policyFor("pro");
    const view = entitlementView({ plan: "pro", policy: pro, usedToday: pro.dailyLimit });
    expect(view.canStart).toBe(false);
  });

  it("exposes only the allow-listed fields — never the policy object", () => {
    const view = entitlementView({ plan: "free", policy: free, usedToday: 1 });
    expect(Object.keys(view).sort()).toEqual(
      [
        "canStart",
        "dailyLimit",
        "offered",
        "plan",
        "remainingToday",
        "rewardRequired",
        "rewardsPerJob",
        "unlimited",
        "usedToday",
      ].sort(),
    );
    // Nothing about ceilings or another plan's terms leaks into a response.
    expect(JSON.stringify(view)).not.toContain("maxConcurrent");
  });
});

describe("🔴 the shape Part 10 needs", () => {
  /*
    The owner has already said what changes: a new `max_ai` plan with 15 daily
    credits, and `pro`/`business` moving to "up to 3 rewarded ads each
    generation". These assertions do not test Part 10 — they test that Part 10
    is a DATA change to the policy table rather than a rewrite of the
    authorization flow.
  */

  it("expresses the ad requirement as a COUNT, not a boolean the flow branches on", () => {
    // `rewardsPerJob` is why "3 ads per generation" will be a number change and
    // not a new code path: the authorization layer counts rewards.
    for (const plan of PLANS) {
      const policy = policyFor(plan);
      expect(typeof policy.rewardsPerJob, plan).toBe("number");
      expect(policy.rewardsPerJob, plan).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps requiresReward and rewardsPerJob consistent with each other", () => {
    // A plan that requires a reward must cost at least one; a plan that does
    // not must cost none. Part 10 flips both together, on the same row.
    for (const plan of PLANS) {
      const policy = policyFor(plan);
      if (policy.requiresReward) expect(policy.rewardsPerJob, plan).toBeGreaterThanOrEqual(1);
      else expect(policy.rewardsPerJob, plan).toBe(0);
    }
  });

  it("carries a per-plan allowance already, which is what credits will be", () => {
    // 15 daily credits for max_ai is a `dailyLimit` of 15 on a new row.
    expect(policyFor("free").dailyLimit).toBeTypeOf("number");
  });
});

describe("applyConfiguredLimits", () => {
  it("lets an operator set the free allowance", () => {
    // Owner, 2026-09-08: "it should be setable in admin dashboard".
    const configured = applyConfiguredLimits(policyFor("free"), { freeDailyCredits: 5 });
    expect(configured.dailyLimit).toBe(5);
  });

  it("🔴 never lets a configured number touch a paid plan's abuse ceiling", () => {
    // Those are not product knobs. An operator raising one by mistake is how a
    // stolen session becomes an unbounded provider bill.
    const pro = policyFor("pro");
    expect(applyConfiguredLimits(pro, { freeDailyCredits: 9999 })).toEqual(pro);
  });

  it("ignores a value that is not a usable number", () => {
    const free = policyFor("free");
    for (const bad of [undefined, Number.NaN, "3" as unknown as number]) {
      expect(applyConfiguredLimits(free, { freeDailyCredits: bad }), String(bad)).toEqual(free);
    }
  });

  it("accepts zero — an operator may switch the free tier off entirely", () => {
    expect(applyConfiguredLimits(policyFor("free"), { freeDailyCredits: 0 }).dailyLimit).toBe(0);
  });

  it("floors a fractional value rather than admitting half a job", () => {
    expect(applyConfiguredLimits(policyFor("free"), { freeDailyCredits: 2.9 }).dailyLimit).toBe(2);
  });
});

describe("the operator switch", () => {
  it("🔴 says \"not for your plan\", which is NOT the same as \"you spent it\"", () => {
    /*
      Zero credits would render "you have used your 0 free cleans today", which
      is nonsense. The switch is a separate field so the interface can say the
      true thing instead — and so no ad is ever offered for a session that
      cannot exist.
    */
    const off = applyConfiguredLimits(policyFor("free"), { freeEnabled: false });
    const view = entitlementView({ plan: "free", policy: off, usedToday: 0 });
    expect(view.offered).toBe(false);
    expect(view.canStart).toBe(false);
    expect(view.rewardRequired).toBe(false);
  });

  it("beats the credit number, whatever it says", () => {
    const off = applyConfiguredLimits(policyFor("free"), { freeEnabled: false, freeDailyCredits: 9 });
    expect(off.dailyLimit).toBe(0);
    expect(entitlementView({ plan: "free", policy: off, usedToday: 0 }).canStart).toBe(false);
  });

  it("🔴 never switches off a PAID plan", () => {
    // The switch is about the free tier. A paying member losing access because
    // of it would be the operator accidentally cancelling what they sold.
    const pro = applyConfiguredLimits(policyFor("pro"), { freeEnabled: false });
    expect(entitlementView({ plan: "pro", policy: pro, usedToday: 0 }).canStart).toBe(true);
  });

  it("leaves everything alone when the switch is on", () => {
    const on = applyConfiguredLimits(policyFor("free"), { freeEnabled: true, freeDailyCredits: 2 });
    expect(entitlementView({ plan: "free", policy: on, usedToday: 0 }).canStart).toBe(true);
    expect(entitlementView({ plan: "free", policy: on, usedToday: 0 }).offered).toBe(true);
  });
});
