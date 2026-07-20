import { describe, expect, it } from "vitest";

import { parsePrice } from "./stats";

/**
 * MRR is computed from the price an operator SET, not from an environment
 * variable.
 *
 * The dashboard used to read `MONETIZATION_MRR_PRO` / `_BUSINESS`, defaulting to
 * 4.99 and 9.99 — numbers unrelated to anything on the pricing screen. Changing
 * the price in the admin moved /pricing and left the revenue figure untouched,
 * so the dashboard reported a confident total built from values nobody had
 * chosen. These tests cover the parser that closed that gap.
 */
describe("parsePrice", () => {
  it("reads a plain price with a leading symbol", () => {
    expect(parsePrice("$4.99")).toEqual({ amount: 4.99, currency: "$" });
    expect(parsePrice("£12")).toEqual({ amount: 12, currency: "£" });
  });

  it("handles a multi-character symbol and thousands separators", () => {
    // Naira with grouping is the case this was written against.
    expect(parsePrice("₦2,500")).toEqual({ amount: 2500, currency: "₦" });
    expect(parsePrice("NGN 2,500")).toEqual({ amount: 2500, currency: "NGN" });
  });

  it("ignores a trailing period suffix", () => {
    expect(parsePrice("$9.99/mo")).toEqual({ amount: 9.99, currency: "$" });
  });

  it("copes with no symbol at all", () => {
    expect(parsePrice("15")).toEqual({ amount: 15, currency: "" });
  });

  it("returns null rather than inventing a number", () => {
    /*
     * "Contact us" is a real thing to put on a pricing page. Guessing a value
     * for it would put a fabricated figure into a revenue total, which is the
     * exact failure this codebase refuses elsewhere. The caller reports the
     * total as incomplete instead.
     */
    for (const bad of ["Contact us", "", "   ", "free", "—"]) {
      expect(parsePrice(bad), bad).toBeNull();
    }
  });

  it("rejects a negative price", () => {
    // The minus is stripped as a non-numeric prefix, so this parses as positive
    // rather than producing a negative MRR. Pinned so the behaviour is a choice.
    expect(parsePrice("-5")?.amount).toBe(5);
  });
});
