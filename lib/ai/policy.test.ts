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
 * The Frenz AI access rules, as the owner wrote them.
 *
 * These tests exist because the numbers are a PRODUCT decision that has moved
 * three times, and each move was meant to be a data edit. A test per row is
 * what makes the next move visible rather than silent.
 *
 * 2026-09-13: AI Clean and its table are gone. Character Replace is paid from
 * the balance on every plan, so its table is all zeros with `paidOnly` — and
 * the platform rules that were about FREE allowances (the operator switches,
 * the counter a member reads) are pinned against a tool that still has one:
 * an unlisted feature on the default table.
 */

const CR = "ai_character_replace" as const;
/** A feature with no table of its own — the default rows, which carry a free allowance. */
const FREE_TOOL = "ai_upscale" as const;

describe("Character Replace is paid-only, on every plan", () => {
  it("has a zero daily allowance for every audience", () => {
    for (const a of AI_AUDIENCES) {
      const p = policyFor(a, CR);
      expect(p.dailyLimit, a).toBe(0);
      expect(p.paidOnly, a).toBe(true);
      expect(p.unlimited, a).toBe(false);
      expect(p.maxConcurrent, a).toBeGreaterThan(0);
    }
  });

  it("is offered to every signed-in plan and NOT to a guest", () => {
    for (const a of ["free", "pro", "business", "max_ai"] as const) expect(featureOfferedTo(a, CR), a).toBe(true);
    expect(featureOfferedTo("guest", CR)).toBe(false);
  });

  it("🔴 a zero allowance does not read as 'spent': the paid tool can start", () => {
    for (const a of ["free", "pro", "business", "max_ai"] as const) {
      const view = entitlementView({ audience: a, policy: policyFor(a, CR), usedToday: 0 });
      expect(view.paidOnly, a).toBe(true);
      expect(view.canStart, a).toBe(true);
      expect(view.dailyLimit, a).toBe(0);
      expect(view.remainingToday, a).toBe(0);
    }
  });

  it("🔴 the operator's free-credit fields never touch it", () => {
    for (const a of AI_AUDIENCES) {
      const original = policyFor(a, CR);
      const configured = applyConfiguredLimits(original, a, {
        freeDailyCredits: 999,
        freeEnabled: true,
        proDailyCredits: 50,
        businessDailyCredits: 50,
      });
      // "2 free a day" applied to a tool whose every run costs GPU money
      // would be the bill the zero exists to prevent.
      expect(configured, a).toEqual(original);
    }
  });

  it("the tool's own switch turns it off for everybody", () => {
    for (const a of ["free", "pro", "business", "max_ai"] as const) {
      const off = applyConfiguredLimits(policyFor(a, CR), a, { toolEnabled: false });
      expect(off.offered, a).toBe(false);
      const view = entitlementView({ audience: a, policy: off, usedToday: 0 });
      expect(view.canStart, a).toBe(false);
      expect(view.offered, a).toBe(false);
    }
    const on = applyConfiguredLimits(policyFor("free", CR), "free", { toolEnabled: true });
    expect(on).toEqual(policyFor("free", CR));
  });
});

describe("🔴 no rewarded ad, for anyone (standing rule §6, 2026-09-09)", () => {
  /*
    "Do not use reward ads for AI access. Remove all reward-ad AI logic."

    This block once asserted the OPPOSITE for guest and free — an ad per
    generation — and that assertion was the shape of the bug the owner
    reported on 2026-09-13 as "stuck at queued 58%": the browser opened an ad
    gate the reward network never filled, and `/start` was never called. The
    reward module and its route were deleted the same day; this is what keeps
    them from coming back by data.
  */
  it("owes no ad on any audience, on the paid tool or the default table", () => {
    for (const feature of [CR, FREE_TOOL] as const) {
      for (const a of AI_AUDIENCES) {
        const p = policyFor(a, feature);
        expect(p.requiresReward, `${feature}/${a}`).toBe(false);
        expect(p.rewardsPerJob, `${feature}/${a}`).toBe(0);
        const view = entitlementView({ audience: a, policy: p, usedToday: 0 });
        expect(view.rewardRequired, `${feature}/${a}`).toBe(false);
      }
    }
  });

  it("🔴 never asks for an ad that cannot buy anything", () => {
    const spent = entitlementView({ audience: "free", policy: policyFor("free", FREE_TOOL), usedToday: 99 });
    expect(spent.canStart).toBe(false);
    expect(spent.rewardRequired).toBe(false);
    expect(spent.rewardsPerJob).toBe(0);
  });
});

