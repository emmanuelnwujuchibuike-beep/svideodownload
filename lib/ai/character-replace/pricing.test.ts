import { describe, expect, it } from "vitest";

import { CHARACTER_REPLACE_DEFAULTS, normalizeCharacterReplaceConfig, pricingFingerprint, type CharacterReplaceConfig } from "./config";
import {
  affordability,
  centsForDuration,
  qualityRateCents,
  quoteCharacterReplace,
  quoteTotal,
  validateQuoteInput,
  type QuoteInput,
} from "./pricing";

/**
 * The pricing engine (Part 3), pinned.
 *
 * The owner's own scenarios (§29) run against a configuration with round
 * numbers so every expectation can be checked by hand: ₦20/sec base, 480p at
 * 0.5×, 1080p at 2×, standard lip sync ₦10/sec, studio ₦25/sec, ₦100 minimum.
 * Amounts are in KOBO throughout, like the ledger.
 */

const cfg: CharacterReplaceConfig = normalizeCharacterReplaceConfig({
  ...CHARACTER_REPLACE_DEFAULTS,
  pricePerSecondCents: 2_000,
  basePriceCents: 0,
  minimumChargeCents: 10_000,
  maximumDurationSeconds: 60,
  qualities: [
    { id: "480p", multiplier: 0.5, enabled: true },
    { id: "720p", multiplier: 1, enabled: true },
    { id: "1080p", multiplier: 2, enabled: true },
  ],
  lipSyncEnabled: true,
  lipSync: [
    { id: "standard", perSecondCents: 1_000, enabled: true },
    { id: "studio", perSecondCents: 2_500, enabled: true },
  ],
  voice: { newVoiceEnabled: true, surchargePerSecondCents: 0 },
  pricingVersion: 3,
});

const money = { currency: "NGN", symbol: "₦", now: new Date("2026-09-13T12:00:00Z") };
const base: QuoteInput = { selectedDurationMs: 10_000, quality: "720p", voiceMode: "original", lipSyncMode: null };

describe("arithmetic", () => {
  it("multiplies before it divides, in integers, and rounds UP to the minor unit", () => {
    expect(centsForDuration(2_000, 10_000)).toBe(20_000);
    expect(centsForDuration(2_000, 18_437)).toBe(36_874);
    // 1 kobo/sec over 1 ms is a fraction of a kobo: charged as one, never zero.
    expect(centsForDuration(1, 1)).toBe(1);
    expect(centsForDuration(0, 10_000)).toBe(0);
    expect(centsForDuration(2_000, 0)).toBe(0);
  });

  it("derives a tier's rate from the multiplier, or takes its own rate when set", () => {
    expect(qualityRateCents(cfg, "480p")).toBe(1_000);
    expect(qualityRateCents(cfg, "720p")).toBe(2_000);
    expect(qualityRateCents(cfg, "1080p")).toBe(4_000);
    const own = normalizeCharacterReplaceConfig({ ...cfg, qualities: [{ id: "720p", perSecondCents: 3_333 }] });
    expect(qualityRateCents(own, "720p")).toBe(3_333);
    // A fractional multiplier rounds the RATE up too.
    const odd = normalizeCharacterReplaceConfig({ ...cfg, pricePerSecondCents: 1_001, qualities: [{ id: "480p", multiplier: 0.5 }] });
    expect(qualityRateCents(odd, "480p")).toBe(501);
  });
});

