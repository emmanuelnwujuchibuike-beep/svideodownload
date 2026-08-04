/**
 * Universal Theme Engine™ — Profile Layout Studio (Feature 18 · Part 16).
 *
 * ── What Part 16 adds, and what it deliberately does NOT rebuild ──────────
 * Show/hide, reorder, per-section audience and the landing section already ship
 * (Part 14's `profile_modules`). A single accent colour already ships (Part 10).
 * This layer is the part that was missing: a THEME — a coordinated surface
 * material, corner radius, typography scale and accent that move together, so a
 * profile reads as designed rather than as six unrelated switches.
 *
 * ── Why themes emit CSS variables instead of class names ──────────────────
 * A theme resolves to a handful of custom properties set on ONE wrapper element.
 * Everything inside inherits them, so:
 *   · switching theme is a style recalculation, not a re-render or a re-fetch;
 *   · a visitor's profile cannot leak its theme into the app chrome around it,
 *     because the variables are scoped to that subtree;
 *   · nothing here can grow the CSS bundle — there is no per-theme stylesheet,
 *     and adding the 11th theme costs one array entry, not another class tree.
 *
 * ── The quality floor ─────────────────────────────────────────────────────
 * "Freedom without chaos" is only real if the system can say no. Every theme
 * here is authored against the brand tokens, accents are validated by
 * `color.ts`'s WCAG maths rather than accepted blindly, and the font scale is
 * BOUNDED — a member cannot pick a size that breaks their own layout or drops
 * body text under the readable minimum.
 *
 * Pure: no React, no Supabase, no I/O.
 */

import { accessibleAccent, checkAccent } from "@/lib/profile/color";

export type ProfileThemeKey =
  | "classic"
  | "minimal"
  | "glass"
  | "titanium"
  | "carbon"
  | "aurora"
  | "midnight"
  | "ocean"
  | "sunrise"
  | "forest";

export interface ProfileThemeSpec {
  key: ProfileThemeKey;
  label: string;
  blurb: string;
  /** The theme's own accent. A member's explicit accent overrides it. */
  accent: string;
  /** Decorative cover wash — two stops, used as a gradient behind the hero. */
  wash: [string, string];
  /** Surface treatment for cards inside the profile. */
  surface: SurfaceKey;
  radius: RadiusKey;
}

export type SurfaceKey = "solid" | "glass" | "floating" | "outlined";
export type RadiusKey = "sharp" | "soft" | "rounded" | "pill";
export type FontScaleKey = "compact" | "default" | "comfortable" | "large";

export const PROFILE_THEMES: ProfileThemeSpec[] = [
  {
    key: "classic",
    label: "Classic",
    blurb: "The Frenz look. Electric blue on a calm surface.",
    accent: "#0A84FF",
    wash: ["#0A84FF", "#6C4DFF"],
    surface: "solid",
    radius: "rounded",
  },
  {
    key: "minimal",
    label: "Minimal",
    blurb: "Quiet and typographic. Hairlines instead of shadows.",
    accent: "#6B7280",
    wash: ["#9CA3AF", "#4B5563"],
    surface: "outlined",
    radius: "soft",
  },
  {
    key: "glass",
    label: "Glass",
    blurb: "Frosted, translucent surfaces with a luminous edge.",
    accent: "#6C4DFF",
    wash: ["#6C4DFF", "#0A84FF"],
    surface: "glass",
    radius: "rounded",
  },
  {
    key: "titanium",
    label: "Titanium",
    blurb: "Brushed metal neutrals with a cool sheen.",
    accent: "#64748B",
    wash: ["#94A3B8", "#475569"],
    surface: "floating",
    radius: "soft",
  },
  {
    key: "carbon",
    label: "Carbon",
    blurb: "Deep graphite. Built for dark mode.",
    accent: "#0284C7",
    wash: ["#1F2937", "#0B1220"],
    surface: "solid",
    radius: "sharp",
  },
  {
    key: "aurora",
    label: "Aurora",
    blurb: "Shifting green-violet light.",
    accent: "#059669",
    wash: ["#10B981", "#6C4DFF"],
    surface: "glass",
    radius: "pill",
  },
  {
    key: "midnight",
    label: "Midnight",
    blurb: "Space navy with a single bright accent.",
    accent: "#6366F1",
    wash: ["#1E1B4B", "#050816"],
    surface: "floating",
    radius: "rounded",
  },
  {
    key: "ocean",
    label: "Ocean",
    blurb: "Deep teal and cyan.",
    accent: "#0891B2",
    wash: ["#06B6D4", "#0E7490"],
    surface: "glass",
    radius: "rounded",
  },
  {
    key: "sunrise",
    label: "Sunrise",
    blurb: "Warm amber into rose.",
    accent: "#EA580C",
    wash: ["#F59E0B", "#F43F5E"],
    surface: "floating",
    radius: "pill",
  },
  {
    key: "forest",
    label: "Forest",
    blurb: "Moss and deep green.",
    accent: "#15803D",
    wash: ["#22C55E", "#166534"],
    surface: "solid",
    radius: "soft",
  },
];