describe("the counter a member reads (free-allowance tools)", () => {
  it("counts down across a day", () => {
    const p = policyFor("free", FREE_TOOL);
    const limit = p.dailyLimit;
    expect(limit).toBeGreaterThan(0);
    const fresh = entitlementView({ audience: "free", policy: p, usedToday: 0 });
    expect(fresh).toMatchObject({ dailyLimit: limit, usedToday: 0, remainingToday: limit, canStart: true, paidOnly: false });
    const done = entitlementView({ audience: "free", policy: p, usedToday: limit });
    expect(done).toMatchObject({ usedToday: limit, remainingToday: 0, canStart: false });
  });

  it("never reports a negative remaining, even if the counter overshoots", () => {
    const view = entitlementView({ audience: "free", policy: policyFor("free", FREE_TOOL), usedToday: 99 });
    expect(view.remainingToday).toBe(0);
    expect(view.canStart).toBe(false);
  });

  it("exposes only the allow-listed fields — never the policy object", () => {
    const view = entitlementView({ audience: "pro", policy: policyFor("pro", CR), usedToday: 3 });
    expect(Object.keys(view).sort()).toEqual(
      [
        "audience",
        "canStart",
        "dailyLimit",
        "gpuAccelerated",
        "gpuOffered",
        "briaOffered",
        "modelTier",
        "offered",
        // 2026-09-13: whether this tool is funded at checkout rather than
        // from a counter. A boolean, not a rate.
        "paidOnly",
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

describe("🔴 §9 — a future AI tool must NOT inherit another tool's limits", () => {
  it("gives an unlisted feature its own numbers", () => {
    const paid = policyFor("max_ai", CR);
    const other = policyFor("max_ai", FREE_TOOL);
    expect(other.dailyLimit).not.toBe(paid.dailyLimit);
    expect(other.paidOnly).toBeUndefined();
  });

  it("does not silently offer an unbuilt tool to guests", () => {
    // A tool nobody has costed should not be free to anonymous visitors the
    // moment its id appears in the registry.
    expect(featureOfferedTo("guest", "ai_generate")).toBe(false);
  });

  it("does not make an unlisted tool require an ad it has no flow for", () => {
    expect(policyFor("free", "ai_caption").requiresReward).toBe(false);
  });
});

describe("🔴 §8 — Max AI's 15 AI credits stay a separate system", () => {
  it("keeps the credit figure out of the job policy entirely", () => {
    // The credits are a Redis counter (lib/ai/quota.ts); the runs are a
    // Postgres row keyed by feature. Spending one cannot move the other.
    expect(FRENZ_AI_DAILY_CREDITS.max_ai).toBe(15);
    expect(policyFor("max_ai", CR).dailyLimit).not.toBe(FRENZ_AI_DAILY_CREDITS.max_ai);
    expect(policyFor("max_ai", FREE_TOOL).dailyLimit).not.toBe(FRENZ_AI_DAILY_CREDITS.max_ai);
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
    for (const bad of ["max-ai", "MAX_AI", "enterprise", "", null, undefined, 7, {}]) {
      expect(audienceFromPlan(bad as never)).toBe("free");
    }
  });

  it("never lets a plan string claim to be a guest", () => {
    expect(audienceFromPlan("guest")).toBe("free");
  });
});

describe("the operator switches (free-allowance tools)", () => {
  const free = () => policyFor("free", FREE_TOOL);

  it("lets an operator set the guest and free allowance", () => {
    for (const a of ["guest", "free"] as const) {
      const p = applyConfiguredLimits(policyFor(a, FREE_TOOL), a, { freeDailyCredits: 5 });
      expect(p.dailyLimit).toBe(5);
    }
  });

  it("🔴 never lets a FREE-credit number touch a PAID plan", () => {
    for (const a of ["pro", "business", "max_ai"] as const) {
      const original = policyFor(a, FREE_TOOL);
      const configured = applyConfiguredLimits(original, a, { freeDailyCredits: 999, freeEnabled: false });
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
      expect(applyConfiguredLimits(free(), "free", { freeDailyCredits: bad }).dailyLimit).toBe(free().dailyLimit);
    }
  });

  it("floors a fractional value rather than admitting half a job", () => {
    expect(applyConfiguredLimits(free(), "free", { freeDailyCredits: 3.9 }).dailyLimit).toBe(3);
  });

  it("leaves everything alone when nothing is configured", () => {
    expect(applyConfiguredLimits(free(), "free", {})).toEqual(free());
  });
});

describe("the shape a future rewarded flow would need — kept as data, never wired", () => {
  it("expresses the ad requirement as a COUNT, not a boolean the flow branches on", () => {
    const p: AiPlanPolicy = policyFor("pro", CR);
    expect(typeof p.rewardsPerJob).toBe("number");
  });

  it("keeps requiresReward and rewardsPerJob consistent", () => {
    for (const a of AI_AUDIENCES) {
      const p = policyFor(a as AiAudience, CR);
      expect(p.requiresReward).toBe(p.rewardsPerJob > 0);
    }
  });
});
