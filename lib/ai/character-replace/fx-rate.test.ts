import { describe, expect, it } from "vitest";

import { minorPerUsdFrom, parseErApiAnswer, parseFawazAnswer, saneRate } from "./fx-rate";
import { convertUsdCents } from "./topup-fx";

/**
 * The live rate (owner, 2026-09-20: "rate should be live rate") — the pure
 * half: reading a provider's answer and turning it into the integer the
 * checkout charges at.
 */
describe("reading the providers", () => {
  it("open.er-api.com: the rate for the currency, with its update time", () => {
    const a = parseErApiAnswer({ result: "success", rates: { NGN: 1335.694724, GHS: 12.1 }, time_last_update_unix: 1789862551 }, "ngn");
    expect(a).toEqual({ perUsd: 1335.694724, asOf: new Date(1789862551 * 1000).toISOString() });
    expect(parseErApiAnswer({ result: "error" }, "NGN")).toBeNull();
    expect(parseErApiAnswer({ result: "success", rates: { NGN: "1335" } }, "NGN")).toBeNull();
    expect(parseErApiAnswer({ result: "success", rates: {} }, "NGN")).toBeNull();
  });
  it("the jsDelivr currency file: lower-case keys and a date", () => {
    expect(parseFawazAnswer({ date: "2026-09-19", usd: { ngn: 1331.857 } }, "NGN")).toEqual({ perUsd: 1331.857, asOf: "2026-09-19T00:00:00.000Z" });
    expect(parseFawazAnswer({ usd: {} }, "NGN")).toBeNull();
    expect(parseFawazAnswer(null, "NGN")).toBeNull();
  });
  it("a broken answer is not a market: zero, negative, NaN and absurd rates are refused", () => {
    expect(saneRate(0)).toBe(false);
    expect(saneRate(-5)).toBe(false);
    expect(saneRate(Number.NaN)).toBe(false);
    expect(saneRate(5_000_000)).toBe(false);
    expect(saneRate(1335.69)).toBe(true);
  });
});

describe("the integer the checkout charges at", () => {
  it("₦1,335.694724 per $1 → 133,569 kobo; a 3% markup → 137,577; the markup is clamped to 0–50", () => {
    expect(minorPerUsdFrom(1335.694724, 0)).toBe(133_569);
    expect(minorPerUsdFrom(1335.694724, 3)).toBe(137_577);
    expect(minorPerUsdFrom(1335.694724, -10)).toBe(133_569);
    expect(minorPerUsdFrom(1335.694724, 500)).toBe(minorPerUsdFrom(1335.694724, 50));
    expect(minorPerUsdFrom(0.0001, 0)).toBe(1);
  });
  it("$5 at the live rate is what the Paystack page will show", () => {
    expect(convertUsdCents(500, minorPerUsdFrom(1335.694724, 0))).toBe(667_845); // ₦6,678.45
    expect(convertUsdCents(1000, minorPerUsdFrom(1335.694724, 0))).toBe(1_335_690);
  });
});
