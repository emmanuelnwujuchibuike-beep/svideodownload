import { describe, expect, it } from "vitest";

import {
  AI_MIN_TOPUP_FALLBACK_CENTS,
  aiTopupOptions,
  decideFunding,
  dayStartUtc,
  formatCents,
  freeRemaining,
  isValidTopupCents,
  isoDate,
  weekResetsAt,
  weekStartUtc,
} from "@/lib/ai/economy";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE USAGE ECONOMY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09, as a permanent rule: "Free daily + free weekly allowance
 * → prepaid AI balance."
 *
 * 🔴 These tests are about MONEY and about a limit somebody has an incentive to
 * get around. Both halves are here: the arithmetic that must never drift, and
 * the rule that a daily reset cannot buy back a spent week.
 */

const state = (o: Partial<Parameters<typeof freeRemaining>[0]> = {}) => ({
  usedToday: 0,
  usedThisWeek: 0,
  dailyLimit: 2,
  weeklyLimit: 5,
  balanceCents: 0,
  ...o,
});

describe("freeRemaining — the lower of the two ceilings", () => {
  it("is bounded by the daily limit early in the week", () => {
    expect(freeRemaining(state({ usedToday: 0, usedThisWeek: 0 }))).toBe(2);
    expect(freeRemaining(state({ usedToday: 1, usedThisWeek: 1 }))).toBe(1);
    expect(freeRemaining(state({ usedToday: 2, usedThisWeek: 2 }))).toBe(0);
  });

  /*
    ── 🔴 THE OWNER'S OWN WORKED EXAMPLE ─────────────────────────────────────

    "Monday: 2, Tuesday: 2, Wednesday: 1. The user has reached the weekly free
    allowance. Even if the daily counter resets afterward, the user must not
    receive another free AI generation until the weekly period resets."

    So on Thursday — a fresh day, `usedToday: 0`, daily remaining 2 — the answer
    must still be zero.
  */
  it("does not let a daily reset buy back a spent week", () => {
    const thursday = state({ usedToday: 0, usedThisWeek: 5, dailyLimit: 2, weeklyLimit: 5 });
    expect(freeRemaining(thursday)).toBe(0);
  });

  it("clamps at zero when an operator lowers a limit below what was used", () => {
    // Never negative: a later `> 0` check would read a negative as "none", but
    // arithmetic elsewhere could read it as a credit.
    expect(freeRemaining(state({ usedToday: 9, dailyLimit: 2 }))).toBe(0);
    expect(freeRemaining(state({ usedThisWeek: 99, weeklyLimit: 5 }))).toBe(0);
  });

  it("gives nothing when either limit is zero", () => {
    expect(freeRemaining(state({ dailyLimit: 0 }))).toBe(0);
    expect(freeRemaining(state({ weeklyLimit: 0 }))).toBe(0);
  });
});

