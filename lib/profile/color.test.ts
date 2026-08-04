import { describe, expect, it } from "vitest";

import {
  AA_LARGE,
  AA_NORMAL,
  accessibleAccent,
  bestTextOn,
  BLACK,
  checkAccent,
  contrastRatio,
  hslToRgb,
  parseHex,
  relativeLuminance,
  rgbToHsl,
  toHex,
  WHITE,
} from "@/lib/profile/color";

describe("parseHex / toHex", () => {
  it("parses long and short form, with or without the hash", () => {
    expect(parseHex("#0A84FF")).toEqual({ r: 10, g: 132, b: 255 });
    expect(parseHex("0a84ff")).toEqual({ r: 10, g: 132, b: 255 });
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("returns null for junk rather than a wrong colour", () => {
    for (const bad of ["", "#", "nope", "#12345", "#gggggg", "rgb(1,2,3)"]) {
      expect(parseHex(bad), bad).toBeNull();
    }
  });

  it("round-trips", () => {
    expect(toHex(parseHex("#6c4dff")!)).toBe("#6c4dff");
  });

  it("clamps out-of-range channels instead of emitting invalid hex", () => {
    expect(toHex({ r: -20, g: 300, b: 128 })).toBe("#00ff80");
  });
});

describe("relativeLuminance + contrastRatio (WCAG 2.1)", () => {
  it("matches the published anchors", () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5);
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 5);
    // Black on white is the maximum possible ratio, 21:1.
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 1);
  });

  it("is 1 for a colour against itself, and symmetric", () => {
    const c = parseHex("#0a84ff")!;
    expect(contrastRatio(c, c)).toBeCloseTo(1, 5);
    expect(contrastRatio(c, WHITE)).toBeCloseTo(contrastRatio(WHITE, c), 10);
  });

  it("uses the sRGB transfer function, not a naive average", () => {
    // A plain (r+g+b)/3 average would rank pure green as mid-brightness; the
    // real curve weights green heavily, which is why it fails on white.
    const green = parseHex("#00ff00")!;
    expect(contrastRatio(green, WHITE)).toBeLessThan(1.5);
    expect(contrastRatio(green, BLACK)).toBeGreaterThan(14);
  });
});

describe("bestTextOn", () => {
  it("picks the readable option for light and dark backgrounds", () => {
    expect(bestTextOn(WHITE)).toBe("black");
    expect(bestTextOn(BLACK)).toBe("white");
    expect(bestTextOn(parseHex("#fde68a")!)).toBe("black"); // pale amber
    expect(bestTextOn(parseHex("#1e1b4b")!)).toBe("white"); // deep indigo
  });

  it("always returns the higher-contrast of the two", () => {
    for (const hex of ["#0a84ff", "#6c4dff", "#10b981", "#f43f5e", "#f59e0b", "#06b6d4", "#808080"]) {
      const bg = parseHex(hex)!;
      const chosen = bestTextOn(bg) === "black" ? BLACK : WHITE;
      const other = bestTextOn(bg) === "black" ? WHITE : BLACK;
      expect(contrastRatio(bg, chosen)).toBeGreaterThanOrEqual(contrastRatio(bg, other));
    }
  });
});

describe("HSL round-trip", () => {
  it("survives a round trip within rounding error", () => {
    for (const hex of ["#0a84ff", "#10b981", "#f43f5e", "#ffffff", "#000000", "#808080"]) {
      const rgb = parseHex(hex)!;
      const back = hslToRgb(rgbToHsl(rgb));
      expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1);
    }
  });

  it("handles greys, which have no meaningful hue", () => {
    expect(rgbToHsl({ r: 128, g: 128, b: 128 }).s).toBe(0);
  });
});

describe("checkAccent", () => {
  it("reports both themes, because the VIEWER chooses the theme", () => {
    const report = checkAccent("#0a84ff")!;
    expect(report.onLight).toBeGreaterThan(1);
    expect(report.onDark).toBeGreaterThan(1);
  });

  it("flags a colour that is invisible on one theme", () => {
    // Pale yellow: fine on the dark surface, unreadable on white.
    const report = checkAccent("#fff8b0")!;
    expect(report.onDark).toBeGreaterThan(AA_LARGE);
    expect(report.onLight).toBeLessThan(AA_LARGE);
    expect(report.usableAsAccent).toBe(false);
    expect(report.suggestion).not.toBeNull();
  });

  it("offers no suggestion when the colour is already fine", () => {
    const report = checkAccent("#6c4dff")!;
    if (report.usableAsAccent) expect(report.suggestion).toBeNull();
  });

  it("marks readable only at the stricter normal-text threshold", () => {
    const report = checkAccent("#0a84ff")!;
    expect(report.readable).toBe(Math.min(report.onLight, report.onDark) >= AA_NORMAL);
  });

  it("returns null for an unparseable colour", () => {
    expect(checkAccent("not-a-colour")).toBeNull();
  });
});

describe("accessibleAccent", () => {
  it("returns a colour that actually passes on BOTH surfaces", () => {
    for (const hex of ["#fff8b0", "#ffe066", "#c0ffee", "#ffd1dc"]) {
      const fixed = accessibleAccent(hex);
      if (fixed === null) continue; // documented: some hues cannot satisfy both
      const report = checkAccent(fixed)!;
      expect(report.usableAsAccent, `${hex} → ${fixed} still fails`).toBe(true);
    }
  });

  it("preserves the hue the member chose", () => {
    const original = rgbToHsl(parseHex("#ffe066")!);
    const fixed = accessibleAccent("#ffe066");
    if (fixed) {
      const after = rgbToHsl(parseHex(fixed)!);
      // Same colour, corrected lightness — not a different colour entirely.
      expect(Math.abs(after.h - original.h)).toBeLessThan(2);
    }
  });

  it("returns null rather than a colour that merely looks different", () => {
    // Honesty check: the contract is "a passing colour, or nothing".
    const fixed = accessibleAccent("#ffffff");
    if (fixed !== null) expect(checkAccent(fixed)!.usableAsAccent).toBe(true);
  });

  it("returns null for junk", () => {
    expect(accessibleAccent("nope")).toBeNull();
  });
});
