/**
 * Accessibility Center™ — the preference model (Feature 18 · Part 22).
 *
 * ── What this fixes ──────────────────────────────────────────────────────────
 * Frenz already honours `prefers-reduced-motion` in 23 files, ships `dir="rtl"`
 * for four locales, and holds every registry component to a seven-point
 * accessibility contract (`A11Y_STANDARDS`). What it had NO way to do was let a
 * person ask the app directly. The Part 21 settings registry says so in as many
 * words: `accessibility.motion` was `backend-only` — "honours the OS; there is
 * no in-app override".
 *
 * That matters because the OS signal is not always available or not always
 * right: a shared device, a borrowed phone, a desktop where the person wants
 * less motion in THIS app and not everywhere else.
 *
 * ── Everything here is pure ──────────────────────────────────────────────────
 * No React, no storage, no DOM. `apply.ts` turns these values into CSS custom
 * properties, and both the boot script and the settings UI call the SAME
 * function — so what renders before paint and what renders after a change agree
 * by construction rather than because two people remembered the same rules.
 */

export interface A11yPreferences {
  /** Body text multiplier. 1 = the app's normal scale. */
  textScale: number;
  /** Extra font weight added to body copy, in CSS weight units. */
  boldText: boolean;
  /** Raise token contrast and drop decorative tints. */
  highContrast: boolean;
  /** Remove `backdrop-blur` and translucency — costly to read through, and to render. */
  reduceTransparency: boolean;
  /**
   * In-app motion override, ON TOP of the OS signal.
   *
   * Three states on purpose. `system` defers to `prefers-reduced-motion`, which
   * is the right default and what the app already did. `reduce` and `full` are
   * explicit answers for the cases the OS signal cannot express — a person who
   * wants less motion here and not everywhere, or who is on a device that does
   * not expose the setting at all.
   */
  motion: "system" | "reduce" | "full";
  /** Minimum tap target in px. WCAG 2.2 AA asks 24; AAA and Apple ask 44. */
  tapTargets: "default" | "large";
  /** Thicker, higher-contrast focus ring. */
  strongFocus: boolean;
  /** Extra line-height and letter-spacing; narrower measure. */
  readingComfort: boolean;
  /** Whole-page colour filter. */
  colorFilter: "none" | "grayscale" | "protanopia" | "deuteranopia" | "tritanopia";
}

export const DEFAULT_A11Y: A11yPreferences = {
  textScale: 1,
  boldText: false,
  highContrast: false,
  reduceTransparency: false,
  motion: "system",
  tapTargets: "default",
  strongFocus: false,
  readingComfort: false,
  colorFilter: "none",
};

/**
 * Text scale steps.
 *
 * Capped at 1.5, not because larger is unreasonable but because beyond it this
 * app's layouts stop surviving — and shipping a step that visibly breaks the
 * page is worse than not offering it. Someone needing more than 150% is served
 * far better by browser or OS zoom, which scales everything including images
 * and spacing. That is a real limit, stated rather than hidden.
 */
export const TEXT_SCALES = [
  { value: 0.9, label: "Small" },
  { value: 1, label: "Default" },
  { value: 1.15, label: "Large" },
  { value: 1.3, label: "Larger" },
  { value: 1.5, label: "Largest" },
] as const;

export const COLOR_FILTERS = [
  { value: "none", label: "None" },
  { value: "grayscale", label: "Grayscale" },
  { value: "protanopia", label: "Protanopia (red-blind)" },
  { value: "deuteranopia", label: "Deuteranopia (green-blind)" },
  { value: "tritanopia", label: "Tritanopia (blue-blind)" },
] as const;

/**
 * Accessibility Presets™ — a named bundle, never a locked mode.
 *
 * The brief asks that presets "instantly configure hundreds of settings while
 * remaining fully customizable", and the second half is the important half. A
 * preset that locks its values is a MODE, and modes are what make people feel
 * handled rather than served. Applying one writes ordinary preference values
 * that can then be edited individually.
 *
 * Each is a real combination, not a marketing name: every field named below was
 * chosen because that need actually calls for it.
 */
export interface A11yPreset {
  id: string;
  label: string;
  /** Who it is for and what it changes — shown under the name, never hidden. */
  blurb: string;
  values: Partial<A11yPreferences>;
}

