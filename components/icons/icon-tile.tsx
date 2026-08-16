import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A topbar action icon (search, create, notifications): a bare, high-contrast
 * glyph.
 *
 * Owner correction (2026-07-16): "remove all blue icon back from all pages …
 * and all to a whatsapp ios app kind of emoji without background color, and
 * make the icon have high icon contrast to be darker."
 *
 * The tile is gone — this used to be a glass circle (gradient + gloss + shadow
 * + ring), and with `tint="brand"` a `.bg-brand-tile` blue→purple block behind
 * a white glyph, which is what the Create/Download buttons read as. The `tint`
 * prop is deliberately removed rather than kept-and-ignored so no call site can
 * silently ask for a colored block that will never come back.
 *
 * `text-foreground` at full opacity (it was `text-foreground/85` under the
 * neutral tile) is the "darker, high contrast" half of the ask.
 */
export function IconTile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "relative flex h-full w-full items-center justify-center rounded-full text-foreground transition-colors",
        /*
          🔴 3D DEPTH (owner, 2026-08-16: "make the top nav in the landing
          pages, signed in pages, feed page and all to use the new bottom
          nav icon style and 3d style"). The bottom nav's redesign gave every
          glyph a static drop-shadow so it reads as lifted off the bar
          rather than flat-printed on it (see GLYPH_INACTIVE in
          features/app-shell/mobile-nav.tsx). `IconTile` is the one shared
          wrapper every top-header icon already goes through — AppTopbar's
          search/notification/theme/create, SiteHeader's icons, the
          notification bell — so the SAME filter here reaches all of them
          from one place instead of matching each header by hand.
        */
        "[filter:drop-shadow(0_2px_4px_rgba(2,6,23,0.22))]",
        className,
      )}
    >
      {children}
    </span>
  );
}
