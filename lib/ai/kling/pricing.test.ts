import { describe, expect, it } from "vitest";

import {
  klingQuoteMarginUsdCents,
  klingTier,
  klingTierCostKnown,
  klingTierKey,
  klingPricingFingerprint,
  normalizeKlingPricing,
  quoteKling,
  versionKlingPricing,
  KLING_PRICED_RESOLUTIONS,
  KLING_PRICING_DEFAULTS,
  KLING_TIER_KEYS,
  type KlingPricingConfig,
} from "./pricing";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KLING PRICING — deterministic, server-authoritative, one calculator (§12–§16)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The properties that actually matter for money:
 *
 *   · the same inputs always produce the same total, so a signed quote
 *     recomputes to the identical number at /start;
 *   · a member can never be charged less than the floor or more than the ceiling;
 *   · subscription and prepaid go through the SAME function — there is no
 *     funding argument to diverge on;
 *   · an UNMEASURED provider cost is reported as unknown, never as zero.
 */

const cfg = (over: Partial<KlingPricingConfig> = {}): KlingPricingConfig => normalizeKlingPricing({ ...KLING_PRICING_DEFAULTS, ...over });

/** A tier priced for the assertions below — the defaults ship at 0 on purpose. */
const priced = (): KlingPricingConfig =>
  normalizeKlingPricing({
    ...KLING_PRICING_DEFAULTS,
    matrix: {
      ...KLING_PRICING_DEFAULTS.matrix,
      "text_to_video:720p": { ...KLING_PRICING_DEFAULTS.matrix["text_to_video:720p"], priceUsdCentsPerSecond: 10, audioSurchargeUsdCentsPerSecond: 2, unitCostUsdCents: 5 },
      "lip_sync:source": { ...KLING_PRICING_DEFAULTS.matrix["lip_sync:source"], priceUsdCentsPerRun: 40, unitCostUsdCents: 5 },
    },
  });

describe("the matrix covers exactly what the live API serves", () => {
  it("has a row for every priced tier, and none for 480p", () => {
    expect(Object.keys(KLING_PRICING_DEFAULTS.matrix).sort()).toEqual([...KLING_TIER_KEYS].sort());
    // 🔴 480p is in the vendor's settings enum and REFUSED at generation, so a
    // 480p tier would be a price for something that cannot be made.
    expect(KLING_PRICED_RESOLUTIONS as readonly string[]).not.toContain("480p");
    expect(KLING_TIER_KEYS.some((k) => k.includes("480p"))).toBe(false);
  });

  it("has no row for a capability the API does not have", () => {
    for (const dead of ["character", "face", "reference_video", "reference_image", "full_character"]) {
      expect(KLING_TIER_KEYS.some((k) => k.includes(dead)), dead).toBe(false);
    }
  });

  it("lip sync is priced on ONE row, because the member chooses no resolution", () => {
    expect(klingTierKey("lip_sync", "720p")).toBe("lip_sync:source");
    expect(klingTierKey("lip_sync", "4k")).toBe("lip_sync:source");
  });
});

describe("🔴 an unmeasured provider cost is UNKNOWN, never zero", () => {
  it("720p is measured; 1080p and 4k are not, and say so", () => {
    const c = cfg();
    expect(klingTierCostKnown(klingTier(c, "text_to_video", "720p"))).toBe(true);
    expect(klingTierCostKnown(klingTier(c, "text_to_video", "1080p"))).toBe(false);
    expect(klingTierCostKnown(klingTier(c, "text_to_video", "4k"))).toBe(false);
  });

  it("the measured rate is the one that was observed twice", () => {
    // 1.8 units at 3s and 3 units at 5s both give 0.6 units/second.
    expect(klingTier(cfg(), "text_to_video", "720p").providerUnitsPerSecond).toBe(0.6);
    const q = quoteKling(priced(), { feature: "text_to_video", resolution: "720p", seconds: 5 });
    expect(q.ok && q.providerUnits).toBe(3);
  });

  it("🔴 a quote on an unmeasured tier reports null units and a null margin — not a comforting number", () => {
    const c = normalizeKlingPricing({
      ...KLING_PRICING_DEFAULTS,
      matrix: { ...KLING_PRICING_DEFAULTS.matrix, "text_to_video:4k": { ...KLING_PRICING_DEFAULTS.matrix["text_to_video:4k"], priceUsdCentsPerSecond: 50 } },
    });
    const q = quoteKling(c, { feature: "text_to_video", resolution: "4k", seconds: 5 });
    expect(q.ok).toBe(true);
    if (!q.ok) throw new Error("unreachable");
    expect(q.totalUsdCents).toBe(250);
    expect(q.providerUnits).toBeNull();
    expect(q.providerCostUsdCents).toBeNull();
    expect(klingQuoteMarginUsdCents(q)).toBeNull();
  });
});

