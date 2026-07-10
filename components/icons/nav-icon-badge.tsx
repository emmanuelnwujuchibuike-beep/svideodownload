import { cloneElement, isValidElement, type ReactElement } from "react";

import { cn } from "@/lib/utils";

/**
 * The nav "3D premium badge" — every destination (active or not) sits on its
 * own tile instead of floating as a bare glyph, so the whole bar reads as a
 * designed icon system rather than a handful of flat line-art icons (the
 * "still looks the same" gap left by the previous round, which only
 * recolored the ACTIVE icon's strokes via a gradient mask — invisible on the
 * 4-out-of-5 tabs that are inactive at any moment). Active: a brand-gradient
 * tile with a diagonal gloss highlight + colored glow shadow, icon in solid
 * white. Inactive: a calm neutral glass tile, icon muted — present enough to
 * read as "designed", restrained enough not to compete with the active tab.
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
        className: cn(active ? "text-white drop-shadow-sm" : "text-muted-foreground", iconClassName),
      })
    : icon;

  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl transition-colors duration-200",
        active
          ? "bg-gradient-to-br from-blue-500 to-violet-600 shadow-[0_4px_14px_-2px] shadow-violet-600/50 ring-1 ring-inset ring-white/25"
          : "bg-secondary/60 ring-1 ring-inset ring-border/50",
        tileClassName,
      )}
    >
      {active ? (
        <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/30 via-white/5 to-transparent" />
      ) : null}
      <span className="relative flex items-center justify-center">{glyph}</span>
    </span>
  );
}
