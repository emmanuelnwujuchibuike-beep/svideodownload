import { describe, expect, it } from "vitest";

import { A11Y_BOOT_JS, cssVariables, dataAttributes } from "./apply";
import {
  checkContrast,
  checkTargetSize,
  contrastRatio,
  gradeContrast,
  isLargeText,
  parseColor,
  relativeLuminance,
  TARGET_MIN_AA,
  TARGET_MIN_AAA,
} from "./contrast";
import {
  A11Y_PRESETS,
  applyPreset,
  DEFAULT_A11Y,
  isCustomised,
  normalise,
  TEXT_SCALES,
  type A11yPreferences,
} from "./preferences";

/**
 * Accessibility Center™ gates (Feature 18 · Part 22).
 *
 * The contrast suite checks against WCAG's PUBLISHED reference values, not
 * against what this implementation happens to produce. That distinction is the
 * whole point: a contrast checker that agrees only with itself is worse than
 * none, because it will be trusted.
 */

/* ────────────────────────────── colour parsing ─────────────────────────────── */

describe("parseColor", () => {
  it("reads the forms a stylesheet actually contains", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor("#FFFFFF")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseColor("rgb(37, 99, 255)")).toEqual({ r: 37, g: 99, b: 255 });
    expect(parseColor("rgba(37 99 255 / 0.5)")).toEqual({ r: 37, g: 99, b: 255 });
  });

  it("returns null rather than guessing", () => {
    // A validator that reports "pass" for a colour it failed to read is worse
    // than one that admits it does not know.
    expect(parseColor("hsl(200 50% 50%)")).toBeNull();
    expect(parseColor("rebeccapurple")).toBeNull();
    expect(parseColor("#12345")).toBeNull();
    expect(parseColor("rgb(300, 0, 0)")).toBeNull();
    expect(parseColor("")).toBeNull();
  });
});

/* ──────────────────────────────── the maths ────────────────────────────────── */

describe("WCAG relative luminance", () => {
  it("matches the specification's anchors exactly", () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
  });

  it("weights green far above blue, as the formula does", () => {
    const green = relativeLuminance({ r: 0, g: 255, b: 0 });
    const blue = relativeLuminance({ r: 0, g: 0, b: 255 });
    expect(green).toBeCloseTo(0.7152, 4);
    expect(blue).toBeCloseTo(0.0722, 4);
  });
});

