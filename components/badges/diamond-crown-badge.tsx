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

  // Refined, jewel-like gradients with a metallic depth (Telegram/Snapchat-grade).
  const gradient = business
    ? "bg-gradient-to-br from-amber-200 via-yellow-400 to-amber-600 text-amber-950 ring-amber-100/70 shadow-amber-500/40"
    : "bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-500 text-white ring-sky-100/60 shadow-blue-500/40";

  // A subtle top-highlight sheen gives the badge a polished, three-dimensional
  // "gem" finish instead of a flat pill — the premium cue the owner asked for.
  const sheen = (
    <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/55 via-white/10 to-transparent" />
  );

  if (showLabel) {
    return (
      <span
        title={title}
        aria-label={title}
        className={cn(
          "relative inline-flex items-center overflow-hidden rounded-full font-bold tracking-wide shadow-sm ring-1",
          dims.pad,
          dims.text,
          gradient,
          className,
        )}
      >
        {sheen}
        <Icon className={cn("relative", dims.icon)} aria-hidden /> <span className="relative">{label}</span>
      </span>
    );
  }

  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full shadow-sm ring-1",
        dims.box,
        gradient,
        className,
      )}
    >
      {sheen}
      <Icon className={cn("relative", dims.icon)} aria-hidden />
    </span>
  );
}
