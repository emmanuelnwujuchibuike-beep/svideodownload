import { BadgeCheck, Sparkles } from "lucide-react";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import type { BillingPlan } from "@/lib/monetization/types";
import { cn } from "@/lib/utils";

/**
 * The identity badge cluster that sits beside a name on the profile hero —
 * verification tick, plan (Pro / Business) and the Creator marker, as ONE
 * consistently-sized, wrapping row.
 *
 * Owner: "the profile hero card to be with the business and pro badge with
 * verification badge, well premium and organised like snapchat and telegram."
 * Telegram/Snapchat both put a small cluster of jewel-like markers immediately
 * after the name at a fixed rhythm, rather than badges of assorted sizes strewn
 * across the header — which is what the two hero blocks were doing (a 24px
 * scalloped tick on one, a 20px outline tick plus an unrelated pill on the other).
 *
 * Pure + presentational, so it is safe in a server tree.
 */

/** Telegram's filled blue seal, not an outline tick — the same mark everywhere. */
export function VerifiedTick({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  return (
    <span title="Verified account" className="inline-flex shrink-0">
      <BadgeCheck
        aria-label="Verified account"
        className={cn(
          "fill-blue-500 text-white drop-shadow-sm",
          size === "md" ? "h-[22px] w-[22px]" : "h-[18px] w-[18px]",
          className,
        )}
      />
    </span>
  );
}

export function IdentityBadges({
  verified,
  plan,
  /** The profile owner can hide their plan badge from visitors (privacy). */
  showPlan = true,
  creator = false,
  /** The member's own accent colour, used to tint the Creator chip when set. */
  accent,
  size = "md",
  className,
}: {
  verified: boolean;
  plan: BillingPlan;
  showPlan?: boolean;
  creator?: boolean;
  accent?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const plated = showPlan && plan !== "free";
  if (!verified && !plated && !creator) return null;

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5 align-middle", className)}>
      {verified ? <VerifiedTick size={size} /> : null}
      {/* A tick-sized jewel, not a labelled pill (owner, 2026-08-04). The plan
          is still announced — `title` and `aria-label` on the badge carry
          "Crown · Pro" / "Diamond Crown · Business" — so dropping the visible
          word costs nothing to a screen reader. */}
      {plated ? <DiamondCrownBadge plan={plan} size={size === "md" ? "md" : "sm"} /> : null}
      {creator ? (
        <span
          title="Creator"
          className={cn(
            "inline-flex items-center gap-1 rounded-full font-semibold",
            size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]",
            accent ? "" : "bg-violet-500/12 text-violet-600 dark:text-violet-300",
          )}
          style={accent ? { backgroundColor: `${accent}1f`, color: accent } : undefined}
        >
          <Sparkles className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} /> Creator
        </span>
      ) : null}
    </span>
  );
}