describe("the quote is deterministic and bounded", () => {
  it("the same inputs give the same total, every time", () => {
    const c = priced();
    const a = quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 7 });
    const b = quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 7 });
    expect(a).toEqual(b);
    expect(a.ok && a.totalUsdCents).toBe(70);
  });

  it("🔴 the minimum billable length is a FLOOR — a 3 s job is not almost free", () => {
    const c = priced();
    const q = quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 3 });
    expect(q.ok && q.billableSeconds).toBe(3);
    expect(q.ok && q.totalUsdCents).toBe(30);
  });

  it("refuses a length outside the tier's window rather than clamping it silently", () => {
    const c = priced();
    expect(quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 2 }).ok).toBe(false);
    expect(quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 16 }).ok).toBe(false);
    expect(quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 0 }).ok).toBe(false);
    expect(quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: Number.NaN }).ok).toBe(false);
  });

  it("native audio surcharges per second, and never applies to lip sync", () => {
    const c = priced();
    const off = quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 5 });
    const on = quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 5, audio: true });
    expect(off.ok && off.totalUsdCents).toBe(50);
    expect(on.ok && on.totalUsdCents).toBe(60);
    // Lip Sync carries its own speech; an `audio` flag must not change its price.
    const ls = quoteKling(c, { feature: "lip_sync", resolution: "720p", seconds: 5 });
    const lsAudio = quoteKling(c, { feature: "lip_sync", resolution: "720p", seconds: 5, audio: true });
    expect(ls).toEqual(lsAudio);
    expect(ls.ok && ls.totalUsdCents).toBe(40);
  });

  it("rounds UP to a whole cent, once, at the end — a wallet holds no fractions", () => {
    const c = normalizeKlingPricing({
      ...KLING_PRICING_DEFAULTS,
      matrix: { ...KLING_PRICING_DEFAULTS.matrix, "text_to_video:720p": { ...KLING_PRICING_DEFAULTS.matrix["text_to_video:720p"], priceUsdCentsPerSecond: 3.33 } },
    });
    const q = quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 3 });
    // 3 × 3.33 = 9.99 → 10, never 9
    expect(q.ok && q.totalUsdCents).toBe(10);
  });

  it("a disabled tier and a global pause both refuse, with a sentence", () => {
    const disabled = normalizeKlingPricing({
      ...KLING_PRICING_DEFAULTS,
      matrix: { ...KLING_PRICING_DEFAULTS.matrix, "text_to_video:720p": { ...KLING_PRICING_DEFAULTS.matrix["text_to_video:720p"], enabled: false } },
    });
    const d = quoteKling(disabled, { feature: "text_to_video", resolution: "720p", seconds: 5 });
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason.length).toBeGreaterThan(0);
    expect(quoteKling(cfg({ paused: true }), { feature: "text_to_video", resolution: "720p", seconds: 5 }).ok).toBe(false);
  });
});

describe("🔴 ONE calculator for subscription and prepaid (§16)", () => {
  it("quoteKling takes no funding argument, so the two cannot diverge", () => {
    // A funding-aware price is two prices for one job, and the cheaper one is a
    // bug nobody notices for months. The signature is the guarantee.
    expect(quoteKling.length).toBe(2);
    const c = priced();
    const q = quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 5 });
    expect(q.ok && q.totalUsdCents).toBe(50);
  });

  it("the quote carries the pricing version, so a stale stored quote is recognisable", () => {
    const c = priced();
    const q = quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 5 });
    expect(q.ok && q.pricingVersion).toBe(c.version);
  });
});

describe("the normaliser clamps whatever is stored", () => {
  it("a hostile or broken row cannot produce a negative or absurd price", () => {
    const c = normalizeKlingPricing({
      matrix: {
        "text_to_video:720p": { priceUsdCentsPerSecond: -500, maxSeconds: 99999, minSeconds: -4, providerUnitsPerSecond: "abc", enabled: "yes" },
      },
    });
    const t = c.matrix["text_to_video:720p"];
    expect(t.priceUsdCentsPerSecond).toBeGreaterThanOrEqual(0);
    expect(t.maxSeconds).toBeLessThanOrEqual(60);
    expect(t.minSeconds).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(t.providerUnitsPerSecond)).toBe(true);
    expect(typeof t.enabled).toBe("boolean");
  });

  it("🔴 the billable floor can never exceed the tier's own ceiling", () => {
    const c = normalizeKlingPricing({ matrix: { "text_to_video:720p": { minSeconds: 3, maxSeconds: 5, minBillableSeconds: 999 } } });
    const t = c.matrix["text_to_video:720p"];
    expect(t.minBillableSeconds).toBeLessThanOrEqual(t.maxSeconds);
    // ...and a quote at the ceiling is still priceable rather than refused.
    expect(quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 5 }).ok).toBe(true);
  });

  it("garbage normalises to the defaults instead of throwing", () => {
    for (const bad of [null, undefined, 5, "x", []]) {
      expect(normalizeKlingPricing(bad).matrix["text_to_video:720p"].providerUnitsPerSecond).toBe(0.6);
    }
  });

  it("the version bumps only when something that changes a PRICE changes", () => {
    const a = cfg();
    const sameNotes = normalizeKlingPricing({ ...a, matrix: { ...a.matrix, "text_to_video:720p": { ...a.matrix["text_to_video:720p"], notes: "an operator's note" } } });
    expect(versionKlingPricing(a, sameNotes).version).toBe(a.version);

    const repriced = normalizeKlingPricing({ ...a, matrix: { ...a.matrix, "text_to_video:720p": { ...a.matrix["text_to_video:720p"], priceUsdCentsPerSecond: 99 } } });
    expect(versionKlingPricing(a, repriced).version).toBe(a.version + 1);
    expect(klingPricingFingerprint(a)).not.toBe(klingPricingFingerprint(repriced));
  });
});
