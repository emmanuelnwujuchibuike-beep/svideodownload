import { describe, expect, it } from "vitest";

import { applyConfiguredLimits, policyFor } from "@/lib/ai/policy";
import {
  DEFAULT_LANDING,
  FRENZ_AI_MAX_PAID_CREDITS,
  FRENZ_AI_MIN_PAID_CREDITS,
  normalizePaidCredits,
} from "@/lib/landing/settings";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  OPERATOR-SETTABLE PAID CAPS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "those cap shouldn't be displayed cause it can be changed
 * from the admin at anytime, pro and business cap should be able to change in
 * admin dashboard, if is not set yet set it up."
 *
 * `applyConfiguredLimits` used to refuse this outright, and its comment gave
 * the reason: "an operator lowering Pro to 1/day by mistake would be a silent
 * breach of a subscription, and raising Business to 500 would be a provider
 * bill nobody approved."
 *
 * 🔴 Those risks did not go away when the field arrived — they moved into the
 * BOUNDS, and these tests are what hold them there. Every one of them is about
 * a way a paying member could quietly be given less than they bought.
 */

describe("the shipped defaults match the policy that actually applies", () => {
  /*
    ── 🔴 THE MISTAKE THIS TEST EXISTS FOR, MADE ON THE FIRST ATTEMPT ─────────

    lib/ai/policy.ts has two tables: `DEFAULT_BY_AUDIENCE` (pro 10, business 25)
    is the fallback for a feature with no policy of its own, and `AI_CLEAN`
    (pro 5, business 15) is the one `policyFor` actually prefers.

    The defaults were written from the FALLBACK. Nothing would have failed: the
    admin form would simply have opened showing 10 and 25 for a feature that
    gives 5 and 15, and an operator saving the form without touching it would
    have doubled both allowances — and the provider bill — by accident.
  */
  it("pro and business defaults equal AI Clean's own policy", () => {
    expect(DEFAULT_LANDING.frenzAiProDailyCredits).toBe(policyFor("pro", "ai_clean").dailyLimit);
    expect(DEFAULT_LANDING.frenzAiBusinessDailyCredits).toBe(
      policyFor("business", "ai_clean").dailyLimit,
    );
  });

  it("a default is itself within the bounds the form enforces", () => {
    for (const n of [
      DEFAULT_LANDING.frenzAiProDailyCredits,
      DEFAULT_LANDING.frenzAiBusinessDailyCredits,
    ]) {
      expect(n).toBeGreaterThanOrEqual(FRENZ_AI_MIN_PAID_CREDITS);
      expect(n).toBeLessThanOrEqual(FRENZ_AI_MAX_PAID_CREDITS);
    }
  });

  /*
    ── 🔴 THE FLOOR DOES NOT OUTRANK THE OWNER ───────────────────────────────

    This test used to assert the opposite: `FRENZ_AI_MIN_PAID_CREDITS >
    frenzAiFreeDailyCredits`, on my own reasoning that "a paid plan may never
    give less than the free one".

    Owner, 2026-09-09: "i tried setting the limit for pro daily to 2 and
    business to 5 but it showed number must be equal to."

    Those are the values they want, and the standing Frenz AI rule they wrote
    says a subscription buys no AI at all — so a Pro allowance equal to the free
    one is that rule, not a slip. The floor's remaining job is only to keep the
    value POSITIVE, because 0 is read as "not configured" by both
    `normalizePaidCredits` and `applyConfiguredLimits`.
  */
  it("the floor only excludes zero and below", () => {
    expect(FRENZ_AI_MIN_PAID_CREDITS).toBe(1);
  });

  /*
    🔴 THE EXACT VALUES THE SAVE REFUSED. A regression here is not a cosmetic
    validation message: the admin panel POSTs every AI setting in one request,
    so one out-of-range field refuses the weekly allowance, the price, the
    currency and the minimum deposit along with it.
  */
  it("accepts the pro and business caps the owner asked for", () => {
    for (const n of [2, 5]) {
      expect(normalizePaidCredits(n, 99), String(n)).toBe(n);
    }
  });
});

