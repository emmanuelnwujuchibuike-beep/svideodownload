import { describe, expect, it } from "vitest";

import {
  FRENZ_AI_MAX_PRICE_CENTS,
  FRENZ_AI_MIN_TOPUP_CEILING,
  MINOR_UNITS_PER_MAJOR,
  majorInputToMinor,
  minorToMajorInput,
} from "@/lib/landing/settings";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 THE ADMIN TYPES MONEY THE WAY THEY SAY IT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "i set 500 naira per video and 2000 naira minimum deposit
 * and is showing 50 naira, i dont really understand."
 *
 * Two separate bugs met in that sentence, and both were mine.
 *
 *   1. The fields took MINOR units, because that is what Paystack's API takes.
 *      Typing 500 for ₦500 stored 500 kobo — ₦5.00. A payment provider's wire
 *      format is not a thing to put in front of an operator, and the comment I
 *      wrote beside that very field warned that a minor-unit box looks exactly
 *      like a major-unit one.
 *
 *   2. The ceilings were sized in dollars. 10,000 minor units read as "$100 a
 *      video, nobody would set that" — but in naira it is ₦100, so the owner's
 *      ordinary ₦500 price was ABOVE the maximum and the save was refused.
 *      A bound in minor units cannot carry a judgement about value unless it
 *      also knows the currency, and it did not.
 */

describe("majorInputToMinor", () => {
  it("turns what an operator types into what Paystack is sent", () => {
    expect(majorInputToMinor("500")).toBe(50_000); // ₦500
    expect(majorInputToMinor("2000")).toBe(200_000); // ₦2,000
    expect(majorInputToMinor("0.50")).toBe(50); // $0.50
  });

  /*
    🔴 `500.5 * 100` is `50050.000000000007` in binary floating point. This is
    the one place a decimal touches money in this system, and `Math.round` is
    why everything downstream can be an integer.
  */
  it("rounds rather than letting a float through", () => {
    expect(majorInputToMinor("500.5")).toBe(50_050);
    expect(Number.isInteger(majorInputToMinor("19.99"))).toBe(true);
    expect(majorInputToMinor("19.99")).toBe(1_999);
  });

  it("accepts a typed string with stray whitespace", () => {
    expect(majorInputToMinor(" 500 ")).toBe(50_000);
  });

  it("refuses nonsense rather than guessing", () => {
    for (const bad of ["", "abc", "-5", "NaN"]) {
      expect(majorInputToMinor(bad), bad).toBeNull();
    }
  });
});

describe("minorToMajorInput", () => {
  it("shows a whole amount without decimals an operator must read twice", () => {
    expect(minorToMajorInput(50_000)).toBe("500");
    expect(minorToMajorInput(200_000)).toBe("2000");
  });

  it("keeps the fraction when there is one", () => {
    expect(minorToMajorInput(50)).toBe("0.50");
    expect(minorToMajorInput(1_999)).toBe("19.99");
    // Padded — "19.9" would be nine cents short of what it says.
    expect(minorToMajorInput(1_905)).toBe("19.05");
  });

  /*
    🔴 A ROUND TRIP MUST NOT MOVE THE NUMBER. The field is populated from the
    stored value and sent back on every save, so any drift here would walk a
    price a little further each time an operator opened the panel and pressed
    Save without touching it.
  */
  it("round-trips every value the fields can hold", () => {
    for (const minor of [1, 50, 99, 100, 1_999, 50_000, 200_000, 1_000_000]) {
      expect(majorInputToMinor(minorToMajorInput(minor)), String(minor)).toBe(minor);
    }
  });
});

describe("the ceilings accommodate a real naira price", () => {
  /*
    🔴 THE EXACT VALUES THE OWNER SET, which the old bounds refused. These are
    the regression: a ceiling reasoned about in dollars silently excludes
    ordinary amounts in a currency worth ~1/1500th as much.
  */
  it("accepts ₦500 per video", () => {
    expect(majorInputToMinor("500")!).toBeLessThanOrEqual(FRENZ_AI_MAX_PRICE_CENTS);
  });

  it("accepts a ₦2,000 minimum deposit", () => {
    expect(majorInputToMinor("2000")!).toBeLessThanOrEqual(FRENZ_AI_MIN_TOPUP_CEILING);
  });

  it("still leaves headroom without being meaningless", () => {
    // ₦10,000 / $10,000 a video is generous; ₦1,000,000 would not be a bound.
    expect(FRENZ_AI_MAX_PRICE_CENTS / MINOR_UNITS_PER_MAJOR).toBe(10_000);
  });
});
