import { describe, expect, it } from "vitest";

import { roundTripExample, roundTripPercent } from "@/lib/gift/conversion-rules";
import { formatFgc, parseFgc, stickerFieldProblem } from "@/lib/gift/stickers";

import { EMPTY_LEG, formFromRules, type GiftConversionForm, isDirty, parseHundredths, rateText, readForm } from "./gift-admin-logic";

/** Frenz Gift Coin Part 3: the conversion editor's arithmetic and the sticker field rules. Test-only values. */
const filled: GiftConversionForm = {
  fcToFgc: { rateNum: "1", rateDen: "1", feePercent: "2", feeFlat: "0", min: "1", max: "10000", daily: "30000" },
  fgcToFc: { rateNum: "1", rateDen: "1", feePercent: "5", feeFlat: "0.01", min: "1", max: "10000", daily: "30000" },
};

describe("exact parsing (no floating point, no rounding)", () => {
  it("amounts with up to 2 decimals become integer hundredths", () => {
    expect(parseHundredths("12.5")).toBe(1250);
    expect(parseHundredths("0.07")).toBe(7);
    expect(parseHundredths("1000000")).toBe(100_000_000);
    expect(parseHundredths("0.1")).toBe(10);
  });
  it("refuses more decimals than the unit has, signs, and junk — never rounds", () => {
    for (const bad of ["1.005", "-1", "1e3", "", "abc", "1,000", "0.333"]) expect(parseHundredths(bad)).toBeNull();
  });
  it("a sticker price in FGC → minor units, exactly; zero is not a price", () => {
    expect(parseFgc("50")).toBe(5000);
    expect(parseFgc("0.01")).toBe(1);
    expect(parseFgc("0")).toBeNull();
    expect(parseFgc("1.234")).toBeNull();
    expect(formatFgc(123456)).toBe("1,234.56");
  });
  it("shows the rate exactly", () => {
    expect(rateText(99, 100)).toBe("0.99");
    expect(rateText(1, 3)).toBe("0.333333");
    expect(rateText(0, 1)).toBe("—");
  });
});

describe("readForm: the server's own check, with the field it is about", () => {
  it("a filled form becomes integer legs (cents, minor units, basis points) and passes", () => {
    const r = readForm(filled, 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.legs.fcToFgc).toEqual({ rateNum: 1, rateDen: 1, feeBp: 200, feeFlat: 0, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 });
      expect(r.legs.fgcToFc.feeFlat).toBe(1);
      expect(r.rules.version).toBe(1);
    }
  });
  it("an unconfigured form is empty — nothing is filled in", () => {
    expect(formFromRules(null)).toEqual({ fcToFgc: EMPTY_LEG, fgcToFc: EMPTY_LEG });
    const r = readForm(formFromRules(null), 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fields)).toHaveLength(14);
  });
  it("arbitrage is refused with the effective percentage, and nothing is adjusted", () => {
    const f = { ...filled, fcToFgc: { ...filled.fcToFgc, feePercent: "0" }, fgcToFc: { ...filled.fgcToFc, feePercent: "0", feeFlat: "0" } };
    const before = JSON.stringify(f);
    const r = readForm(f, 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rules).toMatch(/100\.0000%/);
    expect(JSON.stringify(f)).toBe(before);
  });
  it.each([
    ["a fee over 50%", { fcToFgc: { ...filled.fcToFgc, feePercent: "50.01" } }, "fcToFgc.feePercent"],
    ["a zero denominator", { fgcToFc: { ...filled.fgcToFc, rateDen: "0" } }, "fgcToFc.rateDen"],
    ["max below min", { fcToFgc: { ...filled.fcToFgc, min: "100", max: "50" } }, "fcToFgc.max"],
    ["a daily limit below the minimum", { fgcToFc: { ...filled.fgcToFc, min: "10", daily: "5" } }, "fgcToFc.daily"],
    ["a minimum that gives nothing after the fee", { fcToFgc: { ...filled.fcToFgc, min: "0.01", feeFlat: "0.01" } }, "fcToFgc.min"],
    ["a rate that overflows at the maximum", { fcToFgc: { ...filled.fcToFgc, rateNum: "999999999", max: "999999999.99" } }, "fcToFgc.max"],
  ])("refuses %s on the right box", (_, patch, box) => {
    const r = readForm({ ...filled, ...patch } as GiftConversionForm, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fields)).toEqual([box]);
  });
  it("stored rules round-trip through the form unchanged (not dirty), and any edit is dirty", () => {
    const r = readForm(filled, 0);
    if (!r.ok) throw new Error("expected valid");
    expect(isDirty(formFromRules(r.rules), r.rules)).toBe(false);
    expect(isDirty({ ...formFromRules(r.rules), fcToFgc: { ...formFromRules(r.rules).fcToFgc, feePercent: "3" } }, r.rules)).toBe(true);
    expect(isDirty(formFromRules(null), null)).toBe(false);
  });
});

describe("the round-trip display", () => {
  it("is roundTripFactor's bound, and the example uses the engine's rounding (never above the bound)", () => {
    const r = readForm(filled, 0);
    if (!r.ok) throw new Error("expected valid");
    expect(roundTripPercent(r.rules)).toBe("93.1000"); // 0.98 × 0.95
    const ex = roundTripExample(r.rules)!;
    expect(ex).toEqual({ fcIn: 10_000, fgc: 9_800, fcBack: 9_309, percent: "93.0900" }); // 9800 FGC − 490 − 1 flat
    expect(Number(ex.percent)).toBeLessThanOrEqual(Number(roundTripPercent(r.rules)));
  });
});

describe("sticker fields (the database's rules, named for the admin)", () => {
  it("a create needs slug, name and price; the slug is fixed afterwards", () => {
    expect(stickerFieldProblem({ name: "x", priceFgc: 100 }, true)?.field).toBe("slug");
    expect(stickerFieldProblem({ slug: "rose", name: "Rose", priceFgc: 100 }, true)).toBeNull();
    expect(stickerFieldProblem({ slug: "new" }, false)?.field).toBe("slug");
  });
  it.each([
    ["a zero price", { priceFgc: 0 }, "priceFgc"],
    ["a fractional price", { priceFgc: 1.5 }, "priceFgc"],
    ["a price over the ceiling", { priceFgc: 100_000_000_000 }, "priceFgc"],
    ["an empty name", { name: "  " }, "name"],
    ["an http image", { imageUrl: "http://x.test/a.webp" }, "imageUrl"],
    ["a bad category", { category: "Love Hearts" }, "category"],
    ["a negative order", { sortOrder: -1 }, "sortOrder"],
  ])("refuses %s", (_, f, field) => {
    expect(stickerFieldProblem(f, false)?.field).toBe(field);
  });
  it("a new sticker can't be published without artwork or start archived", () => {
    expect(stickerFieldProblem({ slug: "a1", name: "A", priceFgc: 100, published: true }, true)?.field).toBe("published");
    expect(stickerFieldProblem({ slug: "a1", name: "A", priceFgc: 100, archived: true }, true)?.field).toBe("archived");
  });
});