describe("applyConfiguredLimits — paid audiences", () => {
  const pro = policyFor("pro", "ai_clean");
  const business = policyFor("business", "ai_clean");

  it("applies a configured pro cap", () => {
    expect(applyConfiguredLimits(pro, "pro", { proDailyCredits: 12 }).dailyLimit).toBe(12);
  });

  it("applies a configured business cap", () => {
    expect(
      applyConfiguredLimits(business, "business", { businessDailyCredits: 40 }).dailyLimit,
    ).toBe(40);
  });

  it("does not let one plan's setting reach the other", () => {
    expect(applyConfiguredLimits(pro, "pro", { businessDailyCredits: 40 }).dailyLimit).toBe(
      pro.dailyLimit,
    );
    expect(applyConfiguredLimits(business, "business", { proDailyCredits: 12 }).dailyLimit).toBe(
      business.dailyLimit,
    );
  });

  /*
    ── 🔴 THE FAILURE MODE THAT MATTERS MOST ─────────────────────────────────

    A settings row that has never been saved, a read that failed, a field that
    is not in the stored JSON yet — all of these arrive as `undefined`, and all
    of them must leave a paying member with exactly what the code says they get.
    Falling through to 0 would lock every subscriber out of a feature they are
    paying for, and it would look like a working deploy.
  */
  it("leaves the shipped policy alone when nothing is configured", () => {
    expect(applyConfiguredLimits(pro, "pro", {}).dailyLimit).toBe(pro.dailyLimit);
    expect(applyConfiguredLimits(pro, "pro").dailyLimit).toBe(pro.dailyLimit);
    expect(applyConfiguredLimits(business, "business", {}).dailyLimit).toBe(business.dailyLimit);
  });

  it("ignores a malformed or zero value rather than acting on it", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(applyConfiguredLimits(pro, "pro", { proDailyCredits: bad }).dailyLimit, String(bad)).toBe(
        pro.dailyLimit,
      );
    }
  });

  it("changes nothing else about the plan", () => {
    const out = applyConfiguredLimits(pro, "pro", { proDailyCredits: 12 });
    expect(out.maxConcurrent).toBe(pro.maxConcurrent);
    expect(out.requiresReward).toBe(pro.requiresReward);
    expect(out.unlimited).toBe(pro.unlimited);
  });

  /*
    🔴 The free fields must not touch a paid plan. `freeEnabled: false` is how
    an operator switches the FREE tier off; if it reached this branch it would
    take every paying subscriber's access with it.
  */
  it("does not let the free switch disable a paid plan", () => {
    const out = applyConfiguredLimits(pro, "pro", { freeEnabled: false, freeDailyCredits: 0 });
    expect(out.dailyLimit).toBe(pro.dailyLimit);
    expect(out.offered).not.toBe(false);
  });

  it("still leaves guest and free to the existing free-tier rules", () => {
    const free = policyFor("free", "ai_clean");
    expect(applyConfiguredLimits(free, "free", { freeDailyCredits: 7 }).dailyLimit).toBe(7);
    // A paid field must be inert on a free member.
    expect(applyConfiguredLimits(free, "free", { proDailyCredits: 99 }).dailyLimit).toBe(
      free.dailyLimit,
    );
  });
});

describe("normalizePaidCredits", () => {
  const fallback = 5;

  it("clamps to the floor and the ceiling", () => {
    expect(normalizePaidCredits(1, fallback)).toBe(FRENZ_AI_MIN_PAID_CREDITS);
    expect(normalizePaidCredits(99_999, fallback)).toBe(FRENZ_AI_MAX_PAID_CREDITS);
  });

  it("keeps a sensible value as it is, and floors a fraction", () => {
    expect(normalizePaidCredits(12, fallback)).toBe(12);
    expect(normalizePaidCredits(12.9, fallback)).toBe(12);
  });

  /*
    🔴 A malformed value falls back to the SHIPPED DEFAULT, never to the floor
    and never to zero. Taking an allowance away from somebody who paid for it,
    because a JSON field was a string, is the worst outcome available here.
  */
  it("falls back to the default rather than the floor when the value is junk", () => {
    for (const bad of [undefined, null, "", "abc", {}, []]) {
      expect(normalizePaidCredits(bad, fallback), JSON.stringify(bad)).toBe(fallback);
    }
  });

  it("accepts a numeric string, because a form field sends one", () => {
    expect(normalizePaidCredits("12", fallback)).toBe(12);
  });
});
