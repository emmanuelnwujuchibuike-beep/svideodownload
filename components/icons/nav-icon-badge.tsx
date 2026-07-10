import { cloneElement, isValidElement, type ReactElement } from "react";

import { cn } from "@/lib/utils";

/**
 * The nav "3D premium badge" — every destination (active or not) sits on its
 * own tile instead of floating as a bare glyph, so the whole bar reads as a
 * designed icon system rather than a handful of flat line-art icons (the
 * "still looks the same" gap left by an earlier round, which only recolored
 * the ACTIVE icon's strokes via a gradient mask — invisible on the
 * 4-out-of-5 tabs that are inactive at any moment). Active: a solid
 * `foreground`-colored tile (dark in light mode, white in dark mode — a true
 * theme-adaptive invert, never a color) with a diagonal gloss highlight,
 * icon in `background` color. Inactive: a calm neutral glass tile, icon
 * muted. Owner correction (2026-07-10): the earlier version used the brand
 * blue→violet gradient here — reported as "too much purple splashing" across
 * every nav/topbar/module icon at once — replaced with this monochrome
 * dark/white treatment (also the literal TikTok nav look: bold monochrome
 * icon, no colored badge).
 *
 * Takes a rendered element (not a component reference) and clones it, the
 * same mechanism `GradientIcon` used — works identically for the custom Frenz
 * icon set (no `color` prop, only `className`) and react-icons/lucide glyphs
 * (both default to `currentColor`), since only `className` is ever touched.
 */
export function NavIconBadge({
  icon,
  active,
  tileClassName,
  iconClassName,
}: {
  icon: ReactElement<{ className?: string }>;
  active: boolean;
  tileClassName?: string;
  iconClassName?: string;
}) {
  const glyph = isValidElement(icon)
    ? cloneElement(icon, {
        className: cn(active ? "text-background drop-shadow-sm" : "text-muted-foreground", iconClassName),
      })
    : icon;

  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl transition-colors duration-200",
        active
          ? "bg-foreground shadow-[0_4px_14px_-2px] shadow-foreground/40 ring-1 ring-inset ring-background/20"
          : "bg-secondary/60 ring-1 ring-inset ring-border/50",
        tileClassName,
      )}
    >
      {active ? (
        <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/25 via-transparent to-transparent" />
      ) : null}
      <span className="relative flex items-center justify-center">{glyph}</span>
    </span>
  );
}