const THEME_BY_KEY = new Map(PROFILE_THEMES.map((t) => [t.key, t]));
export const DEFAULT_THEME: ProfileThemeKey = "classic";

export function profileTheme(key: string | null | undefined): ProfileThemeSpec {
  return THEME_BY_KEY.get((key ?? "") as ProfileThemeKey) ?? THEME_BY_KEY.get(DEFAULT_THEME)!;
}

export const PROFILE_THEME_KEYS = PROFILE_THEMES.map((t) => t.key) as [ProfileThemeKey, ...ProfileThemeKey[]];

/* ─────────────────────────── surfaces ─────────────────────────── */

export const SURFACES: { key: SurfaceKey; label: string; blurb: string }[] = [
  { key: "solid", label: "Solid", blurb: "Opaque cards with a soft shadow." },
  { key: "glass", label: "Glass", blurb: "Frosted and translucent." },
  { key: "floating", label: "Floating", blurb: "Lifted, with a deeper shadow." },
  { key: "outlined", label: "Outlined", blurb: "Hairline borders, no shadow." },
];
export const SURFACE_KEYS = SURFACES.map((s) => s.key) as [SurfaceKey, ...SurfaceKey[]];

/** rem values. Bounded: nothing here can produce a card that isn't a card. */
export const RADII: { key: RadiusKey; label: string; rem: number }[] = [
  { key: "sharp", label: "Sharp", rem: 0.5 },
  { key: "soft", label: "Soft", rem: 1 },
  { key: "rounded", label: "Rounded", rem: 1.5 },
  { key: "pill", label: "Pill", rem: 2 },
];
export const RADIUS_KEYS = RADII.map((r) => r.key) as [RadiusKey, ...RadiusKey[]];

/**
 * Typography scale.
 *
 * Deliberately narrow (0.94–1.15). A profile is read by other people, so a
 * member cannot shrink their own text below the point where it stops being
 * legible, nor inflate it until the layout breaks on a phone. Someone who needs
 * genuinely large text should use their OS's Dynamic Type, which this respects
 * because everything is in rem — scaling here multiplies that rather than
 * overriding it.
 */
export const FONT_SCALES: { key: FontScaleKey; label: string; scale: number }[] = [
  { key: "compact", label: "Compact", scale: 0.94 },
  { key: "default", label: "Default", scale: 1 },
  { key: "comfortable", label: "Comfortable", scale: 1.07 },
  { key: "large", label: "Large", scale: 1.15 },
];
export const FONT_SCALE_KEYS = FONT_SCALES.map((f) => f.key) as [FontScaleKey, ...FontScaleKey[]];

/* ──────────────────────────── resolve ─────────────────────────── */

export interface StoredAppearance {
  theme: string | null;
  surface: string | null;
  radius: string | null;
  fontScale: string | null;
  /** The member's own accent (Part 10), which overrides the theme's. */
  accent: string | null;
}

