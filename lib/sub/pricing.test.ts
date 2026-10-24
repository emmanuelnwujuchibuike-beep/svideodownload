import { describe, expect, it } from "vitest";

import {
  effectiveMonthlyCents,
  parseBundlePrices,
  periodDaysFor,
  promotionEligible,
  promotionPriceCents,
  promotionStatus,
  regularPriceFor,
  savesMoney,
  savingsCents,
  savingsPercent,
  subOptions,
  validateBundlePrice,
  validatePromotion,
  type PromotionRule,
} from "./pricing";

const BOUNDS = { minPriceCents: 100, maxPriceCents: 100_000 };
const NOW = Date.parse("2026-10-24T12:00:00Z");
const BUNDLES = { 3: 2_700, 6: 5_400, 12: 9_600 } as const;
const promo = (over: Partial<PromotionRule> = {}): PromotionRule => ({ id: "p1", kind: "percent", percentOff: 20, fixedPriceCents: null, durations: [1, 3], startsAt: "2026-10-20T00:00:00Z", endsAt: "2026-10-30T00:00:00Z", maxRedemptions: null, paused: false, ...over });

describe("bundle maths (0277)", () => {
  it("durations → access days: 1 month keeps the admin's period; 3/6/12 are 90/180/365 (≤ 366)", () => {
    expect([periodDaysFor(1, 30), periodDaysFor(1, 31), periodDaysFor(3, 30), periodDaysFor(6, 30), periodDaysFor(12, 30)]).toEqual([30, 31, 90, 180, 365]);
  });
  it("effective monthly price and honest savings", () => {
    expect(effectiveMonthlyCents(2_700, 3)).toBe(900);
    expect(effectiveMonthlyCents(1_000, 3)).toBe(333);
    expect(savingsCents(2_700, 3, 1_000)).toBe(300);
    expect(savingsPercent(2_700, 3, 1_000)).toBe(10);
    expect(savesMoney(2_700, 3, 1_000)).toBe(true);
  });
  it("a bundle that costs as much or MORE than paying monthly shows no saving — never a negative discount", () => {
    expect(savingsCents(3_000, 3, 1_000)).toBe(0);
    expect(savesMoney(3_000, 3, 1_000)).toBe(false);
    expect(savingsCents(3_500, 3, 1_000)).toBe(0);
    expect(savingsPercent(3_500, 3, 1_000)).toBe(0);
  });
  it("a saving percent is rounded DOWN (never overstated)", () => {
    expect(savingsPercent(2_999, 3, 1_000)).toBe(0); // 0.03 %
    expect(savingsPercent(2_669, 3, 1_000)).toBe(11); // 11.03 %
  });
  it("bundle totals stay inside the admin's bounds scaled by months; whole cents only", () => {
    expect(validateBundlePrice(300, 3, BOUNDS).ok).toBe(true);
    expect(validateBundlePrice(299, 3, BOUNDS)).toMatchObject({ ok: false, error: "Set the 3-month price from $3.00 to $3,000.00." });
    expect(validateBundlePrice(1_200_000, 12, BOUNDS).ok).toBe(true);
    expect(validateBundlePrice(1_200_001, 12, BOUNDS).ok).toBe(false);
    expect(validateBundlePrice(2_700.5, 3, BOUNDS).ok).toBe(false);
  });
  it("stored jsonb: anything not a positive whole number is off; unknown keys ignored", () => {
    expect(parseBundlePrices({ "3": 2_700, "6": null, "12": -5, "24": 100 })).toEqual({ 3: 2_700, 6: null, 12: null });
    expect(parseBundlePrices(null)).toEqual({ 3: null, 6: null, 12: null });
    expect(parseBundlePrices({ "3": 10.5 })).toEqual({ 3: null, 6: null, 12: null });
  });
  it("regular price: 1 month is the monthly price; a disabled bundle is not offered", () => {
    expect(regularPriceFor(1, 1_000, BUNDLES)).toBe(1_000);
    expect(regularPriceFor(6, 1_000, { 3: null, 6: null, 12: null })).toBeNull();
    expect(regularPriceFor(1, null, BUNDLES)).toBeNull();
  });
});

