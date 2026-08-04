/**
 * Layout Presets™ — a whole profile in one tap (Feature 18 · Part 16).
 *
 * ── Why presets exist at all ──────────────────────────────────────────────
 * By Part 16 a profile has a type, a module list with an order and a per-module
 * audience, a landing section, a theme, a surface, a radius and a type scale.
 * That is a lot of correct-but-separate switches, and the honest failure mode of
 * a customisation platform is that almost nobody uses it: the blank editor is
 * intimidating and the default stays forever.
 *
 * A preset is one decision that produces a coherent result — and it is a
 * STARTING POINT, not a mode. Applying one writes ordinary values a member can
 * then change individually; nothing is locked, and there is no "preset" state to
 * escape from later. That is what keeps this "freedom without chaos" rather than
 * a set of templates the product has to maintain forever.
 *
 * ── Every preset is expressed in terms that already exist ─────────────────
 * A preset is a profile TYPE (Part 14), an ordered module list (Part 14) and a
 * theme (this part). It introduces no new storage and no new rendering path, so
 * a preset can never drift from what the profile can actually do — if a module
 * is retired, `presets.test.ts` fails rather than a member applying a layout
 * that half-renders.
 *
 * Pure: no React, no Supabase.
 */

import type { ModuleKey } from "@/lib/profile/modules";
import type { ProfileTypeKey } from "@/lib/profile/profile-types";
import type { FontScaleKey, ProfileThemeKey, RadiusKey, SurfaceKey } from "@/lib/profile/theme";

export interface LayoutPreset {
  key: string;
  label: string;
  blurb: string;
  /** Lucide icon name, resolved by the UI. */
  icon: string;
  type: ProfileTypeKey;
  /** Enabled modules, in order. The first is the landing section. */
  modules: ModuleKey[];
  theme: ProfileThemeKey;
  surface: SurfaceKey;
  radius: RadiusKey;
  fontScale: FontScaleKey;
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    key: "minimal",
    label: "Minimal",
    blurb: "Just your posts and a short about. Nothing else.",
    icon: "Minus",
    type: "personal",
    modules: ["posts", "about"],
    theme: "minimal",
    surface: "outlined",
    radius: "soft",
    fontScale: "default",
  },
  {
    key: "creator",
    label: "Creator",
    blurb: "Lead with your work — reels, collections and what you've earned.",
    icon: "Sparkles",
    type: "creator",
    modules: ["posts", "reels", "collections", "achievements", "about"],
    theme: "aurora",
    surface: "glass",
    radius: "rounded",
    fontScale: "default",
  },
  {
    key: "photography",
    label: "Photography",
    blurb: "A gallery first. Big images, quiet chrome.",
    icon: "Camera",
    type: "professional",
    modules: ["portfolio", "posts", "about", "awards"],
    theme: "carbon",
    surface: "solid",
    radius: "sharp",
    fontScale: "compact",
  },
  {
    key: "portfolio",
    label: "Portfolio",
    blurb: "Projects, experience and credentials — built to be judged.",
    icon: "LayoutGrid",
    type: "professional",
    modules: ["about", "portfolio", "experience", "skills", "certifications", "resume"],
    theme: "titanium",
    surface: "floating",
    radius: "soft",
    fontScale: "default",
  },
  {
    key: "developer",
    label: "Developer",
    blurb: "What you've shipped, what you know, where you've worked.",
    icon: "Code2",
    type: "developer",
    modules: ["about", "portfolio", "skills", "experience", "certifications", "posts"],
    theme: "midnight",
    surface: "solid",
    radius: "sharp",
    fontScale: "compact",
  },
  {
    key: "business",
    label: "Business",
    blurb: "What you sell, when you're open and how to reach you.",
    icon: "Store",
    type: "business",
    modules: ["about", "catalog", "services", "hours", "posts"],
    theme: "ocean",
    surface: "solid",
    radius: "rounded",
    fontScale: "default",
  },
  {
    key: "student",
    label: "Student",
    blurb: "What you're learning and what you've built so far.",
    icon: "GraduationCap",
    type: "student",
    modules: ["about", "education", "portfolio", "certifications", "skills"],
    theme: "sunrise",
    surface: "floating",
    radius: "pill",
    fontScale: "comfortable",
  },
  {
    key: "community",
    label: "Community",
    blurb: "Say what the group is for, then show what it posts.",
    icon: "Users",
    type: "community",
    modules: ["about", "posts", "reels", "collections"],
    theme: "forest",
    surface: "solid",
    radius: "soft",
    fontScale: "default",
  },
];

const BY_KEY = new Map(LAYOUT_PRESETS.map((p) => [p.key, p]));

export function layoutPreset(key: string): LayoutPreset | undefined {
  return BY_KEY.get(key);
}

export const LAYOUT_PRESET_KEYS = LAYOUT_PRESETS.map((p) => p.key) as [string, ...string[]];
