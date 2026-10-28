import { describe, expect, it } from "vitest";

import { arbitrageReason, checkConversionRules, type ConversionLeg, type FgcConversionRules, previewConversion, quoteLeg, roundTripFactor } from "./conversion-rules";

/**
 * Frenz Gift Coin Part 2: the app's twin of 0290's arithmetic. Test-only rules — never production values. The SAME
 * formulas run against the database in supabase/tests/0290_fgc_conversion.pglite.mjs, and conversion-sql.server.test.ts
 * compares this module with the real SQL.
 */
const LEG_A: ConversionLeg = { rateNum: 1, rateDen: 1, feeBp: 200, feeFlat: 0, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 };
const LEG_B: ConversionLeg = { rateNum: 1, rateDen: 1, feeBp: 500, feeFlat: 1, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 };
const R1: FgcConversionRules = { version: 1, fcToFgc: LEG_A, fgcToFc: LEG_B };
const legs = (a: number, b: number, c: number, d: number, bp1 = 0, bp2 = 0, f1 = 0, f2 = 0): FgcConversionRules => ({
  version: 1,
  fcToFgc: { ...LEG_A, rateNum: a, rateDen: b, feeBp: bp1, feeFlat: f1 },
  fgcToFc: { ...LEG_B, rateNum: c, rateDen: d, feeBp: bp2, feeFlat: f2 },
});

describe("one leg: floor gross, exact remainder, ceil percent fee + flat, net = gross − fee", () => {
  it.each([
    // [amount, leg, gross, remainder, fee, net]
    [1_000, LEG_A, 1_000, 0, 20, 980],
    [500, LEG_B, 500, 0, 26, 474],
    [1_001, { ...LEG_A, rateNum: 7, rateDen: 3, feeBp: 333, feeFlat: 2 }, 2_335, 2, 80, 2_255],
    [2_255, { ...LEG_B, rateNum: 3, rateDen: 7, feeBp: 100, feeFlat: 0 }, 966, 3, 10, 956],
    [1, { ...LEG_A, feeBp: 1 }, 1, 0, 1, 0],
    [49, { ...LEG_A, rateNum: 1, rateDen: 50 }, 0, 49, 0, 0],
  ] as const)("%i under %o", (amount, leg, gross, remainder, fee, net) => {
    const q = quoteLeg(amount, leg);
    expect(q).toMatchObject({ gross, remainder, fee, net });
    expect(BigInt(amount) * BigInt(leg.rateNum)).toBe(BigInt(q.gross) * BigInt(leg.rateDen) + BigInt(q.remainder));
  });

  it("is exact where floating point is not (amounts near 2^53)", () => {
    const leg = { ...LEG_A, rateNum: 999_999_937, rateDen: 999_999_929, feeBp: 3 };
    const x = 9_000_000_000;
    const q = quoteLeg(x, leg);
    const gross = (BigInt(x) * 999_999_937n) / 999_999_929n;
    expect(BigInt(q.gross)).toBe(gross);
    expect(BigInt(q.fee)).toBe((gross * 3n + 9_999n) / 10_000n);
  });

  it("refuses a non-integer or non-positive amount", () => {
    expect(() => quoteLeg(1.5, LEG_A)).toThrow();
    expect(() => quoteLeg(0, LEG_A)).toThrow();
  });
});

describe("checkConversionRules: exactly the database's check, never clamps", () => {
  it("no rules = config_missing (a missing configuration, not a switch)", () => {
    expect(checkConversionRules(null)).toMatchObject({ ok: false, code: "config_missing" });
    expect(checkConversionRules(undefined)).toMatchObject({ ok: false, code: "config_missing" });
  });

  it("valid test rules pass unchanged", () => {
    const r = checkConversionRules(R1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rules).toEqual(R1);
  });

  it.each([
    ["shape", "nope"],
    ["version", { ...R1, version: 0 }],
    ["version", { ...R1, version: 1.5 }],
    ["fgcToFc", { version: 1, fcToFgc: LEG_A }],
    ["fcToFgc.rateDen", { ...R1, fcToFgc: { ...LEG_A, rateDen: 0 } }],
    ["fcToFgc.rateNum", { ...R1, fcToFgc: { ...LEG_A, rateNum: "1" } }],
    ["fcToFgc.rateNum", { ...R1, fcToFgc: { ...LEG_A, rateNum: 1_000_000_000 } }],
    ["fgcToFc.feeBp", { ...R1, fgcToFc: { ...LEG_B, feeBp: 5_001 } }],
    ["fgcToFc.feeFlat", { ...R1, fgcToFc: { ...LEG_B, feeFlat: -1 } }],
    ["fcToFgc.maxIn", { ...R1, fcToFgc: { ...LEG_A, minIn: 500, maxIn: 499 } }],
    ["fgcToFc.dailyMaxIn", { ...R1, fgcToFc: { ...LEG_B, dailyMaxIn: 99 } }],
    ["fcToFgc.range", { ...R1, fcToFgc: { ...LEG_A, rateNum: 999_999_999, maxIn: 99_999_999_999 } }],
  ])("refuses %s", (detail, raw) => {
    expect(checkConversionRules(raw)).toMatchObject({ ok: false, code: "config_invalid", detail: `config_invalid:${detail}` });
  });
});