export const A11Y_PRESETS: readonly A11yPreset[] = [
  {
    id: "low-vision",
    label: "Low vision",
    blurb: "Larger, bolder text with high contrast and a strong focus ring.",
    values: { textScale: 1.3, boldText: true, highContrast: true, strongFocus: true, reduceTransparency: true },
  },
  {
    id: "screen-reader",
    label: "Screen reader",
    blurb: "Strong focus, large targets and no motion — tuned for navigating by keyboard and voice-over.",
    /*
      Deliberately does NOT change type size or contrast. Someone using a screen
      reader may have no use for either, and a preset that assumes blindness
      means low vision is the kind of guess that makes accessibility features
      feel like they were designed by someone who has never used one.
    */
    values: { strongFocus: true, tapTargets: "large", motion: "reduce", reduceTransparency: true },
  },
  {
    id: "dyslexia",
    label: "Dyslexia friendly",
    blurb: "Looser line spacing, a narrower column and less movement.",
    values: { readingComfort: true, motion: "reduce", textScale: 1.15 },
  },
  {
    id: "minimal-motion",
    label: "Minimal motion",
    blurb: "No animation, no parallax, no translucency.",
    values: { motion: "reduce", reduceTransparency: true },
  },
  {
    id: "motor",
    label: "Motor support",
    blurb: "Bigger tap targets and a clearer focus ring for precise-pointing difficulty.",
    values: { tapTargets: "large", strongFocus: true, motion: "reduce" },
  },
  {
    id: "cognitive",
    label: "Focus & clarity",
    blurb: "Calmer surfaces, easier reading, nothing moving in the corner of your eye.",
    values: { readingComfort: true, motion: "reduce", reduceTransparency: true, textScale: 1.15 },
  },
  {
    id: "senior",
    label: "Senior friendly",
    blurb: "Larger text and targets with stronger contrast.",
    values: { textScale: 1.3, boldText: true, tapTargets: "large", highContrast: true, strongFocus: true },
  },
  {
    id: "default",
    label: "Reset to default",
    blurb: "Everything back to the app's standard appearance.",
    values: DEFAULT_A11Y,
  },
] as const;

/** Applies a preset over the current preferences. Pure — returns a new object. */
export function applyPreset(current: A11yPreferences, presetId: string): A11yPreferences {
  const preset = A11Y_PRESETS.find((p) => p.id === presetId);
  if (!preset) return current;
  /*
    "Reset" REPLACES; every other preset MERGES.

    A preset is a starting point, so applying "Dyslexia friendly" must not
    silently undo a text scale someone chose deliberately — except for the one
    preset whose entire purpose is to undo everything.
  */
  return preset.id === "default" ? { ...DEFAULT_A11Y } : { ...current, ...preset.values };
}

/** True when anything differs from the app's defaults — drives the "active" badge. */
export function isCustomised(p: A11yPreferences): boolean {
  return (Object.keys(DEFAULT_A11Y) as (keyof A11yPreferences)[]).some((k) => p[k] !== DEFAULT_A11Y[k]);
}

/**
 * Coerce anything read from storage into a valid preference object.
 *
 * Storage is untrusted input: it may be from an older build with different
 * fields, hand-edited, or corrupt. Every value is validated against what the UI
 * can actually produce, so a bad entry falls back to the default for that field
 * alone rather than discarding the whole configuration — losing one setting is
 * recoverable, losing all of them is the thing someone spent time on.
 */
export function normalise(raw: unknown): A11yPreferences {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const scale = Number(o.textScale);
  return {
    textScale: TEXT_SCALES.some((s) => s.value === scale) ? scale : DEFAULT_A11Y.textScale,
    boldText: o.boldText === true,
    highContrast: o.highContrast === true,
    reduceTransparency: o.reduceTransparency === true,
    motion: o.motion === "reduce" || o.motion === "full" ? o.motion : "system",
    tapTargets: o.tapTargets === "large" ? "large" : "default",
    strongFocus: o.strongFocus === true,
    readingComfort: o.readingComfort === true,
    colorFilter: COLOR_FILTERS.some((f) => f.value === o.colorFilter)
      ? (o.colorFilter as A11yPreferences["colorFilter"])
      : "none",
  };
}
