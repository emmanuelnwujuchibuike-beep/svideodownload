import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { tallForTopBanner } from "./slot-registry";

// owner, 2026-10-12: an "All slots" ad taller than the 32 px top strip says it may not show there
describe("tallForTopBanner", () => {
  it("warns for an All slots creative far taller than the strip's shape", () => {
    expect(tallForTopBanner(["all_slots"], 1200, 1500)).toBe(true); // portrait
    expect(tallForTopBanner(["all_slots"], 1600, 1000)).toBe(true); // a 320×200-style card
    expect(tallForTopBanner(["all_slots"], 1600, 400)).toBe(true); // 4:1 — still too tall
  });
  it("judges SHAPE, not pixels: a proper wide strip passes even though the file is 160 px tall", () => {
    expect(tallForTopBanner(["all_slots"], 1600, 160)).toBe(false);
    expect(tallForTopBanner(["all_slots"], 970, 120)).toBe(false); // ~8:1, inside ±35 %
  });
  it("only for All slots, and never on an unknown size", () => {
    expect(tallForTopBanner(["feed_banner"], 1200, 1500)).toBe(false);
    expect(tallForTopBanner(["all_slots"], null, null)).toBe(false);
  });
  it("the wizard shows it under the upload and in the review", () => {
    const w = readFileSync("features/ads-platform/advertise-wizard.tsx", "utf8");
    expect(w.match(/tallForTopBanner\(form\.placementCodes, form\.creative\?\.width, form\.creative\?\.height\)/g)?.length).toBe(2);
    expect(w).toContain("This ad may not show in the top banner because of its size.");
  });
});
