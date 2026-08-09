import {
  Brush,
  Building2,
  Car,
  CircleDot,
  Flame,
  Gamepad2,
  Image as ImageIcon,
  Layers,
  Leaf,
  Moon,
  PawPrint,
  Rocket,
  Sparkles,
  Triangle,
  Waves,
  type LucideIcon,
} from "lucide-react";

/**
 * A glyph for each wallpaper category — the reference's pill row
 * (public/mainwallpaperpaage.jpg) gives Nature a leaf, Abstract a triangle,
 * Dark a moon and Anime a star.
 *
 * ── Why a lookup and not a column ─────────────────────────────────────────────
 * Categories are free text an operator types at upload time, so there is no
 * fixed set to enumerate and no icon field to fill in. A lookup keyed on the
 * lowercased name gives the common ones their icon for free, and anything
 * unrecognised gets the neutral picture glyph rather than an empty pill or a
 * wrong one. Adding a category in the admin panel needs no code change; adding
 * an ICON for it is one line here.
 *
 * Matching is on the whole name first, then on any word in it, so "Dark Mode"
 * and "Nature & Landscape" both resolve without needing their own entries.
 */
const ICONS: Record<string, LucideIcon> = {
  nature: Leaf,
  abstract: Triangle,
  dark: Moon,
  anime: Sparkles,
  space: Rocket,
  gradient: Waves,
  texture: Layers,
  minimal: CircleDot,
  art: Brush,
  city: Building2,
  cars: Car,
  car: Car,
  animals: PawPrint,
  animal: PawPrint,
  gaming: Gamepad2,
  games: Gamepad2,
  neon: Flame,
};

export function categoryIcon(category: string): LucideIcon {
  const name = category.trim().toLowerCase();
  const exact = ICONS[name];
  if (exact) return exact;
  for (const word of name.split(/[^a-z]+/)) {
    const hit = ICONS[word];
    if (hit) return hit;
  }
  return ImageIcon;
}