export interface ResolvedTheme {
  spec: ProfileThemeSpec;
  surface: SurfaceKey;
  radius: RadiusKey;
  fontScale: FontScaleKey;
  /** The accent actually used, after accessibility correction. */
  accent: string;
  /** True when the requested accent failed contrast and was corrected. */
  accentCorrected: boolean;
  /** Custom properties for the profile wrapper. */
  vars: Record<string, string>;
}

/**
 * Turns stored preferences into something renderable.
 *
 * Unknown values fall back rather than throwing — a row written by a newer
 * version, or hand-edited, must never break someone's profile for every viewer.
 *
 * The accent is CORRECTED, not merely reported: a member who picked a colour
 * that is invisible on one theme gets the nearest lightness of their own hue
 * that works. Rendering the unreadable version and quietly flagging it in
 * settings would push the cost of the mistake onto readers who can't fix it.
 */
export function resolveProfileTheme(stored: StoredAppearance): ResolvedTheme {
  const spec = profileTheme(stored.theme);
  const surface = (SURFACES.find((s) => s.key === stored.surface)?.key ?? spec.surface) as SurfaceKey;
  const radiusKey = (RADII.find((r) => r.key === stored.radius)?.key ?? spec.radius) as RadiusKey;
  const fontScaleKey = (FONT_SCALES.find((f) => f.key === stored.fontScale)?.key ?? "default") as FontScaleKey;

  const requested = stored.accent?.trim() || spec.accent;
  const report = checkAccent(requested);
  let accent = report?.hex ?? spec.accent;
  let accentCorrected = false;
  if (report && !report.usableAsAccent) {
    const fixed = accessibleAccent(requested);
    if (fixed) {
      accent = fixed;
      accentCorrected = true;
    }
  }

  const radiusRem = RADII.find((r) => r.key === radiusKey)!.rem;
  const scale = FONT_SCALES.find((f) => f.key === fontScaleKey)!.scale;

  return {
    spec,
    surface,
    radius: radiusKey,
    fontScale: fontScaleKey,
    accent,
    accentCorrected,
    vars: {
      "--frenz-profile-accent": accent,
      "--frenz-profile-wash-from": spec.wash[0],
      "--frenz-profile-wash-to": spec.wash[1],
      "--frenz-profile-radius": `${radiusRem}rem`,
      "--frenz-profile-font-scale": String(scale),
      ...SURFACE_VARS[surface],
    },
  };
}

/**
 * Per-surface card treatment.
 *
 * `backdrop-filter` appears ONLY on the glass surface, and that is a deliberate
 * limit rather than an oversight: it is the most expensive property here on a
 * mid-range phone, and it creates a containing block that breaks `position:
 * fixed` descendants — a bug this codebase has already been bitten by. One
 * opt-in surface carries that cost; the other three never pay it.
 */
const SURFACE_VARS: Record<SurfaceKey, Record<string, string>> = {
  solid: {
    "--frenz-profile-card-bg": "hsl(var(--card))",
    "--frenz-profile-card-border": "1px solid hsl(var(--border) / 0.7)",
    "--frenz-profile-card-shadow": "0 1px 2px hsl(229 55% 3% / 0.06)",
    "--frenz-profile-card-blur": "none",
  },
  glass: {
    "--frenz-profile-card-bg": "hsl(var(--card) / 0.6)",
    "--frenz-profile-card-border": "1px solid hsl(var(--border) / 0.5)",
    "--frenz-profile-card-shadow": "inset 0 1px 0 hsl(0 0% 100% / 0.08), 0 8px 32px -12px hsl(229 55% 3% / 0.35)",
    "--frenz-profile-card-blur": "blur(14px)",
  },
  floating: {
    "--frenz-profile-card-bg": "hsl(var(--card))",
    "--frenz-profile-card-border": "1px solid hsl(var(--border) / 0.5)",
    "--frenz-profile-card-shadow": "0 18px 40px -20px hsl(229 55% 3% / 0.45)",
    "--frenz-profile-card-blur": "none",
  },
  outlined: {
    "--frenz-profile-card-bg": "transparent",
    "--frenz-profile-card-border": "1px solid hsl(var(--border))",
    "--frenz-profile-card-shadow": "none",
    "--frenz-profile-card-blur": "none",
  },
};
