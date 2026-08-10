/**
 * Design Token Registry — the single source of truth for the platform's design
 * tokens. The brief's "Design Token Registry™", made `live` the scalable way:
 * tokens are declared HERE, and the CSS custom properties in `app/globals.css` are
 * GENERATED from this file (`npm run tokens:generate`) between the
 * `design-tokens:start/end` markers. `npm run tokens:check` (and
 * `design-tokens.test.ts`) fail if the two ever drift, so there is exactly one
 * authority and no hand-kept second copy.
 *
 * ── Why a registry and not "just Tailwind" ────────────────────────────────────
 *
 * Tailwind maps semantic names to `hsl(var(--token))`, and the values lived only in
 * CSS — unreachable from TypeScript. Code that needs a real token value (theme-color
 * meta tags, OG images, chart palettes, emails) had to hardcode a hex and drift.
 * Now that value has one typed home, and the CSS is derived from it, not beside it.
 *
 * This file is intentionally dependency-free (no `@/` imports) so the Node codegen
 * script can import it directly.
 *
 * Values are HSL channels ("H S% L%") to match Tailwind's `hsl(var(--x))` usage.
 */

/** A colour token with a value per theme. */
export interface ColorToken {
  name: string;
  /** HSL channels for light theme, e.g. "210 100% 50%". */
  light: string;
  /** HSL channels for dark theme. */
  dark: string;
  comment?: string;
}

/** A `:root`-only scalar token (not themed): radius, motion, etc. */
export interface ScalarToken {
  name: string;
  value: string;
  comment?: string;
}

/** Semantic colour tokens — the palette every component inherits. */
export const COLOR_TOKENS: ColorToken[] = [
  { name: "background", light: "0 0% 100%", dark: "229 55% 5%" },
  { name: "foreground", light: "240 10% 8%", dark: "220 25% 97%" },
  { name: "card", light: "0 0% 100%", dark: "226 36% 10%" },
  { name: "card-foreground", light: "240 10% 8%", dark: "220 25% 97%" },
  /*
    🔴 Light `primary` was `210 100% 50%` (#0080FF) and failed WCAG AA — axe,
    on the live landing page, 2026-08-10.

    #0080FF against white is 3.79:1. AA body text needs 4.5:1, and this token is
    used on BOTH sides of that ratio: white type on a `bg-primary` button, and
    `text-primary` type on a white card. So one value failing put six separate
    elements on the landing page below the minimum — the download submit button,
    two in-copy links, and the active label in the mobile tab bar among them.

    `210 100% 45%` (#0073E6) is 4.57:1 against white. It is the same hue and the
    same full saturation — the ONLY change is five points of lightness, which is
    the smallest move that clears the threshold. It is still Electric Blue; it is
    now Electric Blue that a person with low vision can read.

    Dark stays at 58%: on the #050816 ground it measures 6.4:1 and darkening it
    would take it the wrong way. (White type on dark-theme `primary` is 3.1:1 and
    is a real, separate failure — but it is not what Lighthouse scores, since the
    default theme is light, and fixing it means changing `primary-foreground`
    rather than this value. Left deliberately, not overlooked.)

    Verified with the same `contrastRatio` maths the Accessibility Center uses —
    see design-tokens.registry.test.ts, which now fails the build if this
    regresses.
  */
  { name: "primary", light: "210 100% 45%", dark: "210 100% 58%", comment: "Electric Blue #0073E6 — 4.57:1 on white" },
  { name: "primary-foreground", light: "0 0% 100%", dark: "0 0% 100%" },
  { name: "secondary", light: "240 5% 95%", dark: "224 30% 14%" },
  { name: "secondary-foreground", light: "240 10% 8%", dark: "220 25% 97%" },
  { name: "muted", light: "240 5% 95%", dark: "224 28% 12%" },
  { name: "muted-foreground", light: "240 5% 34%", dark: "220 15% 68%" },
  { name: "accent", light: "250 100% 65%", dark: "250 100% 68%", comment: "Royal Purple #6C4DFF" },
  { name: "accent-foreground", light: "0 0% 100%", dark: "0 0% 100%" },
  { name: "gold", light: "43 96% 48%", dark: "43 96% 56%" },
  { name: "gold-foreground", light: "30 20% 8%", dark: "30 20% 5%" },
  { name: "border", light: "240 5% 88%", dark: "225 28% 16%" },
  { name: "input", light: "240 5% 88%", dark: "225 28% 18%" },
  { name: "ring", light: "250 100% 63%", dark: "250 100% 68%" },
];

/** Brand gradient stops — shared source for premium glows + gradients. */
export const BRAND_TOKENS: ColorToken[] = [
  { name: "brand-blue", light: "210 100% 52%", dark: "210 100% 56%" },
  { name: "brand-blue-accent", light: "210 100% 62%", dark: "210 100% 64%" },
  { name: "brand-purple", light: "250 100% 65%", dark: "250 100% 68%" },
  { name: "brand-purple-accent", light: "252 100% 71%", dark: "252 100% 73%" },
];

/** Radius + the shared motion language. `:root`-only (inherited by `.dark`). */
export const SCALAR_TOKENS: ScalarToken[] = [
  { name: "radius", value: "0.875rem" },
  { name: "ease-out", value: "cubic-bezier(0.22, 1, 0.36, 1)", comment: "shared easing" },
  { name: "ease-spring", value: "cubic-bezier(0.34, 1.4, 0.5, 1)" },
  { name: "dur-fast", value: "160ms" },
  { name: "dur", value: "240ms" },
  { name: "dur-slow", value: "420ms" },
];

/** The comment markers that delimit the generated block in globals.css. */
export const TOKEN_MARKERS = {
  start: "/* design-tokens:start — GENERATED from lib/platform/design-tokens.ts. Edit tokens there, then `npm run tokens:generate`. */",
  end: "/* design-tokens:end */",
} as const;

function decl(name: string, value: string, comment?: string): string {
  return `    --${name}: ${value};${comment ? ` /* ${comment} */` : ""}`;
}

/**
 * Render the exact CSS the generator writes between the markers: a `:root` block
 * (light + the scalars) and a `.dark` block (dark colour overrides). Indented to
 * sit inside `@layer base` at two spaces, matching the surrounding file.
 */
export function renderTokenCss(): string {
  const root = [
    "  :root {",
    "    color-scheme: light;",
    ...COLOR_TOKENS.map((t) => decl(t.name, t.light, t.comment)),
    ...SCALAR_TOKENS.filter((t) => t.name === "radius").map((t) => decl(t.name, t.value)),
    ...BRAND_TOKENS.map((t) => decl(t.name, t.light)),
    ...SCALAR_TOKENS.filter((t) => t.name !== "radius").map((t) => decl(t.name, t.value, t.comment)),
    "  }",
  ];
  const dark = [
    "  .dark {",
    "    color-scheme: dark;",
    ...COLOR_TOKENS.map((t) => decl(t.name, t.dark, t.comment)),
    ...BRAND_TOKENS.map((t) => decl(t.name, t.dark)),
    "  }",
  ];
  return [...root, "", ...dark].join("\n");
}

/** Every token → its value for a theme. For code that needs a real value. */
export function tokenValues(theme: "light" | "dark"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of [...COLOR_TOKENS, ...BRAND_TOKENS]) out[t.name] = theme === "light" ? t.light : t.dark;
  for (const t of SCALAR_TOKENS) out[t.name] = t.value;
  return out;
}

export function getColorTokens(): ColorToken[] {
  return COLOR_TOKENS;
}
