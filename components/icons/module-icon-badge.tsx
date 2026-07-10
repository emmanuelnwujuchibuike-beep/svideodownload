import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

/**
 * The "premium 3D" glass-badge treatment for a Home module's section header
 * icon (Continue Watching / Friend Activity / Trending Reels), and for
 * menu/dropdown rows (account menu, marketing header's drawer) — a tile with
 * a diagonal gloss highlight and a soft shadow, replacing what was either a
 * bare `text-primary` icon with no background at all, or (Trending Reels) a
 * flat single-tone `bg-secondary` tile. Same visual language as
 * `NavIconBadge`'s active state, reused here at a smaller size. Owner
 * correction (2026-07-10): was the blue→violet brand gradient — reported as
 * "too much purple splashing" — now a solid `foreground` tile (dark in light
 * mode, white in dark mode) with the icon in `background` color.
 */
export function ModuleIconBadge({ icon: Icon, className }: { icon: ComponentType<{ className?: string }>; className?: string }) {
  return (
    <span
      className={cn(
        "relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-foreground shadow-[0_3px_10px_-2px] shadow-foreground/40 ring-1 ring-inset ring-background/20",
        className,
      )}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/25 via-transparent to-transparent" />
      <Icon className="relative h-3.5 w-3.5 text-background drop-shadow-sm" />
    </span>
  );
}
