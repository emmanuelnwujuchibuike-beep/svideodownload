import { describe, expect, it } from "vitest";

import { AI_AUDIENCES, audienceFromPlan, isConfigurableAudience, type AiAudience } from "./audience";
import {
  applyConfiguredLimits,
  entitlementView,
  featureOfferedTo,
  policyFor,
  type AiPlanPolicy,
} from "./policy";
import { FRENZ_AI_DAILY_CREDITS } from "./quota";

/**
 * The Video Text Remover access rules, as the owner wrote them (2026-09-08).
 *
 * These tests exist because the numbers are a PRODUCT decision that has already
 * moved twice, and each move was meant to be a data edit. A test per row is what
 * makes the next move visible rather than silent.
 */

const CLEAN = "ai_clean" as const;

describe("the daily limits, exactly as briefed", () => {
  it.each([
    ["guest", 2],
    ["free", 2],
    ["pro", 5],
    ["business", 15],
    ["max_ai", 30],
  ] as const)("%s gets %i AI Clean runs a day", (audience, limit) => {
    expect(policyFor(audience, CLEAN).dailyLimit).toBe(limit);
  });

  it("🔴 gives a guest the SAME allowance as a free member", () => {
    /*
      Not a coincidence and not tidiness. If guests got more, signing up would
      be a downgrade; if they got fewer, "sign up for more" plus the sign-up
      fold would let somebody bank both. Identical is the only number that makes
      the reconciliation rule in migration 0145 airtight.
    */
    expect(policyFor("guest", CLEAN).dailyLimit).toBe(policyFor("free", CLEAN).dailyLimit);
  });

  it("meters EVERY audience — nothing is uncapped any more", () => {
    for (const a of AI_AUDIENCES) {
      const p = policyFor(a, CLEAN);
      expect(p.unlimited).toBe(false);
      expect(p.dailyLimit).toBeGreaterThan(0);
      expect(p.maxConcurrent).toBeGreaterThan(0);
    }
  });
});

describe("the rewarded ad, and who owes how many", () => {
  it("charges guest and free an ad PER GENERATION", () => {
    for (const a of ["guest", "free"] as const) {
      const p = policyFor(a, CLEAN);
      expect(p.requiresReward).toBe(true);
      expect(p.rewardScope).toBe("job");
      expect(p.rewardsPerJob).toBe(1);
    }
  });

  it("🔴 shows NO ad at all to anyone who pays (owner, 2026-09-08)", () => {
    /*
      "pro and business plan wont show any reward ad during ai generation, only
       the free — the pro and business and max ai only use the limit and credit."

      This REPLACED a day-scoped ad. A subscription is itself the exchange, and
      one ad a day is still one more than none.
    */
    for (const a of ["pro", "business", "max_ai"] as const) {
      const p = policyFor(a, CLEAN);
      expect(p.requiresReward).toBe(false);
      expect(p.rewardsPerJob).toBe(0);

      const view = entitlementView({ audience: a, policy: p, usedToday: 0 });
      expect(view.rewardRequired).toBe(false);
      // …and they start immediately. "No ad" is not the same as "no run".
      expect(view.canStart).toBe(true);
    }
  });

  it("keeps ads for the tiers that pay nothing", () => {
    // Guest and free are the only audiences that cost provider money without
    // returning a subscription, so they are the only ones an ad applies to.
    for (const a of ["guest", "free"] as const) {
      expect(policyFor(a, CLEAN).requiresReward).toBe(true);
    }
  });

  it("🔴 never asks for an ad that cannot buy anything", () => {
    // Spent. An ad here would take somebody's attention for nothing, which is
    // the worst thing this screen could do.
    const spent = entitlementView({
      audience: "free",
      policy: policyFor("free", CLEAN),
      usedToday: 2,
    });
    expect(spent.canStart).toBe(false);
    expect(spent.rewardRequired).toBe(false);
    expect(spent.rewardsPerJob).toBe(0);
  });
});

describe("the counter a member reads", () => {
  it("counts down across a guest's day", () => {
    const p = policyFor("guest", CLEAN);
    const fresh = entitlementView({ audience: "guest", policy: p, usedToday: 0 });
    expect(fresh).toMatchObject({ dailyLimit: 2, usedToday: 0, remainingToday: 2, canStart: true });

    const one = entitlementView({ audience: "guest", policy: p, usedToday: 1 });
    expect(one).toMatchObject({ usedToday: 1, remainingToday: 1, canStart: true });

    const done = entitlementView({ audience: "guest", policy: p, usedToday: 2 });
    expect(done).toMatchObject({ usedToday: 2, remainingToday: 0, canStart: false });
  });

  it("never reports a negative remaining, even if the counter overshoots", () => {
    const view = entitlementView({ audience: "free", policy: policyFor("free", CLEAN), usedToday: 99 });
    expect(view.remainingToday).toBe(0);
    expect(view.canStart).toBe(false);
  });

  it("exposes only the allow-listed fields — never the policy object", () => {
    const view = entitlementView({ audience: "pro", policy: policyFor("pro", CLEAN), usedToday: 3 });
    expect(Object.keys(view).sort()).toEqual(
      [
        "audience",
        "canStart",
        "dailyLimit",
        "offered",
        "remainingToday",
        "rewardRequired",
        "rewardScope",
        "rewardUnlocked",
        "rewardsPerJob",
        "unlimited",
        "usedToday",
      ].sort(),
    );
    // Nothing about concurrency or abuse thresholds reaches a browser.
    expect(view).not.toHaveProperty("maxConcurrent");
  });
});

