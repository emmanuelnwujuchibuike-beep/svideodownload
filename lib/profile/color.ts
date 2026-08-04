/**
 * Colour Intelligence™ — accessible colour, computed (Feature 18 · Part 16).
 *
 * ── What this is, stated plainly ──────────────────────────────────────────
 * WCAG 2.1 contrast mathematics. Not a model, not a guess, not "AI-assisted"
 * with a spinner in front of it. Every number here is the published formula,
 * so a member told their accent is unreadable can be shown the exact ratio and
 * the exact threshold it missed.
 *
 * That matters more here than almost anywhere else in the product: this decides
 * whether text on someone's profile is legible to a person with low vision. An
 * answer that is *probably* right is not good enough, and a model that returns
 * a plausible-looking hex has no idea whether it passes.
 *
 * ── Where a model WOULD earn its place ────────────────────────────────────
 * Taste — "does this palette feel like a photography portfolio?" — is a genuine
 * judgement call and a good use for one. Legibility is arithmetic. The two are
 * kept apart on purpose; only the arithmetic is shipped.
 *
 * Pure: no React, no I/O.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parses #rgb / #rrggbb (with or without the hash). Null when unparseable. */
export function parseHex(hex: string): Rgb | null {
  const h = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) {
    return {
      r: parseInt(h[0]! + h[0]!, 16),
      g: parseInt(h[1]! + h[1]!, 16),
      b: parseInt(h[2]! + h[2]!, 16),
    };
  }
  if (/^[0-9a-f]{6}$/i.test(h)) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  return null;
}

export function toHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Relative luminance, WCAG 2.1 §"relative luminance".
 * The channel transfer function is the sRGB one — a plain average would rank
 * colours in the wrong order and pass combinations that are genuinely unreadable.
 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours: 1 (identical) → 21 (black on white). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA thresholds. Large text is 18.66px bold or 24px regular and above. */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;

export const WHITE: Rgb = { r: 255, g: 255, b: 255 };
export const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** Which of black or white is more readable ON this colour. */
export function bestTextOn(background: Rgb): "black" | "white" {
  return contrastRatio(background, BLACK) >= contrastRatio(background, WHITE) ? "black" : "white";
}

/* ───────────────────────────── HSL ───────────────────────────── */

export interface Hsl {
  h: number; // 0–360
  s: number; // 0–1
  l: number; // 0–1
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

/* ────────────────────── the actual intelligence ────────────────────── */

export interface AccentReport {
  hex: string;
  /** Contrast of this colour against a white surface. */
  onLight: number;
  /** …and against the app's near-black surface. */
  onDark: number;
  /** Does it clear AA for normal text on BOTH themes? */
  readable: boolean;
  /** Clears AA for large text / UI accents on both themes. */
  usableAsAccent: boolean;
  /**
   * A hue-preserving alternative that DOES pass, or null when the original is
   * already fine. Same colour, corrected lightness — never a different colour,
   * because a member picked that hue on purpose.
   */
  suggestion: string | null;
}

/** The app's dark surface (design tokens: space navy #050816). */
const DARK_SURFACE: Rgb = { r: 5, g: 8, b: 22 };

/**
 * Judges an accent against BOTH themes.
 *
 * Both, because a profile is rendered in whatever theme the VIEWER prefers, not
 * the author's. An accent tuned only against the author's dark mode can be
 * invisible to half the people who see it — and the author would never find out.
 */
export function checkAccent(hex: string): AccentReport | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;

  const onLight = contrastRatio(rgb, WHITE);
  const onDark = contrastRatio(rgb, DARK_SURFACE);
  const worst = Math.min(onLight, onDark);

  return {
    hex: toHex(rgb),
    onLight: round2(onLight),
    onDark: round2(onDark),
    readable: worst >= AA_NORMAL,
    usableAsAccent: worst >= AA_LARGE,
    suggestion: worst >= AA_LARGE ? null : accessibleAccent(hex),
  };
}

/**
 * The nearest lightness of the SAME hue that clears AA-large on both themes.
 *
 * Walks lightness outward from the original in small steps and returns the first
 * value that works, so the result is the least-changed colour that passes rather
 * than a canned "safe" palette entry. Returns null when the hue cannot satisfy
 * both surfaces at any lightness — which is real: a very light yellow cannot
 * clear 3:1 against white at any lightness that still reads as yellow.
 */
export function accessibleAccent(hex: string): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const { h, s } = rgbToHsl(rgb);
  const start = rgbToHsl(rgb).l;

  let best: { hex: string; worst: number } | null = null;
  for (let step = 0; step <= 100; step++) {
    for (const dir of [-1, 1]) {
      const l = start + dir * step * 0.01;
      if (l < 0.08 || l > 0.95) continue;
      const candidate = hslToRgb({ h, s, l });
      const worst = Math.min(contrastRatio(candidate, WHITE), contrastRatio(candidate, DARK_SURFACE));
      if (worst >= AA_LARGE) return toHex(candidate);
      if (!best || worst > best.worst) best = { hex: toHex(candidate), worst };
    }
  }
  // Nothing at this hue clears both surfaces — say so rather than returning
  // something that merely looks different.
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
