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
 * "too much purple splashing" — became a solid `foreground` tile. Owner
 * correction (2026-07-11): brand color back, as the "dark premium"
 * `.bg-brand-tile` gradient (globals.css), fixed white icon.
 */
export function ModuleIconBadge({ icon: Icon, className }: { icon: ComponentType<{ className?: string }>; className?: string }) {
  return (
    <span
      className={cn(
        "relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand-tile shadow-[0_3px_10px_-2px] shadow-[hsl(var(--brand-purple)/0.45)] ring-1 ring-inset ring-white/10",
        className,
      )}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/20 via-transparent to-transparent" />
      <Icon className="relative h-3.5 w-3.5 text-white drop-shadow-sm" />
    </span>
  );
}
