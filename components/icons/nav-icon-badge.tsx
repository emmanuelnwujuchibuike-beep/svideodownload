import { cloneElement, isValidElement, type ReactElement } from "react";

import { cn } from "@/lib/utils";

/**
 * A sidebar nav destination icon: a bare, high-contrast glyph.
 *
 * Owner correction (2026-07-16): "remove all blue icon back from all pages …
 * and all to a whatsapp ios app kind of emoji without background color, and
 * make the icon have high icon contrast to be darker."
 *
 * The tile is gone. Active used to be a `.bg-brand-tile` blue→purple block
 * with a white glyph and a gloss highlight; inactive a neutral glass tile.
 * Both are now just the glyph, and active/inactive reads purely as icon
 * CONTRAST — full-strength `text-foreground` when active, `text-muted-
 * foreground` when not. That's the same inline-color-change vocabulary the
 * bottom nav already uses, and the iOS/WhatsApp convention: no chrome behind a
 * tab icon, the icon itself carries the state.
 *
 * Still takes a rendered element (not a component reference) and clones it, so
 * it works for the custom Frenz icon set (className-only) and lucide/
 * react-icons alike — only `className` is ever touched.
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
        className: cn(
          "transition-colors duration-200",
          active ? "text-foreground" : "text-muted-foreground",
          iconClassName,
        ),
      })
    : icon;

  return (
    <span className={cn("relative flex shrink-0 items-center justify-center", tileClassName)}>{glyph}</span>
  );
}
