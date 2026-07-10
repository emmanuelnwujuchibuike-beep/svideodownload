import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

/**
 * The "premium 3D" glass-badge treatment for a Home module's section header
 * icon (Continue Watching / Friend Activity / Trending Reels) — a colored
 * gradient tile with a diagonal gloss highlight and a soft colored shadow,
 * replacing what was either a bare `text-primary` icon with no background at
 * all, or (Trending Reels) a flat single-tone `bg-secondary` tile. Same
 * visual language as `NavIconBadge`'s active state, reused here at a smaller
 * size for section headers rather than nav destinations.
 */
export function ModuleIconBadge({ icon: Icon, className }: { icon: ComponentType<{ className?: string }>; className?: string }) {
  return (
    <span
      className={cn(
        "relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 shadow-[0_3px_10px_-2px] shadow-violet-600/50 ring-1 ring-inset ring-white/20",
        className,
      )}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/30 via-transparent to-transparent" />
      <Icon className="relative h-3.5 w-3.5 text-white drop-shadow-sm" />
    </span>
  );
}