describe("🔴 §9 — a future AI tool must NOT inherit AI Clean's limits", () => {
  it("gives an unlisted feature its own numbers", () => {
    const clean = policyFor("max_ai", CLEAN);
    const other = policyFor("max_ai", "ai_upscale");
    expect(other.dailyLimit).not.toBe(clean.dailyLimit);
  });

  it("does not silently offer an unbuilt tool to guests", () => {
    // A tool nobody has costed should not be free to anonymous visitors the
    // moment its id appears in the registry.
    expect(featureOfferedTo("guest", "ai_generate")).toBe(false);
    expect(featureOfferedTo("guest", CLEAN)).toBe(true);
  });

  it("does not make an unlisted tool require an ad it has no flow for", () => {
    expect(policyFor("free", "ai_caption").requiresReward).toBe(false);
  });
});

describe("🔴 §8 — Max AI's 15 AI credits stay separate from its 30 runs", () => {
  it("keeps the two numbers different, in different systems", () => {
    // The credits are a Redis counter (lib/ai/quota.ts); the runs are a Postgres
    // row keyed by feature. Spending one cannot move the other — this asserts
    // they were never conflated into one figure.
    expect(policyFor("max_ai", CLEAN).dailyLimit).toBe(30);
    expect(FRENZ_AI_DAILY_CREDITS.max_ai).toBe(15);
    expect(policyFor("max_ai", CLEAN).dailyLimit).not.toBe(FRENZ_AI_DAILY_CREDITS.max_ai);
  });

  it("🔴 caps Video Text Remover at 30 regardless of the credit figure", () => {
    // The brief's sharpest line: "The existing 15 AI credits must NEVER allow
    // Max AI to exceed 30 generations per day." The cap is not derived from the
    // credits, so no credit value can raise it.
    const view = entitlementView({
      audience: "max_ai",
      policy: policyFor("max_ai", CLEAN),
      usedToday: 30,
    });
    expect(view.canStart).toBe(false);
  });
});

describe("audience resolution", () => {
  it("maps the real plans", () => {
    expect(audienceFromPlan("free")).toBe("free");
    expect(audienceFromPlan("pro")).toBe("pro");
    expect(audienceFromPlan("business")).toBe("business");
    expect(audienceFromPlan("max_ai")).toBe("max_ai");
  });

  it("🔴 falls to FREE for anything it does not recognise, never to the top tier", () => {
    // A typo, a hand-edited row, or a plan from a newer deploy. The safe
    // reading of all three is the smallest allowance.
    for (const bad of ["max-ai", "MAX_AI", "enterprise", "", null, undefined, 7, {}]) {
      expect(audienceFromPlan(bad as never)).toBe("free");
    }
  });

  it("never lets a plan string claim to be a guest", () => {
    expect(audienceFromPlan("guest")).toBe("free");
  });
});

describe("the operator switches", () => {
  const free = () => policyFor("free", CLEAN);

  it("lets an operator set the guest and free allowance", () => {
    for (const a of ["guest", "free"] as const) {
      const p = applyConfiguredLimits(policyFor(a, CLEAN), a, { freeDailyCredits: 5 });
      expect(p.dailyLimit).toBe(5);
    }
  });

  it("🔴 never lets a configured number touch a PAID plan", () => {
    for (const a of ["pro", "business", "max_ai"] as const) {
      const original = policyFor(a, CLEAN);
      const configured = applyConfiguredLimits(original, a, {
        freeDailyCredits: 999,
        freeEnabled: false,
      });
      // Somebody is paying for this number. An operator lowering it by accident
      // is a silent breach; raising it is an unapproved provider bill.
      expect(configured).toEqual(original);
    }
  });

  it("only guest and free are configurable at all", () => {
    const configurable = AI_AUDIENCES.filter(isConfigurableAudience);
    expect(configurable).toEqual(["guest", "free"]);
  });

  it('says "not for your plan", which is NOT the same as "you spent it"', () => {
    const off = applyConfiguredLimits(free(), "free", { freeEnabled: false });
    expect(off.offered).toBe(false);
    expect(off.dailyLimit).toBe(0);
    // 🔴 And it must not ask for an ad for a tier that cannot run anything.
    expect(off.requiresReward).toBe(false);

    const view = entitlementView({ audience: "free", policy: off, usedToday: 0 });
    expect(view.offered).toBe(false);
    expect(view.canStart).toBe(false);
    expect(view.rewardRequired).toBe(false);
  });

  it("the switch beats the number, whatever the number says", () => {
    const off = applyConfiguredLimits(free(), "free", { freeDailyCredits: 20, freeEnabled: false });
    expect(off.dailyLimit).toBe(0);
    expect(off.offered).toBe(false);
  });

  it("ignores a value that is not a usable number", () => {
    for (const bad of [NaN, Infinity, undefined, "3" as unknown as number]) {
      expect(applyConfiguredLimits(free(), "free", { freeDailyCredits: bad }).dailyLimit).toBe(2);
    }
  });

  it("floors a fractional value rather than admitting half a job", () => {
    expect(applyConfiguredLimits(free(), "free", { freeDailyCredits: 3.9 }).dailyLimit).toBe(3);
  });

  it("leaves everything alone when nothing is configured", () => {
    expect(applyConfiguredLimits(free(), "free", {})).toEqual(free());
  });
});

describe("the shape Part 10 will need", () => {
  it("expresses the ad requirement as a COUNT, not a boolean the flow branches on", () => {
    // The owner has said paid plans move to "up to 3 rewarded ads each
    // generation". That must stay a number change, not a rewrite.
    const p: AiPlanPolicy = policyFor("pro", CLEAN);
    expect(typeof p.rewardsPerJob).toBe("number");
  });

  it("keeps requiresReward and rewardsPerJob consistent", () => {
    for (const a of AI_AUDIENCES) {
      const p = policyFor(a as AiAudience, CLEAN);
      expect(p.requiresReward).toBe(p.rewardsPerJob > 0);
    }
  });
});