describe("§29 — the owner's scenarios", () => {
  it("10 s at 720p, original audio: ₦200", () => {
    const q = quoteCharacterReplace(base, cfg, money);
    expect(q.videoCents).toBe(20_000);
    expect(q.voiceCents).toBe(0);
    expect(q.lipSyncCents).toBe(0);
    expect(q.totalCents).toBe(20_000);
    expect(q.minimumApplied).toBe(false);
    expect(q.pricingConfigVersion).toBe(3);
    expect(q.durationMs).toBe(10_000);
  });

  it("TRIM: 20 s → 10 s halves a duration-based price", () => {
    expect(quoteTotal({ ...base, selectedDurationMs: 20_000 }, cfg)).toBe(40_000);
    expect(quoteTotal({ ...base, selectedDurationMs: 10_000 }, cfg)).toBe(20_000);
  });

  it("QUALITY: 720p → 480p and 720p → 1080p change the price by the configured multipliers", () => {
    expect(quoteTotal({ ...base, quality: "480p" }, cfg)).toBe(10_000);
    expect(quoteTotal({ ...base, quality: "1080p" }, cfg)).toBe(40_000);
  });

  it("LIP SYNC: off → standard adds the surcharge; standard → studio changes it", () => {
    const standard = quoteCharacterReplace({ ...base, voiceMode: "new_voice", lipSyncMode: "standard" }, cfg, money);
    expect(standard.lipSyncCents).toBe(10_000);
    expect(standard.totalCents).toBe(30_000);
    const studio = quoteCharacterReplace({ ...base, voiceMode: "new_voice", lipSyncMode: "studio" }, cfg, money);
    expect(studio.lipSyncCents).toBe(25_000);
    expect(studio.totalCents).toBe(45_000);
    expect(studio.lines.find((l) => l.key === "lipSync")).toMatchObject({ value: "Studio", amountCents: 25_000 });
  });

  it("VOICE: a new voice carries the operator's surcharge, original audio never does", () => {
    const priced = normalizeCharacterReplaceConfig({ ...cfg, voice: { newVoiceEnabled: true, surchargePerSecondCents: 500 } });
    expect(quoteCharacterReplace({ ...base, voiceMode: "new_voice" }, priced, money).voiceCents).toBe(5_000);
    expect(quoteCharacterReplace(base, priced, money).voiceCents).toBe(0);
    expect(quoteCharacterReplace(base, priced, money).lines.find((l) => l.key === "voice")?.amountCents).toBeNull();
  });

  it("MINIMUM: a tiny job is billed the minimum, and the line says so", () => {
    const q = quoteCharacterReplace({ ...base, selectedDurationMs: 1_000, quality: "480p" }, cfg, money);
    expect(q.subtotalCents).toBe(1_000);
    expect(q.minimumApplied).toBe(true);
    expect(q.totalCents).toBe(10_000);
    expect(q.lines.find((l) => l.key === "minimum")).toMatchObject({ amountCents: 9_000 });
  });

  it("BASE PRICE: a flat amount is added to every job and printed as its own line", () => {
    const flat = normalizeCharacterReplaceConfig({ ...cfg, basePriceCents: 5_000 });
    const q = quoteCharacterReplace(base, flat, money);
    expect(q.totalCents).toBe(25_000);
    expect(q.lines[0]).toMatchObject({ key: "base", amountCents: 5_000 });
  });

  it("USER WITH / WITHOUT BALANCE: affordability is arithmetic, never a deduction", () => {
    expect(affordability(100_000, 500_000)).toEqual({ sufficient: true, shortfallCents: 0, afterCents: 400_000 });
    expect(affordability(100_000, 50_000)).toEqual({ sufficient: false, shortfallCents: 50_000, afterCents: 0 });
    // Required ₦1,250 / Available ₦800 / Short by ₦450
    expect(affordability(125_000, 80_000).shortfallCents).toBe(45_000);
  });
});

describe("the informative sentences", () => {
  it("names the cheaper quality and what it saves, by the same arithmetic", () => {
    const q = quoteCharacterReplace({ ...base, quality: "1080p" }, cfg, money);
    expect(q.savings.map((s) => s.message)).toContain("You save ₦200.00 by choosing 720p instead of 1080p.");
    expect(q.savings[0]?.savesCents).toBe(20_000);
  });

  it("names standard lip sync when studio is chosen", () => {
    const q = quoteCharacterReplace({ ...base, voiceMode: "new_voice", lipSyncMode: "studio" }, cfg, money);
    expect(q.savings.map((s) => s.message)).toContain("Standard lip sync would save ₦150.00.");
  });

  it("says nothing when the cheapest choices are already made", () => {
    const q = quoteCharacterReplace({ ...base, quality: "480p" }, cfg, money);
    expect(q.savings).toEqual([]);
  });
});

