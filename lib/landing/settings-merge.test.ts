import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A PARTIAL SAVE MUST NOT WIPE WHAT IT DID NOT MENTION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 THE BUG THIS PINS, FOUND 2026-09-08 AND SILENT UNTIL THEN.
 *
 * `setLandingSettings` REPLACED the whole stored object, and the admin route
 * gave every field a zod `.default()`. `LandingEditor` POSTs exactly two
 * fields. So every press of Save on the Landing panel did this:
 *
 *     feedGridImages           -> []      the 2x2 grid images WIPED
 *     frenzAiPublicEnabled     -> true    reset
 *     frenzAiFreeDailyCredits  -> 2       reset
 *     frenzAiFreeEnabled       -> true    reset
 *
 * on a screen that displays none of them, with nothing logged. An operator
 * could not have seen it happen, and the settings the owner specifically asked
 * for would quietly revert every time somebody changed a picture.
 *
 * Source-level, because the failure is in the SHAPE of the contract — a
 * `.default()` on a field the caller omits is indistinguishable from a
 * deliberate choice by the time the store sees it, and no unit test of the
 * store alone can see that.
 */

const ROOT = process.cwd();
const ROUTE = readFileSync(join(ROOT, "app/api/admin/landing/route.ts"), "utf8");
const STORE = readFileSync(join(ROOT, "lib/landing/settings.ts"), "utf8");

describe("the landing settings contract", () => {
  it("🔴 no field in the admin schema manufactures a default", () => {
    /*
      A `.default()` turns "the caller did not mention this" into "the caller
      asked for this", which is precisely how the grid images were lost.
    */
    const schema = ROUTE.slice(ROUTE.indexOf("const schema = z.object({"), ROUTE.indexOf("/** Admin-only"));
    expect(schema).not.toMatch(/\.default\(/);
  });

  it("every settable field is optional, so omission is expressible", () => {
    for (const field of [
      "reelsPosterUrl",
      "feedGridImages",
      "wallpaperCtaImageUrl",
      "frenzAiPublicEnabled",
      "frenzAiFreeDailyCredits",
      "frenzAiFreeEnabled",
    ]) {
      const line = ROUTE.split("\n").find((l) => l.trim().startsWith(`${field}:`));
      expect(line, `${field} should be present in the schema`).toBeTruthy();
      expect(line, `${field} must be optional`).toContain(".optional()");
    }
  });

  it("🔴 the store MERGES rather than replaces", () => {
    expect(STORE).toContain("Partial<LandingSettings>");
    // It has to read what is there before writing, or a merge is impossible.
    expect(STORE).toMatch(/const current = await getLandingSettings\(\)/);
  });

  it("the two admin panels each send only what they show", () => {
    const images = readFileSync(join(ROOT, "features/admin/landing-editor.tsx"), "utf8");
    const ai = readFileSync(join(ROOT, "features/admin/frenz-ai-settings.tsx"), "utf8");

    // The images panel must not touch the AI switches…
    expect(images).not.toContain("frenzAiFreeDailyCredits");
    // …and the AI panel must not touch the images.
    expect(ai).not.toContain("wallpaperCtaImageUrl");
    expect(ai).not.toContain("feedGridImages");
  });

  it("the AI panel actually renders all three controls the owner asked for", () => {
    const ai = readFileSync(join(ROOT, "features/admin/frenz-ai-settings.tsx"), "utf8");
    for (const field of ["frenzAiPublicEnabled", "frenzAiFreeEnabled", "frenzAiFreeDailyCredits"]) {
      expect(ai, `${field} must be settable`).toContain(field);
    }
  });
});
