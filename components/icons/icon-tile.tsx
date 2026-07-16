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
        className,
      )}
    >
      {children}
    </span>
  );
}
