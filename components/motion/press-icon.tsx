import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Frenz Motion wrapper for interactive glyphs: a physical "press into the
 * surface" compression on tap (slight scale-down + downward nudge, like a
 * real button depressing) that springs back up with a small overshoot pop
 * whenever `active` flips on (a lift, not just a resize — reads as the icon
 * becoming raised/selected rather than merely growing). Respects
 * prefers-reduced-motion by disabling both.
 *
 * Pure CSS (`.frenz-press-icon` in globals.css) since 2026-10-26: this sits in the
 * bottom nav on every marketing page, and as a framer-motion component it put the
 * whole motion library into the landing's first scripts. The pop replays because
 * `data-active` is newly set when the tab becomes active.
 */
export function PressIcon({
  active = false,
  className,
  children,
}: {
  active?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    // No default `display` here on purpose: a display class or inline style could beat a
    // `hidden`/`sm:*` visibility class a caller passes in `className`, silently breaking
    // responsive show/hide.
    <span className={cn("frenz-press-icon", className)} data-active={active ? "" : undefined}>
      {children}
    </span>
  );
}
