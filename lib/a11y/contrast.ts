/**
 * Accessibility Validator™ — WCAG 2.2 contrast (Feature 18 · Part 22).
 *
 * ── Why this is the part of the Validator that ships ─────────────────────────
 * The brief asks for a validator that scores contrast, touch targets, captions,
 * alt text, keyboard access and localisation. Contrast is the one with an EXACT
 * specification: WCAG defines relative luminance and the contrast ratio as
 * formulas with published reference values, so it can be implemented correctly
 * and proven against them.
 *
 * What deliberately does NOT ship is a DOM crawler that scores a live page. To
 * know a real contrast ratio you must know what a colour is actually sitting
 * on — through layered translucency, gradients and images — and a checker that
 * guesses the backdrop produces confident wrong numbers. That is exactly the
 * failure the analytics audit spent a day removing, and a score built on an
 * unreliable measurement is worse than no score at all.
 *
 * So: the maths, exact and tested. The crawler is a later part with a real
 * strategy for backdrop resolution.
 *
 * Pure — no DOM, no React. Every rule below is directly testable.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse `#rgb`, `#rrggbb`, or `rgb()/rgba()`. Returns null for anything else.
 *
 * Null rather than a default colour on purpose: a caller that cannot parse an
 * input must not be handed black and told it is fine. Unknown is a real answer.
 */
export function parseColor(input: string): Rgb | null {
  const s = input.trim().toLowerCase();

  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1]!;
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    };
  }

  const rgb = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((n) => Number(n));
    if ([r, g, b].some((n) => !Number.isFinite(n) || n! < 0 || n! > 255)) return null;
    return { r: r!, g: g!, b: b! };
  }

  return null;
}

/**
 * Relative luminance, per WCAG 2.x §relative-luminance.
 *
 * The 0.03928 threshold and the 2.4 exponent are the specification's numbers,
 * not an approximation — sRGB's actual transfer function differs slightly, and
 * using the "more correct" curve here would produce ratios that disagree with
 * every other conformance tool. Matching the spec is the point.
 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Contrast ratio between two colours: 1 (identical) to 21 (black on white).
 *
 * Order-independent by construction — the lighter colour always takes the
 * numerator, so callers cannot get a different answer by swapping foreground
 * and background.
 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export type ContrastLevel = "fail" | "AA-large" | "AA" | "AAA";

/**
 * Large text, per WCAG: 18pt, or 14pt when bold.
 *
 * Expressed in CSS px because that is what a component actually has. 18pt is
 * 24px and 14pt is 18.66px — the odd-looking 18.66 is the real conversion, not
 * a rounding slip.
 */
export function isLargeText(fontSizePx: number, bold = false): boolean {
  return bold ? fontSizePx >= 18.66 : fontSizePx >= 24;
}

/**
 * Grade a ratio against WCAG 2.2.
 *
 * Normal text: 4.5 for AA, 7 for AAA. Large text: 3 for AA, 4.5 for AAA.
 *
 * `AA-large` exists as its own level rather than collapsing into `fail` or `AA`
 * because it is genuinely different information: a 3.2:1 ratio is a PASS on a
 * heading and a FAIL on body copy, and a grader that cannot say which is being
 * measured cannot be acted on.
 */
export function gradeContrast(ratio: number, large = false): ContrastLevel {
  if (large) {
    if (ratio >= 4.5) return "AAA";
    if (ratio >= 3) return "AA";
    return "fail";
  }
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA-large";
  return "fail";
}

export interface ContrastCheck {
  ratio: number;
  level: ContrastLevel;
  passesAA: boolean;
  passesAAA: boolean;
  /** Plain-language summary — this is what a creator is shown, not a number. */
  summary: string;
}

/**
 * The full check for one foreground/background pair.
 *
 * Returns null when either colour cannot be parsed. A validator that reports
 * "pass" for a colour it failed to read is worse than one that admits it does
 * not know.
 */
export function checkContrast(
  foreground: string,
  background: string,
  opts: { fontSizePx?: number; bold?: boolean } = {},
): ContrastCheck | null {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return null;

  const large = isLargeText(opts.fontSizePx ?? 16, opts.bold ?? false);
  const raw = contrastRatio(fg, bg);
  // One decimal, matching how every conformance tool reports it. Rounded DOWN
  // so a 4.499 never reports as the 4.5 that would claim an AA pass.
  const ratio = Math.floor(raw * 10) / 10;
  const level = gradeContrast(ratio, large);

  const need = large ? 3 : 4.5;
  const summary =
    level === "fail"
      ? `${ratio}:1 — too low. ${large ? "Large" : "Body"} text needs at least ${need}:1.`
      : level === "AA-large"
        ? `${ratio}:1 — passes only for large text (18pt+, or 14pt bold).`
        : level === "AA"
          ? `${ratio}:1 — meets AA.`
          : `${ratio}:1 — meets AAA.`;

  return {
    ratio,
    level,
    passesAA: large ? ratio >= 3 : ratio >= 4.5,
    passesAAA: large ? ratio >= 4.5 : ratio >= 7,
    summary,
  };
}

/**
 * WCAG 2.2 §2.5.8 Target Size (Minimum) — AA asks 24×24 CSS px.
 *
 * 44 is reported separately as the AAA / Apple HIG figure. Both are offered
 * because they answer different questions: 24 is the legal floor, 44 is the one
 * that actually works for someone with a tremor on a moving bus.
 */
export const TARGET_MIN_AA = 24;
export const TARGET_MIN_AAA = 44;

export function checkTargetSize(widthPx: number, heightPx: number): {
  passesAA: boolean;
  passesAAA: boolean;
  summary: string;
} {
  const smallest = Math.min(widthPx, heightPx);
  const passesAA = smallest >= TARGET_MIN_AA;
  const passesAAA = smallest >= TARGET_MIN_AAA;
  return {
    passesAA,
    passesAAA,
    summary: passesAAA
      ? `${Math.round(smallest)}px — comfortable on any device.`
      : passesAA
        ? `${Math.round(smallest)}px — meets the ${TARGET_MIN_AA}px minimum, but ${TARGET_MIN_AAA}px is easier to hit.`
        : `${Math.round(smallest)}px — below the ${TARGET_MIN_AA}px minimum.`,
  };
}
