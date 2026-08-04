import { BadgeCheck } from "lucide-react";

import type { BillingPlan } from "@/lib/monetization/types";
import { cn } from "@/lib/utils";

/**
 * Plan status badge — the platform-wide premium marker. Drop it next to any
 * username, profile, post, comment, reel or business page.
 *
 * ── Shape and colour (owner, 2026-08-04) ──────────────────────────────────
 * "Reduce the size of the pro and business badge, make the badge like a tick
 * like Snapchat rather than a long flat badge... also the rectangle badge that
 * says pro and business... make it to be like a tick but a different colour
 * and not the blue verified tick."
 *
 * So it is now the same scalloped seal as the verification tick, at the same
 * rhythm beside a name, in a colour that is unmistakably NOT the verified
 * blue:
 *
 *   business → gold. The top tier, and the one colour nothing else on a
 *              profile uses.
 *   pro      → royal violet (#6D5CFF, the brand's secondary). Distinct from
 *              the verified blue at a glance, and it belongs to the palette
 *              rather than being a colour picked to be different.
 *   free     → renders nothing.
 *
 * Emerald was avoided deliberately: it is the online-presence colour on the
 * avatar ring, and two green marks a centimetre apart meaning different things
 * is exactly the confusion this badge is supposed to remove.
 *
 * Colour is never the ONLY carrier — `title` and `aria-label` both name the
 * tier, so dropping the visible word costs a screen reader nothing.
 *
 * Pure + presentational so it is safe in server OR client trees. For the
 * current viewer's badge, pair with `useEntitlements()` (see
 * `MyDiamondCrownBadge`).
 */
export function DiamondCrownBadge({
  plan,
  size = "sm",
  /**
   * Adds the tier's name as PLAIN TEXT beside the seal. Kept for the Plan and
   * Analytics screens, where the badge sits in prose and the word is the
   * information. It is no longer a pill — the rectangle is gone everywhere.
   */
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
      ? { seal: "h-[22px] w-[22px]", text: "text-xs" }
      : size === "sm"
        ? { seal: "h-[18px] w-[18px]", text: "text-[11px]" }
        : { seal: "h-[15px] w-[15px]", text: "text-[10px]" };

  /*
    Black and gold (owner, 2026-08-04). Business is the gold seal; Pro is the
    black one.

    The black seal INVERTS in dark mode — a #111827 badge on a #0B1020 card is
    a badge nobody can see, so it becomes a white seal with a dark tick. Gold
    needs no inversion: it clears contrast on both surfaces.
  */
  const tone = business
    ? {
        fill: "fill-amber-500",
        glyph: "text-white",
        label: "Business",
        title: "Business account",
        text: "text-amber-600 dark:text-amber-400",
      }
    : {
        fill: "fill-[#111827] dark:fill-white",
        glyph: "text-white dark:text-[#111827]",
        label: "Pro",
        title: "Pro member",
        text: "text-[#111827] dark:text-white",
      };

  const seal = (
    <BadgeCheck aria-hidden className={cn("shrink-0 drop-shadow-sm", tone.fill, tone.glyph, dims.seal)} />
  );

  if (showLabel) {
    return (
      <span
        title={tone.title}
        aria-label={tone.title}
        className={cn("inline-flex items-center gap-1.5 font-bold tracking-wide", dims.text, tone.text, className)}
      >
        {seal}
        {tone.label}
      </span>
    );
  }

  return (
    <span title={tone.title} aria-label={tone.title} className={cn("inline-flex shrink-0", className)}>
      {seal}
    </span>
  );
}
