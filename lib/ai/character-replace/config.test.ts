import { describe, expect, it } from "vitest";

import {
  CHARACTER_REPLACE_DEFAULTS,
  normalizeCharacterReplaceConfig,
  publicCharacterReplaceConfig,
} from "./config";

/**
 * The configuration boundary, pinned.
 *
 * Several of these fields become money and all of them come from an admin
 * form, so the normaliser is the control — not the form, not the route. The
 * cases are the ones an operator can actually produce: a partial save, a
 * typo, a tier switched off, a list emptied.
 */
describe("normalizeCharacterReplaceConfig", () => {
  it("answers the defaults for nothing, junk, and a non-object", () => {
    expect(normalizeCharacterReplaceConfig(null)).toEqual(CHARACTER_REPLACE_DEFAULTS);
    expect(normalizeCharacterReplaceConfig(undefined)).toEqual(CHARACTER_REPLACE_DEFAULTS);
    expect(normalizeCharacterReplaceConfig("yes")).toEqual(CHARACTER_REPLACE_DEFAULTS);
    expect(normalizeCharacterReplaceConfig([1, 2])).toEqual(CHARACTER_REPLACE_DEFAULTS);
  });

  it("keeps every field an operator did not send", () => {
    const out = normalizeCharacterReplaceConfig({ enabled: false });
    expect(out.enabled).toBe(false);
    expect(out.pricePerSecondCents).toBe(CHARACTER_REPLACE_DEFAULTS.pricePerSecondCents);
    expect(out.languages).toEqual(CHARACTER_REPLACE_DEFAULTS.languages);
    expect(out.qualities).toEqual(CHARACTER_REPLACE_DEFAULTS.qualities);
  });

  it("🔴 clamps money and ceilings rather than trusting them", () => {
    const out = normalizeCharacterReplaceConfig({
      pricePerSecondCents: -5,
      minimumChargeCents: "abc",
      maximumDurationSeconds: 9_999,
      maximumUploadBytes: 1,
      maximumPixels: 10,
    });
    expect(out.pricePerSecondCents).toBe(0);
    expect(out.minimumChargeCents).toBe(CHARACTER_REPLACE_DEFAULTS.minimumChargeCents);
    // Never above the registry's hard ceiling (lib/ai/jobs.ts).
    expect(out.maximumDurationSeconds).toBe(120);
    expect(out.maximumUploadBytes).toBe(1024 * 1024);
    expect(out.maximumPixels).toBe(640 * 360);
  });

  it("merges a quality override over the default by id and drops unknown ids", () => {
    const out = normalizeCharacterReplaceConfig({
      qualities: [
        { id: "1080p", enabled: false, multiplier: 2.5 },
        { id: "4k", enabled: true, multiplier: 9 },
      ],
    });
    expect(out.qualities.map((q) => q.id)).toEqual(["480p", "720p", "1080p"]);
    expect(out.qualities.find((q) => q.id === "1080p")).toMatchObject({ enabled: false, multiplier: 2.5, longEdge: 1920 });
    expect(out.qualities.find((q) => q.id === "720p")?.enabled).toBe(true);
  });

  it("🔴 never leaves the member with no quality to choose", () => {
    const out = normalizeCharacterReplaceConfig({
      qualities: [
        { id: "480p", enabled: false },
        { id: "720p", enabled: false },
        { id: "1080p", enabled: false },
      ],
    });
    expect(out.qualities.some((q) => q.enabled)).toBe(true);
    expect(out.qualities.find((q) => q.id === "720p")?.enabled).toBe(true);
  });

  it("merges lip-sync tiers by id and clamps their rates", () => {
    const out = normalizeCharacterReplaceConfig({
      lipSync: [{ id: "studio", perSecondCents: -1, label: "Studio Plus" }],
    });
    const studio = out.lipSync.find((l) => l.id === "studio");
    expect(studio).toMatchObject({ perSecondCents: 0, label: "Studio Plus", premium: true });
    expect(out.lipSync.find((l) => l.id === "standard")).toEqual(CHARACTER_REPLACE_DEFAULTS.lipSync[0]);
  });

  it("accepts an operator's own language and voice lists, sanitised", () => {
    const out = normalizeCharacterReplaceConfig({
      languages: [
        { code: "EN", label: "English" },
        { code: "bad code!", label: "Nope" },
        { code: "yo", label: "" },
        { code: "ha", label: "Hausa", native: "Hausa" },
      ],
      voices: [{ id: "Warm Voice", label: "Warm" }, { id: "calm", label: "Calm", languages: ["en", "x y"] }],
    });
    expect(out.languages.map((l) => l.code)).toEqual(["en", "ha"]);
    expect(out.languages[0]?.native).toBe("English");
    // the operator's own row survives sanitised; the ElevenLabs library is added beside a catalogue that has none of it (2026-09-20)
    expect(out.voices.filter((v) => v.provider === "minimax").map((v) => v.id)).toEqual(["calm"]);
    expect(out.voices[0]?.languages).toEqual(["en"]);
    expect(out.voices.some((v) => v.provider === "elevenlabs")).toBe(true);
  });

  it("falls back to the default lists when an operator empties them", () => {
    const out = normalizeCharacterReplaceConfig({ languages: [], voices: [] });
    expect(out.languages.length).toBeGreaterThan(0);
    expect(out.voices.length).toBeGreaterThan(0);
  });

  it("offers the fourteen languages the owner listed, by default", () => {
    const codes = CHARACTER_REPLACE_DEFAULTS.languages.map((l) => l.code);
    for (const c of ["en", "fr", "es", "pt", "de", "it", "ar", "hi", "zh", "ja", "ko", "yo", "ig", "ha"]) {
      expect(codes, c).toContain(c);
    }
  });
});