describe("🔴 validation — the operator's switches are the law", () => {
  it("accepts a configuration the operator offers", () => {
    expect(validateQuoteInput(base, cfg)).toEqual({ ok: true });
    // Part 6: a new voice names its source; without one it is refused, with one it is accepted.
    expect(validateQuoteInput({ ...base, voiceMode: "new_voice", lipSyncMode: "studio" }, cfg).ok).toBe(false);
    expect(validateQuoteInput({ ...base, voiceMode: "new_voice", voiceSource: "upload", lipSyncMode: "studio" }, cfg)).toEqual({ ok: true });
    expect(validateQuoteInput({ ...base, voiceMode: "new_voice", voiceSource: "tts", ttsCharacters: 40, lipSyncMode: null }, cfg)).toEqual({ ok: true });
  });

  it("refuses a quality that is switched off rather than pricing another one", () => {
    const off = normalizeCharacterReplaceConfig({ ...cfg, qualities: [{ id: "1080p", enabled: false }] });
    const verdict = validateQuoteInput({ ...base, quality: "1080p" }, off);
    expect(verdict.ok).toBe(false);
    // And the shipped default has 1080p off — the provider documents 480/720.
    expect(validateQuoteInput({ ...base, quality: "1080p" }, CHARACTER_REPLACE_DEFAULTS).ok).toBe(false);
  });

  it("refuses lip sync without a new voice, a disabled tier, and a new voice when it is off", () => {
    expect(validateQuoteInput({ ...base, lipSyncMode: "standard" }, cfg).ok).toBe(false);
    const noStudio = normalizeCharacterReplaceConfig({ ...cfg, lipSync: [{ id: "studio", enabled: false }] });
    expect(validateQuoteInput({ ...base, voiceMode: "new_voice", voiceSource: "upload", lipSyncMode: "studio" }, noStudio).ok).toBe(false);
    const noVoice = normalizeCharacterReplaceConfig({ ...cfg, voice: { newVoiceEnabled: false, surchargePerSecondCents: 0 } });
    expect(validateQuoteInput({ ...base, voiceMode: "new_voice", voiceSource: "upload" }, noVoice).ok).toBe(false);
    const noLip = normalizeCharacterReplaceConfig({ ...cfg, lipSyncEnabled: false });
    expect(validateQuoteInput({ ...base, voiceMode: "new_voice", voiceSource: "upload", lipSyncMode: "standard" }, noLip).ok).toBe(false);
  });

  it("refuses durations outside the operator's window, non-integers, and a disabled tool", () => {
    expect(validateQuoteInput({ ...base, selectedDurationMs: 500 }, cfg).ok).toBe(false);
    expect(validateQuoteInput({ ...base, selectedDurationMs: 61_000 }, cfg).ok).toBe(false);
    expect(validateQuoteInput({ ...base, selectedDurationMs: 10_000.5 }, cfg).ok).toBe(false);
    expect(validateQuoteInput({ ...base, selectedDurationMs: -1 }, cfg).ok).toBe(false);
    expect(validateQuoteInput(base, normalizeCharacterReplaceConfig({ ...cfg, enabled: false })).ok).toBe(false);
  });

  it("carries no price field the caller could set", () => {
    const keys = Object.keys(base);
    expect(keys.some((k) => /price|cents|total|amount/i.test(k))).toBe(false);
  });
});

describe("§21 — versioning", () => {
  it("fingerprints only the price-bearing fields", () => {
    const a = pricingFingerprint(cfg);
    expect(pricingFingerprint(normalizeCharacterReplaceConfig({ ...cfg, languages: [{ code: "fr", label: "French" }] }))).toBe(a);
    expect(pricingFingerprint(normalizeCharacterReplaceConfig({ ...cfg, pricePerSecondCents: 2_001 }))).not.toBe(a);
    expect(pricingFingerprint(normalizeCharacterReplaceConfig({ ...cfg, qualities: [{ id: "480p", enabled: false }] }))).not.toBe(a);
    expect(pricingFingerprint(normalizeCharacterReplaceConfig({ ...cfg, lipSync: [{ id: "studio", perSecondCents: 1 }] }))).not.toBe(a);
  });

  it("a quote made under version 3 says version 3, whatever the config becomes later", () => {
    const q = quoteCharacterReplace(base, cfg, money);
    const later = normalizeCharacterReplaceConfig({ ...cfg, pricePerSecondCents: 9_000, pricingVersion: 4 });
    expect(q.pricingConfigVersion).toBe(3);
    expect(q.totalCents).toBe(20_000);
    expect(quoteTotal(base, later)).toBe(90_000);
    // The snapshot is complete on its own: no field of it needs the config.
    expect(q).toMatchObject({ baseRateCents: 2_000, qualityRateCents: 2_000, minimumChargeCents: 10_000 });
  });

  it("stamps the clock it was given and expires ten minutes on", () => {
    const q = quoteCharacterReplace(base, cfg, money);
    expect(q.createdAt).toBe("2026-09-13T12:00:00.000Z");
    expect(q.expiresAt).toBe("2026-09-13T12:10:00.000Z");
  });
});