describe("contrast ratio", () => {
  it("gives 21:1 for black on white — the published maximum", () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 5);
  });

  it("gives 1:1 for a colour against itself", () => {
    expect(contrastRatio({ r: 80, g: 80, b: 80 }, { r: 80, g: 80, b: 80 })).toBeCloseTo(1, 5);
  });

  it("is order-independent", () => {
    const a = { r: 18, g: 52, b: 86 };
    const b = { r: 240, g: 240, b: 240 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it("matches a known published pair", () => {
    // #767676 on #ffffff is the canonical "exactly AA on white" grey — the
    // lightest grey that still passes 4.5:1 for body text.
    const ratio = contrastRatio({ r: 118, g: 118, b: 118 }, { r: 255, g: 255, b: 255 });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeLessThan(4.6);
  });
});

describe("grading", () => {
  it("uses the right thresholds for body text", () => {
    expect(gradeContrast(2.9)).toBe("fail");
    expect(gradeContrast(3)).toBe("AA-large");
    expect(gradeContrast(4.5)).toBe("AA");
    expect(gradeContrast(7)).toBe("AAA");
  });

  it("uses the relaxed thresholds for large text", () => {
    expect(gradeContrast(2.9, true)).toBe("fail");
    expect(gradeContrast(3, true)).toBe("AA");
    expect(gradeContrast(4.5, true)).toBe("AAA");
  });

  it("knows what 'large' means in px", () => {
    // 18pt = 24px; 14pt bold = 18.66px. The odd 18.66 is the real conversion.
    expect(isLargeText(23)).toBe(false);
    expect(isLargeText(24)).toBe(true);
    expect(isLargeText(19, true)).toBe(true);
    expect(isLargeText(18, true)).toBe(false);
  });
});

describe("checkContrast", () => {
  it("rounds DOWN, so a near-miss never claims a pass", () => {
    // 4.499 must not report as 4.5 and grade AA.
    const c = checkContrast("#767677", "#ffffff")!;
    expect(c.ratio).toBeLessThanOrEqual(4.5);
  });

  it("says the same ratio passes as a heading and fails as body copy", () => {
    const body = checkContrast("#949494", "#ffffff", { fontSizePx: 16 })!;
    const heading = checkContrast("#949494", "#ffffff", { fontSizePx: 32 })!;
    expect(body.passesAA).toBe(false);
    expect(heading.passesAA).toBe(true);
    // That distinction is the reason `AA-large` exists as its own level.
    expect(body.level).toBe("AA-large");
  });

  it("explains itself in words, not just a number", () => {
    const fail = checkContrast("#cccccc", "#ffffff")!;
    expect(fail.summary).toMatch(/too low/i);
    expect(fail.summary).toContain("4.5:1");
    const pass = checkContrast("#000000", "#ffffff")!;
    expect(pass.summary).toMatch(/AAA/);
  });

  it("returns null when it cannot read a colour", () => {
    expect(checkContrast("papayawhip", "#fff")).toBeNull();
  });
});

describe("target size", () => {
  it("uses WCAG 2.2 §2.5.8 for AA and the HIG figure for AAA", () => {
    expect(TARGET_MIN_AA).toBe(24);
    expect(TARGET_MIN_AAA).toBe(44);
    expect(checkTargetSize(20, 20).passesAA).toBe(false);
    expect(checkTargetSize(24, 24).passesAA).toBe(true);
    expect(checkTargetSize(24, 24).passesAAA).toBe(false);
    expect(checkTargetSize(44, 44).passesAAA).toBe(true);
  });

  it("measures the SMALLEST edge — a wide, short button is still hard to hit", () => {
    expect(checkTargetSize(200, 18).passesAA).toBe(false);
  });
});

/* ───────────────────────────────── presets ─────────────────────────────────── */

describe("Accessibility Presets", () => {
  it("gives every preset a real explanation", () => {
    for (const p of A11Y_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.blurb.length, `${p.id} has no blurb`).toBeGreaterThan(20);
      expect(Object.keys(p.values).length, `${p.id} changes nothing`).toBeGreaterThan(0);
    }
  });

  it("MERGES, so a preset never silently undoes a deliberate choice", () => {
    const chosen: A11yPreferences = { ...DEFAULT_A11Y, textScale: 1.5 };
    const after = applyPreset(chosen, "minimal-motion");
    expect(after.textScale, "minimal-motion reset a text scale it has no opinion about").toBe(1.5);
    expect(after.motion).toBe("reduce");
  });

  it("except 'reset', whose whole purpose is to undo everything", () => {
    const busy: A11yPreferences = { ...DEFAULT_A11Y, textScale: 1.5, highContrast: true, boldText: true };
    expect(applyPreset(busy, "default")).toEqual(DEFAULT_A11Y);
  });

  it("does not assume a screen-reader user has low vision", () => {
    /*
      The screen-reader preset deliberately leaves type size and contrast alone.
      Someone using a screen reader may have no use for either, and a preset
      that conflates blindness with low vision is the kind of guess that makes
      accessibility features feel designed by someone who has never used one.
    */
    const p = applyPreset(DEFAULT_A11Y, "screen-reader");
    expect(p.textScale).toBe(DEFAULT_A11Y.textScale);
    expect(p.highContrast).toBe(DEFAULT_A11Y.highContrast);
    expect(p.strongFocus).toBe(true);
    expect(p.tapTargets).toBe("large");
  });

  it("leaves preferences untouched for an unknown preset", () => {
    expect(applyPreset(DEFAULT_A11Y, "nope")).toEqual(DEFAULT_A11Y);
  });

  it("knows when anything has been customised", () => {
    expect(isCustomised(DEFAULT_A11Y)).toBe(false);
    expect(isCustomised({ ...DEFAULT_A11Y, boldText: true })).toBe(true);
  });
});