describe("promotions (0277)", () => {
  it("percent: rounded to the cent, never above the regular price, never below 1 cent", () => {
    expect(promotionPriceCents({ kind: "percent", percentOff: 20, fixedPriceCents: null }, 1_000)).toBe(800);
    expect(promotionPriceCents({ kind: "percent", percentOff: 33, fixedPriceCents: null }, 999)).toBe(669);
    expect(promotionPriceCents({ kind: "percent", percentOff: 90, fixedPriceCents: null }, 1)).toBeNull(); // 0.1 ¢ → not a price
    expect(promotionPriceCents({ kind: "percent", percentOff: 91, fixedPriceCents: null }, 1_000)).toBeNull();
    expect(promotionPriceCents({ kind: "percent", percentOff: 0, fixedPriceCents: null }, 1_000)).toBeNull();
  });
  it("fixed: positive and no more than the regular price", () => {
    expect(promotionPriceCents({ kind: "fixed", percentOff: null, fixedPriceCents: 500 }, 1_000)).toBe(500);
    expect(promotionPriceCents({ kind: "fixed", percentOff: null, fixedPriceCents: 1_000 }, 1_000)).toBe(1_000);
    expect(promotionPriceCents({ kind: "fixed", percentOff: null, fixedPriceCents: 1_001 }, 1_000)).toBeNull();
    expect(promotionPriceCents({ kind: "fixed", percentOff: null, fixedPriceCents: 0 }, 1_000)).toBeNull();
  });
  it("status at the start and end boundaries (server time): starts inclusive, ends exclusive", () => {
    const p = promo();
    expect(promotionStatus(p, Date.parse(p.startsAt) - 1)).toBe("scheduled");
    expect(promotionStatus(p, Date.parse(p.startsAt))).toBe("active");
    expect(promotionStatus(p, Date.parse(p.endsAt) - 1)).toBe("active");
    expect(promotionStatus(p, Date.parse(p.endsAt))).toBe("expired");
    expect(promotionStatus({ ...p, paused: true }, NOW)).toBe("paused");
    expect(promotionStatus({ ...p, paused: true }, Date.parse(p.endsAt))).toBe("expired");
  });
  it("eligibility: active, the duration covered, and room under the limit", () => {
    expect(promotionEligible(promo(), 1, NOW)).toBe(true);
    expect(promotionEligible(promo(), 12, NOW)).toBe(false);
    expect(promotionEligible(promo({ paused: true }), 1, NOW)).toBe(false);
    expect(promotionEligible(promo({ maxRedemptions: 2 }), 1, NOW, 1)).toBe(true);
    expect(promotionEligible(promo({ maxRedemptions: 2 }), 1, NOW, 2)).toBe(false);
  });
  it("validation: plain words for every bad input, checked against the creator's CURRENT prices", () => {
    const ctx = { monthlyCents: 1_000, bundles: { 3: 2_700, 6: null, 12: null }, now: NOW, isNew: true };
    const base = { name: "Launch", kind: "percent" as const, percentOff: 20, durations: [1, 3], startsAt: "2026-10-24T00:00:00Z", endsAt: "2026-11-24T00:00:00Z" };
    expect(validatePromotion(base, ctx).ok).toBe(true);
    expect(validatePromotion({ ...base, percentOff: 95 }, ctx)).toMatchObject({ ok: false });
    expect(validatePromotion({ ...base, durations: [6] }, ctx)).toMatchObject({ ok: false, error: "Turn on the 6-month bundle first, or leave it out of the promotion." });
    expect(validatePromotion({ ...base, durations: [2] }, ctx)).toMatchObject({ ok: false });
    expect(validatePromotion({ ...base, endsAt: base.startsAt }, ctx)).toMatchObject({ ok: false, error: "The promotion must end after it starts." });
    expect(validatePromotion({ ...base, endsAt: "2026-10-23T00:00:00Z", startsAt: "2026-10-01T00:00:00Z" }, ctx)).toMatchObject({ ok: false, error: "The end date has already passed." });
    expect(validatePromotion({ ...base, kind: "fixed", percentOff: null, fixedPriceCents: 1_500 }, ctx)).toMatchObject({ ok: false, error: "The promotional price can't be more than the regular monthly price ($10.00)." });
    expect(validatePromotion({ ...base, kind: "fixed", percentOff: null, fixedPriceCents: 900 }, ctx).ok).toBe(true);
    expect(validatePromotion({ ...base, maxRedemptions: 0 }, ctx)).toMatchObject({ ok: false });
    expect(validatePromotion({ ...base, name: "<b>x</b>" }, ctx)).toMatchObject({ ok: false });
  });
});

describe("the options a subscriber is offered", () => {
  it("every offered duration with the fee on top, the best promotion and an honest saving vs the REGULAR monthly", () => {
    const out = subOptions({ monthlyCents: 1_000, bundles: { 3: 2_700, 6: null, 12: 9_600 }, periodDays: 30, feePercent: 10, promotions: [promo({ durations: [3] })], now: NOW, promotionNames: { p1: "Launch" } });
    expect(out.map((o) => [o.months, o.priceCents, o.feeCents, o.totalCents, o.periodDays, o.promotion?.name ?? null])).toEqual([
      [1, 1_000, 100, 1_100, 30, null],
      [3, 2_160, 216, 2_376, 90, "Launch"],
      [12, 9_600, 960, 10_560, 365, null],
    ]);
    expect(out[1]).toMatchObject({ regularCents: 2_700, regularTotalCents: 2_970, savingsCents: 840, savingsPercent: 28 });
    expect(out[2]).toMatchObject({ effectiveMonthlyCents: 800, savingsCents: 2_400 });
  });
  it("an exhausted, paused or scheduled promotion is left out; nothing is offered without a monthly price", () => {
    const full = subOptions({ monthlyCents: 1_000, bundles: { 3: null, 6: null, 12: null }, periodDays: 30, feePercent: 10, promotions: [promo({ maxRedemptions: 1 })], live: { p1: 1 }, now: NOW });
    expect(full[0]!.promotion).toBeNull();
    expect(subOptions({ monthlyCents: 1_000, bundles: { 3: null, 6: null, 12: null }, periodDays: 30, feePercent: 10, promotions: [promo({ startsAt: "2026-10-25T00:00:00Z" })], now: NOW })[0]!.promotion).toBeNull();
    expect(subOptions({ monthlyCents: null, bundles: BUNDLES, periodDays: 30, feePercent: 10, promotions: [], now: NOW })).toEqual([]);
  });
});