describe("arbitrage: refused when a round trip can return at least what went in", () => {
  it.each([
    ["1:1 both ways, no fees (K = 1)", legs(1, 1, 1, 1), true],
    ["100:1 then 1:100 (K = 1)", legs(100, 1, 1, 100), true],
    ["10000/9000 with 10% then 1:1 (K = 1 exactly)", legs(10_000, 9_000, 1, 1, 1_000), true],
    ["10001/10000 then 1:1 (K > 1)", legs(10_001, 10_000, 1, 1), true],
    ["2:1 then 1:1 with 50% (K = 1)", legs(2, 1, 1, 1, 0, 5_000), true],
    ["1:1 with 1 bp (K < 1)", legs(1, 1, 1, 1, 1), false],
    ["1:1 with only a 1-unit flat fee (K = 1, L > 0)", legs(1, 1, 1, 1, 0, 0, 0, 1), false],
    ["10001/10000 then 1:1 with 1 bp (K = 0.99999999)", legs(10_001, 10_000, 1, 1, 0, 1), false],
  ])("%s", (_, rules, refused) => {
    expect(arbitrageReason(rules) !== null).toBe(refused);
    expect(checkConversionRules(rules)).toMatchObject(refused ? { ok: false, code: "config_arbitrage" } : { ok: true });
  });

  it("the refusal names the effective round-trip percentage and never adjusts the rules", () => {
    const rules = legs(10_001, 10_000, 1, 1);
    const before = JSON.stringify(rules);
    expect(arbitrageReason(rules)).toMatch(/100\.0100%/);
    expect(JSON.stringify(rules)).toBe(before);
  });

  it("K is exact: 10001/10000 × 0.9999 = 0.99999999 < 1", () => {
    const { num, den } = roundTripFactor(legs(10_001, 10_000, 1, 1, 0, 1));
    expect(num < den).toBe(true);
    expect(den - num).toBe(10_000n);
  });

  /** Every amount, both directions, with the real integer rounding. */
  const roundTrip = (x: number, l1: ConversionLeg, l2: ConversionLeg) => {
    const y = quoteLeg(x, l1).net;
    return y <= 0 ? -1 : quoteLeg(y, l2).net;
  };
  it("valid rules never let any round trip break even (exhaustive search, 300 rule sets × 2000 amounts)", () => {
    let seed = 99;
    const rnd = (n: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648), seed % n);
    let checked = 0;
    for (let t = 0; t < 300; t++) {
      const l1 = { ...LEG_A, rateNum: 1 + rnd(15), rateDen: 1 + rnd(15), feeBp: [0, 0, 1, 50, 100][rnd(5)]!, feeFlat: [0, 0, 0, 1][rnd(4)]! };
      const l2 = { ...LEG_B, rateNum: 1 + rnd(15), rateDen: 1 + rnd(15), feeBp: [0, 0, 1, 50, 100][rnd(5)]!, feeFlat: [0, 0, 0, 1][rnd(4)]! };
      const refused = arbitrageReason({ fcToFgc: l1, fgcToFc: l2 }) !== null;
      let found = false;
      for (let x = 1; x <= 2_000 && !found; x++) found = roundTrip(x, l1, l2) >= x || roundTrip(x, l2, l1) >= x;
      if (!refused) {
        checked++;
        expect(found, JSON.stringify({ l1, l2 })).toBe(false);
      }
      // a refused rule set with nothing found this low must still have K ≥ 1 (it gains on larger amounts)
      if (refused && !found) {
        const { num, den } = roundTripFactor({ fcToFgc: l1, fgcToFc: l2 });
        expect(num >= den).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("the check has teeth: K > 1 rules DO have a profitable round trip at some amount", () => {
    const l1 = { ...LEG_A, rateNum: 11, rateDen: 10 };
    const l2 = { ...LEG_B, rateNum: 1, rateDen: 1, feeBp: 0, feeFlat: 0 };
    let best = -Infinity;
    for (let x = 1; x <= 1_000; x++) best = Math.max(best, roundTrip(x, l1, l2) - x);
    expect(best).toBeGreaterThan(0);
    expect(arbitrageReason({ fcToFgc: l1, fgcToFc: l2 })).not.toBeNull();
  });
});

describe("previewConversion", () => {
  it("prices within the limits and names the refusals the database would give", () => {
    expect(previewConversion(R1, "fc_to_fgc", 1_000)).toEqual({ ok: true, direction: "fc_to_fgc", input: 1_000, gross: 1_000, fee: 20, net: 980, remainder: 0, version: 1 });
    expect(previewConversion(R1, "fgc_to_fc", 99)).toMatchObject({ ok: false, reason: "amount_out_of_range" });
    expect(previewConversion({ ...R1, fcToFgc: { ...LEG_A, feeFlat: 150 } }, "fc_to_fgc", 150)).toMatchObject({ ok: false, reason: "below_fee" });
  });
});
