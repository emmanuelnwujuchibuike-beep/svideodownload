import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

/**
 * A section-header / menu-row icon: a bare, high-contrast glyph.
 *
 * Owner correction (2026-07-16): "remove all blue icon back from all pages …
 * and all to a whatsapp ios app kind of emoji without background color, and
 * make the icon have high icon contrast to be darker."
 *
 * So there is no tile any more — no gradient, no gloss, no ring, no shadow.
 * This used to paint `.bg-brand-tile` (a dark blue→purple gradient) or, with
 * `tone="vivid"`, the fully-lit `.bg-brand` sweep, with a small white glyph
 * sitting on it. That treatment is what the owner is pointing at: on Messages,
 * the chat options sheet and the account menu, every row icon carried a blue
 * block behind it.
 *
 * What's left is the iOS/WhatsApp convention: the glyph itself, in the
 * foreground color, at full contrast — near-black in light mode, white in
 * dark. `text-foreground` (not `/85`, not `text-muted-foreground`) is the
 * "darker, high contrast" part of the ask and is deliberate.
 *
 * The size props still shape the icon's FOOTPRINT (call sites pass e.g.
 * `h-9 w-9`) so surrounding layout/alignment is unchanged; only the paint is
 * gone. `iconClassName` overrides the glyph size for the few larger spots.
 */
export function ModuleIconBadge({
  icon: Icon,
  className,
  iconClassName,
}: {
  icon: ComponentType<{ className?: string }>;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span className={cn("relative flex h-7 w-7 shrink-0 items-center justify-center text-foreground", className)}>
      <Icon className={cn("h-5 w-5", iconClassName)} />
    </span>
  );
}