describe("decideFunding", () => {
  /*
    🔴 FREE FIRST, ALWAYS. Charging somebody who had a free job available is
    invisible in aggregate and unforgivable individually.
  */
  it("spends the free allowance before the balance", () => {
    const d = decideFunding(state({ balanceCents: 10_000 }), 50);
    expect(d).toEqual({ ok: true, source: "free", priceCents: 0 });
  });

  it("falls to the balance once the free allowance is gone", () => {
    const d = decideFunding(state({ usedToday: 2, usedThisWeek: 2, balanceCents: 1_250 }), 50);
    expect(d).toEqual({ ok: true, source: "balance", priceCents: 50 });
  });

  it("charges exactly the price, never a rounded one", () => {
    const d = decideFunding(state({ usedThisWeek: 5, balanceCents: 50 }), 50);
    expect(d.ok && d.priceCents).toBe(50);
  });

  it("refuses when the balance is one cent short, and says by how much", () => {
    const d = decideFunding(state({ usedThisWeek: 5, balanceCents: 49 }), 50);
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.shortfallCents).toBe(1);
    expect(d.ok === false && d.balanceCents).toBe(49);
  });

  /*
    🔴 NO PLAN, NO AUDIENCE, NO SUBSCRIPTION. The spec explicitly prohibits
    `if subscription === pro => unlimited AI`, and the strongest way to
    guarantee that is a function that is never told who is Pro. This test pins
    the SHAPE, so a future edit that adds a plan argument has to argue with it.
  */
  it("cannot express a subscription exemption, because it takes no plan", () => {
    const src = decideFunding.toString();
    for (const forbidden of ["pro", "business", "plan", "subscription", "unlimited"]) {
      expect(src.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("treats a zero price as still requiring free allowance or balance", () => {
    // A price of 0 with no allowance left is fundable from a zero balance —
    // that is correct, and it is how an operator switches paid usage off.
    expect(decideFunding(state({ usedThisWeek: 5, balanceCents: 0 }), 0)).toEqual({
      ok: true,
      source: "balance",
      priceCents: 0,
    });
  });
});

describe("the weekly boundary", () => {
  /*
    🔴 A FIXED CALENDAR WEEK FROM MONDAY 00:00 UTC, not a rolling seven days.
    A rolling window never resets, so it can never answer "when do I get more?"
    with anything a person can act on.
  */
  it("starts on Monday, whatever day it is asked", () => {
    // 2026-09-09 is a Wednesday.
    const wed = new Date("2026-09-09T17:45:00.000Z");
    expect(weekStartUtc(wed).toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("treats Monday itself as the start of its own week", () => {
    const mon = new Date("2026-09-07T00:00:00.000Z");
    expect(weekStartUtc(mon).toISOString()).toBe("2026-09-07T00:00:00.000Z");
    const monLate = new Date("2026-09-07T23:59:59.000Z");
    expect(weekStartUtc(monLate).toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  /*
    🔴 SUNDAY IS THE END OF THE WEEK, NOT THE START. `getUTCDay()` returns 0 for
    Sunday, so the naive `day - getUTCDay()` puts Sunday at the start of the
    week AFTER the one it belongs to — handing a fresh allowance a day early,
    every week, to anyone who asks on a Sunday.
  */
  it("puts Sunday at the END of its week", () => {
    const sun = new Date("2026-09-13T12:00:00.000Z");
    expect(weekStartUtc(sun).toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("resets exactly seven days after it started", () => {
    const wed = new Date("2026-09-09T17:45:00.000Z");
    expect(weekResetsAt(wed).toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });

  it("crosses a month boundary correctly", () => {
    const tue = new Date("2026-09-01T08:00:00.000Z"); // a Tuesday
    expect(weekStartUtc(tue).toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });
});

describe("dayStartUtc and isoDate", () => {
  it("is midnight UTC, not local midnight", () => {
    const late = new Date("2026-09-09T23:59:59.000Z");
    expect(dayStartUtc(late).toISOString()).toBe("2026-09-09T00:00:00.000Z");
  });

  it("formats the date the way a Postgres DATE column compares", () => {
    expect(isoDate(new Date("2026-09-09T17:45:00.000Z"))).toBe("2026-09-09");
    // Zero-padded on both parts — "2026-9-9" would never match a DATE.
    expect(isoDate(new Date("2026-01-05T00:00:00.000Z"))).toBe("2026-01-05");
  });
});

describe("formatCents", () => {
  /*
    🔴 The ONLY place an amount becomes a decimal, and it must never go back
    into a calculation. Every case below is one somebody would notice.
  */
  it("renders whole and part dollars", () => {
    expect(formatCents(50)).toBe("$0.50");
    expect(formatCents(1_250)).toBe("$12.50");
    expect(formatCents(1_200)).toBe("$12.00");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("pads a single-digit cent rather than showing $12.5", () => {
    expect(formatCents(1_205)).toBe("$12.05");
  });

  it("puts the sign before the symbol on a negative", () => {
    expect(formatCents(-50)).toBe("-$0.50");
  });

  it("never renders NaN at somebody", () => {
    expect(formatCents(Number.NaN)).toBe("$0.00");
    expect(formatCents(Number.POSITIVE_INFINITY)).toBe("$0.00");
  });
});

describe("top-up amounts", () => {
  const MIN = 500;

  /*
    🔴 A CLOSED SET, because an amount field is the most obvious thing in this
    system to tamper with. A value that is not on the ladder is REFUSED rather
    than clamped — clamping turns an attack into a slightly cheaper purchase.
  */
  it("accepts only the offered amounts", () => {
    for (const cents of aiTopupOptions(MIN)) expect(isValidTopupCents(cents, MIN)).toBe(true);
  });

  it("refuses anything else, including plausible-looking values", () => {
    for (const bad of [1, 499, 501, 100_000, 0, -500, "500", null, undefined, 5.5, Number.NaN]) {
      expect(isValidTopupCents(bad, MIN), JSON.stringify(bad)).toBe(false);
    }
  });

  /*
    The ladder starts exactly where the operator set it — that is the whole
    point of the setting — and rises monotonically, so the screen never offers
    a "bigger" option that costs less.
  */
  it("starts at the configured minimum and only goes up", () => {
    const options = aiTopupOptions(MIN);
    expect(options[0]).toBe(MIN);
    for (let i = 1; i < options.length; i += 1) {
      expect(options[i]!).toBeGreaterThan(options[i - 1]!);
    }
  });

  it("moves with the setting", () => {
    expect(aiTopupOptions(100)).toEqual([100, 200, 500, 1_000]);
    expect(aiTopupOptions(2_000)).toEqual([2_000, 4_000, 10_000, 20_000]);
  });

  /*
    🔴 A MINIMUM FROM THE REQUEST MUST NOT BE USABLE. The validator takes the
    minimum as an argument so it stays pure, which means a careless caller could
    pass one that arrived from the client — and `{ min: 1, amount: 1 }` would
    then buy credit for one cent. This test does not stop that; the route's own
    read of the server setting does. It is here to state the hazard next to the
    function, so the next reader sees it.
  */
  it("validates against whatever minimum it is given — so callers must pass the server's", () => {
    expect(isValidTopupCents(1, 1)).toBe(true);
    expect(isValidTopupCents(1, MIN)).toBe(false);
  });

  it("falls back rather than offering an empty ladder", () => {
    // A screen with no amounts on it is a member who cannot pay us.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(aiTopupOptions(bad as number).length).toBe(4);
      expect(aiTopupOptions(bad as number)[0]).toBe(AI_MIN_TOPUP_FALLBACK_CENTS);
    }
  });

  it("produces whole minor units, never a fraction", () => {
    for (const cents of aiTopupOptions(333)) expect(Number.isInteger(cents)).toBe(true);
  });
});
