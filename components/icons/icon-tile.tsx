import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The resting-state counterpart to `NavIconBadge` for topbar action buttons
 * (search, create, notifications) that don't have a route-active/inactive
 * state — a glass tile (gradient + gloss + soft shadow) instead of the flat
 * single-tone `bg-secondary/50` circle every one of these used before, which
 * read as plain regardless of the nav polish elsewhere. `tint="brand"` is for
 * the single highest-value action on a given bar (Create; the bell while
 * unread) — everything else stays a calm neutral glass so the accent color
 * still means something.
 */
export function IconTile({
  children,
  tint = "neutral",
  className,
}: {
  children: ReactNode;
  tint?: "neutral" | "brand";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative flex h-full w-full items-center justify-center overflow-hidden rounded-full",
        tint === "brand"
          ? "bg-gradient-to-br from-blue-500 to-violet-600 shadow-[0_3px_10px_-2px] shadow-violet-600/50"
          : "bg-gradient-to-b from-white/10 via-secondary/70 to-secondary/40 shadow-[0_1px_6px_-2px] shadow-black/20 ring-1 ring-inset ring-white/10",
        className,
      )}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/25 via-transparent to-transparent" />
      <span className={cn("relative flex items-center justify-center", tint === "brand" ? "text-white drop-shadow-sm" : "text-foreground/85")}>
        {children}
      </span>
    </span>
  );
}