describe("publicCharacterReplaceConfig", () => {
  const currency = { code: "NGN", symbol: "₦" };

  it("🔴 never sends a rate to the browser", () => {
    const pub = publicCharacterReplaceConfig(CHARACTER_REPLACE_DEFAULTS, currency, false) as unknown as Record<string, unknown>;
    const text = JSON.stringify(pub);
    expect(pub).not.toHaveProperty("pricePerSecondCents");
    expect(pub).not.toHaveProperty("basePriceCents");
    expect(pub).not.toHaveProperty("minimumChargeCents");
    expect(text).not.toContain("perSecondCents");
    expect(text).not.toContain("multiplier");
  });

  it("lists only the qualities and tiers that are on, and picks the balanced default", () => {
    // 1080p is off by default (the provider documents 480/720); switched on here to see the list.
    const config = normalizeCharacterReplaceConfig({
      qualities: [{ id: "720p", enabled: false }, { id: "1080p", enabled: true }],
      lipSync: [{ id: "studio", enabled: false }],
    });
    const pub = publicCharacterReplaceConfig(config, currency, false);
    expect(pub.qualities.map((q) => q.id)).toEqual(["480p", "1080p"]);
    // 720p is off, so the lowest remaining tier is the default.
    expect(pub.defaultQuality).toBe("480p");
    expect(pub.lipSync.map((l) => l.id)).toEqual(["standard"]);
    expect(pub.lipSyncEnabled).toBe(true);
  });

  it("reports lip sync off when the switch is off OR every tier is off", () => {
    const off = publicCharacterReplaceConfig(normalizeCharacterReplaceConfig({ lipSyncEnabled: false }), currency, false);
    expect(off.lipSyncEnabled).toBe(false);
    const none = publicCharacterReplaceConfig(
      normalizeCharacterReplaceConfig({ lipSync: [{ id: "standard", enabled: false }, { id: "studio", enabled: false }] }),
      currency,
      false,
    );
    expect(none.lipSyncEnabled).toBe(false);
    expect(none.lipSync).toEqual([]);
  });

  it("carries the currency and the pricing switch through unchanged", () => {
    const pub = publicCharacterReplaceConfig(CHARACTER_REPLACE_DEFAULTS, currency, false);
    expect(pub.currency).toBe("NGN");
    expect(pub.symbol).toBe("₦");
    expect(pub.pricingAvailable).toBe(false);
  });
});
