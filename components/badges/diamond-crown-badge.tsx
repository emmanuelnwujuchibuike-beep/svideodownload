import { Crown, Gem } from "lucide-react";

import type { BillingPlan } from "@/lib/monetization/types";
import { cn } from "@/lib/utils";

/**
 * Diamond Crown status badge — the platform-wide premium marker. Drop it next to
 * any username, profile, post, comment, reel or business page.
 *
 * Tiering:
 *   business → Diamond Crown (platinum-gold)
 *   pro      → Crown (blue/cyan)
 *   free     → renders nothing
 *
 * Pure + presentational so it's safe in server OR client trees. For the current
 * viewer's badge, pair with `useEntitlements()` (see `MyDiamondCrownBadge`).
 */
export function DiamondCrownBadge({
  plan,
  size = "sm",
  showLabel = false,
  className,
}: {
  plan: BillingPlan;
  size?: "xs" | "sm" | "md";
  showLabel?: boolean;
  className?: string;
}) {
  if (plan === "free") return null;
  const business = plan === "business";

  const dims =
    size === "md"
      ? { box: "h-6 w-6", icon: "h-3.5 w-3.5", text: "text-xs", pad: "px-2.5 py-1 gap-1.5" }
      : size === "sm"
        ? { box: "h-5 w-5", icon: "h-3 w-3", text: "text-[11px]", pad: "px-2 py-0.5 gap-1" }
        : { box: "h-4 w-4", icon: "h-2.5 w-2.5", text: "text-[10px]", pad: "px-1.5 py-0.5 gap-1" };

  const Icon = business ? Gem : Crown;
  const label = business ? "Business" : "Pro";
  const title = business ? "Diamond Crown · Business" : "Crown · Pro";

  const gradient = business
    ? "bg-gradient-to-br from-amber-200 via-amber-400 to-amber-500 text-slate-900 ring-amber-200/50 shadow-amber-400/30"
    : "bg-gradient-to-br from-blue-500 to-cyan-400 text-white ring-white/30 shadow-blue-500/30";

  if (showLabel) {
    return (
      <span
        title={title}
        aria-label={title}
        className={cn(
          "inline-flex items-center rounded-full font-semibold uppercase tracking-wide shadow-sm ring-1",
          dims.pad,
          dims.text,
          gradient,
          className,
        )}
      >
        <Icon className={dims.icon} aria-hidden /> {label}
      </span>
    );
  }

  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full shadow-sm ring-1",
        dims.box,
        gradient,
        className,
      )}
    >
      <Icon className={dims.icon} aria-hidden />
    </span>
  );
}
