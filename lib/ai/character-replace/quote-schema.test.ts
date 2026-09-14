import { describe, expect, it } from "vitest";

import { normalizeCharacterReplaceConfig, versionCharacterReplacePricing } from "./config";
import { quoteRequestSchema } from "./quote-schema";

/**
 * Part 3, §26 — the security tests the brief asks for, on the two pure
 * pieces the routes are built from: the quote request schema (what a client
 * may say) and the pricing version stamp (what the server writes itself).
 */
describe("quote request schema — a configuration, never a price", () => {
  const good = { selectedDurationMs: 10_000, quality: "720p", voiceMode: "original", lipSyncMode: null };

  it("accepts exactly the four priced inputs", () => {
    expect(quoteRequestSchema.safeParse(good).success).toBe(true);
    expect(quoteRequestSchema.safeParse({ ...good, voiceMode: "new_voice", lipSyncMode: "studio" }).success).toBe(true);
  });

  it.each([
    ["price", { price: 1 }],
    ["totalCents", { totalCents: 1 }],
    ["amount", { amount: 100 }],
    ["amountCents", { amountCents: 100 }],
    ["balance", { balance: 999_999 }],
    ["balanceCents", { balanceCents: 999_999 }],
    ["quoteId", { quoteId: "x" }],
    ["pricingConfigVersion", { pricingConfigVersion: 1 }],
    ["an unknown field", { anything: true }],
  ])("refuses a body carrying %s — refused, not stripped", (_label, extra) => {
    expect(quoteRequestSchema.safeParse({ ...good, ...extra }).success).toBe(false);
  });

  it("refuses a non-integer, zero, negative or absurd duration", () => {
    expect(quoteRequestSchema.safeParse({ ...good, selectedDurationMs: 10.5 }).success).toBe(false);
    expect(quoteRequestSchema.safeParse({ ...good, selectedDurationMs: 0 }).success).toBe(false);
    expect(quoteRequestSchema.safeParse({ ...good, selectedDurationMs: -1 }).success).toBe(false);
    expect(quoteRequestSchema.safeParse({ ...good, selectedDurationMs: 25 * 60 * 60 * 1000 }).success).toBe(false);
  });

  it("refuses a quality, voice or lip-sync value outside the enums, and a string duration", () => {
    expect(quoteRequestSchema.safeParse({ ...good, quality: "4k" }).success).toBe(false);
    expect(quoteRequestSchema.safeParse({ ...good, voiceMode: "clone" }).success).toBe(false);
    expect(quoteRequestSchema.safeParse({ ...good, lipSyncMode: "ultra" }).success).toBe(false);
    expect(quoteRequestSchema.safeParse({ ...good, selectedDurationMs: "10000" }).success).toBe(false);
    expect(quoteRequestSchema.safeParse({ ...good, lipSyncMode: undefined }).success).toBe(false);
  });
});

describe("pricing version — the server's stamp", () => {
  const base = normalizeCharacterReplaceConfig(null);

  it("leaves the version alone when no price-bearing field changed", () => {
    const next = normalizeCharacterReplaceConfig({ ...(base as unknown as Record<string, unknown>), maximumDurationSeconds: 45 });
    const out = versionCharacterReplacePricing(base, next);
    expect(out.pricingVersion).toBe(base.pricingVersion);
    expect(out.pricingHistory).toHaveLength(base.pricingHistory.length);
    expect(out.maximumDurationSeconds).toBe(45);
  });

  it("bumps the version, stamps the time and keeps the superseded prices when a rate changes", () => {
    const next = normalizeCharacterReplaceConfig({ ...(base as unknown as Record<string, unknown>), pricePerSecondCents: base.pricePerSecondCents + 5 });
    const out = versionCharacterReplacePricing(base, next);
    expect(out.pricingVersion).toBe(base.pricingVersion + 1);
    expect(out.pricingUpdatedAt).not.toBeNull();
    expect(out.pricingHistory.at(-1)?.version).toBe(base.pricingVersion);
    expect(out.pricingHistory.at(-1)?.config.pricePerSecondCents).toBe(base.pricePerSecondCents);
  });

  it("ignores a version, timestamp or history a client tried to post", () => {
    const forged = normalizeCharacterReplaceConfig({
      ...(base as unknown as Record<string, unknown>),
      pricingVersion: 99,
      pricingUpdatedAt: "2020-01-01T00:00:00.000Z",
      pricingHistory: [{ version: 98, replacedAt: "2020-01-01T00:00:00.000Z", config: {} }],
    });
    const out = versionCharacterReplacePricing(base, forged);
    expect(out.pricingVersion).toBe(base.pricingVersion);
    expect(out.pricingUpdatedAt).toBe(base.pricingUpdatedAt);
    expect(out.pricingHistory).toEqual(base.pricingHistory);
  });

  it("keeps at most twenty superseded versions", () => {
    let current = base;
    for (let i = 0; i < 25; i++) {
      const next = normalizeCharacterReplaceConfig({ ...(current as unknown as Record<string, unknown>), pricePerSecondCents: current.pricePerSecondCents + 1 });
      current = versionCharacterReplacePricing(current, next);
    }
    expect(current.pricingVersion).toBe(base.pricingVersion + 25);
    expect(current.pricingHistory).toHaveLength(20);
  });
});
