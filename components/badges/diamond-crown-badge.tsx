import type { BillingPlan } from "@/lib/monetization/types";
import { cn } from "@/lib/utils";

/**
 * Plan status badge — the platform-wide premium marker. Drop it next to any
 * username, profile, post, comment, reel or business page.
 *
 * ── Shape, glyph AND colour (owner, 2026-08-04) ───────────────────────────
 * The brief arrived in three passes: make it small like a tick rather than a
 * long flat pill; make it a different colour from the blue verified tick;
 * then — "let the pro and business tick be different and unique from the
 * verified tick not just by color."
 *
 * That last one is the right instinct, and not only aesthetically. A marker
 * distinguished by colour alone is invisible to roughly one man in twelve, and
 * a gold check beside a blue check at 18px is a coin toss for everyone else.
 * So these differ on three independent channels:
 *
 *   verified → scalloped seal + CHECK  + blue   (lucide BadgeCheck, untouched)
 *   pro      → HEXAGON        + CROWN  + black
 *   business → DIAMOND        + FACET  + gold
 *
 * Silhouette does the work at a glance — a hexagon and a diamond read as
 * different objects from a scalloped circle even at 15px, in greyscale, and
 * out of the corner of your eye. Colour and glyph then confirm it.
 *
 * Drawn inline rather than pulled from an icon set because no icon set has a
 * crowned hexagon; two hand-written paths are smaller than the alternative and
 * cost no dependency.
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

  const tone = business
    ? { label: "Business", title: "Business account", text: "text-amber-600 dark:text-amber-400" }
    : { label: "Pro", title: "Pro member", text: "text-[#111827] dark:text-white" };

  const seal = business ? (
    <BusinessDiamond className={dims.seal} />
  ) : (
    <ProHexagon className={dims.seal} />
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

/**
 * Pro — a black hexagonal seal with a crown.
 *
 * The fill inverts in dark mode: #111827 on a #0B1020 card is a badge nobody
 * can see. Gold needs no inversion, which is why only this one carries the
 * `dark:` pair.
 */
function ProHexagon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("shrink-0 drop-shadow-sm", className)}>
      <path d="M12 1.6 21 6.8v10.4L12 22.4 3 17.2V6.8z" className="fill-[#111827] dark:fill-white" />
      {/* Crown: three peaks over a base bar. Simplified hard for legibility at 15px. */}
      <path
        d="M7.2 14.6 6 8.4l3.1 2.3L12 7l2.9 3.7 3.1-2.3-1.2 6.2z"
        className="fill-white dark:fill-[#111827]"
      />
      <rect x="7.2" y="15.4" width="9.6" height="1.7" rx="0.85" className="fill-white dark:fill-[#111827]" />
    </svg>
  );
}

/** Business — a gold diamond seal with an inner facet. */
function BusinessDiamond({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("shrink-0 drop-shadow-sm", className)}>
      <defs>
        <linearGradient id="frenz-biz-seal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FCD34D" />
          <stop offset="55%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
      </defs>
      <path d="M12 1.4 22.6 12 12 22.6 1.4 12z" fill="url(#frenz-biz-seal)" />
      {/* The facet — an inner outline plus a girdle line, which is what makes a
          diamond read as cut stone rather than as a rotated square. */}
      <path d="M12 5.6 18.4 12 12 18.4 5.6 12z" fill="none" stroke="#fff" strokeOpacity="0.9" strokeWidth="1.5" />
      <path d="M5.6 12h12.8" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.1" />
    </svg>
  );
}