/* ──────────────────────────────── normalise ────────────────────────────────── */

describe("normalise — storage is untrusted", () => {
  it("survives junk without losing the whole configuration", () => {
    // Losing one setting is recoverable; losing all of them is the thing
    // somebody spent time on.
    const out = normalise({ textScale: 99, boldText: true, motion: "nonsense", colorFilter: "chartreuse" });
    expect(out.textScale).toBe(DEFAULT_A11Y.textScale);
    expect(out.motion).toBe("system");
    expect(out.colorFilter).toBe("none");
    expect(out.boldText, "a valid field was discarded with the invalid ones").toBe(true);
  });

  it("handles absent, null and non-object input", () => {
    expect(normalise(undefined)).toEqual(DEFAULT_A11Y);
    expect(normalise(null)).toEqual(DEFAULT_A11Y);
    expect(normalise("nope")).toEqual(DEFAULT_A11Y);
  });

  it("accepts every scale the UI can produce", () => {
    for (const s of TEXT_SCALES) {
      expect(normalise({ textScale: s.value }).textScale).toBe(s.value);
    }
  });
});

/* ───────────────────────────────── applying ────────────────────────────────── */

describe("apply — one definition, two callers", () => {
  it("emits a scale, a tap floor and a focus width", () => {
    const vars = cssVariables({ ...DEFAULT_A11Y, textScale: 1.3, tapTargets: "large", strongFocus: true });
    expect(vars["--a11y-text-scale"]).toBe("1.3");
    expect(vars["--a11y-tap-min"]).toBe("44px");
    expect(vars["--a11y-focus-width"]).toBe("3px");
  });

  it("leaves motion to the OS when the choice is 'system'", () => {
    /*
      The critical default. Writing an attribute here would take control away
      from `prefers-reduced-motion`, which 23 files already honour correctly —
      so `system` must write NOTHING.
    */
    expect(dataAttributes(DEFAULT_A11Y)["data-a11y-motion"]).toBeUndefined();
    expect(dataAttributes({ ...DEFAULT_A11Y, motion: "reduce" })["data-a11y-motion"]).toBe("reduce");
    expect(dataAttributes({ ...DEFAULT_A11Y, motion: "full" })["data-a11y-motion"]).toBe("full");
  });

  it("uses a native filter for grayscale and an SVG matrix for colour blindness", () => {
    expect(cssVariables({ ...DEFAULT_A11Y, colorFilter: "grayscale" })["--a11y-filter"]).toBe("grayscale(1)");
    expect(cssVariables({ ...DEFAULT_A11Y, colorFilter: "deuteranopia" })["--a11y-filter"]).toBe("url(#a11y-deuteranopia)");
    expect(cssVariables(DEFAULT_A11Y)["--a11y-filter"]).toBe("none");
  });

  it("the boot script sets everything the React path does", () => {
    /*
      The two must not drift: the boot script runs before paint and the UI runs
      after a change, and any disagreement shows up as a flash — worst for
      exactly the people this feature is for.
    */
    for (const key of Object.keys(cssVariables(DEFAULT_A11Y))) {
      expect(A11Y_BOOT_JS, `boot script never sets ${key}`).toContain(key);
    }
    for (const attr of ["data-a11y-contrast", "data-a11y-transparency", "data-a11y-bold", "data-a11y-motion"]) {
      expect(A11Y_BOOT_JS, `boot script never sets ${attr}`).toContain(attr);
    }
  });

  it("the boot script removes the motion attribute for 'system'", () => {
    // Otherwise a stored `reduce` would survive being switched back to system.
    expect(A11Y_BOOT_JS).toContain("removeAttribute('data-a11y-motion')");
  });

  it("the boot script can never throw", () => {
    // It runs in <head>; an exception there would stop the page rendering.
    expect(A11Y_BOOT_JS).toMatch(/^\(function\(\)\{try\{/);
    expect(A11Y_BOOT_JS).toMatch(/catch\(e\)\{\}\}\)\(\);$/);
  });
});
