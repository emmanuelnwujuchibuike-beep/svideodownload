import type { StreakTier } from "@/lib/streaks/tiers";

/**
 * The flame mark. One inline SVG, shared by the hero chip, the celebration and
 * the profile card so the brand's fire is drawn once.
 *
 * 🔴 An SVG, not an emoji and not an image. An emoji renders as a different
 * picture on every platform (and as a system font glyph that cannot be
 * gradient-filled); an image is a network request and a decode on a page with a
 * 1.6s LCP target. This is ~400 bytes of markup that inherits `currentColor`
 * or takes the brand gradient, and costs nothing to animate.
 *
 * Pure and hook-free, so it renders in a server component or a client one.
 */
export function StreakFlame({
  className = "h-4 w-4",
  gradient = false,
  animated = false,
  tier,
}: {
  className?: string;
  /** Fill with the brand sweep instead of `currentColor`. */
  gradient?: boolean;
  /** Add the slow breathing loop. Off by default — most placements are static. */
  animated?: boolean;
  /**
   * The streak tier whose colours this flame takes (lib/streaks/tiers.ts).
   *
   * Only meaningful with `gradient`. Omitted, the flame keeps the original
   * orange — which is what every non-streak placement wants, and what a
   * `spark`-tier streak gets anyway.
   */
  tier?: StreakTier | null;
}) {
  /*
    🔴 THE GRADIENT ID MUST BE UNIQUE PER TIER.

    SVG gradient ids are GLOBAL to the document. The original code used one
    fixed id and noted that "two gradients with the same id would have the
    second silently win" — which was fine while there was one palette, and is a
    real bug now: the hero chip (blue, say) and the profile card (gold) on the
    same page would both render whichever `<defs>` painted last. Keying the id
    to the tier means each palette owns its own definition and identical tiers
    can safely share one.
  */
  const gradientId = `frenz-flame-grad-${tier?.id ?? "base"}`;
  const stops = tier?.flame ?? ["#F97316", "#FBBF24"];
  const fill = gradient ? `url(#${gradientId})` : "currentColor";
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      className={`${className} ${animated ? "streak-flame" : ""}`}
    >
      {gradient ? (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={stops[0]} />
            <stop offset="55%" stopColor={stops[1]} />
            <stop offset="100%" stopColor={stops[1]} />
          </linearGradient>
        </defs>
      ) : null}
      <path
        fill={fill}
        d="M12.9 2.2c.3 2.2-.6 3.8-2 5.2-1.6 1.6-3.6 3-3.6 6a6.7 6.7 0 0 0 13.4.3c0-2.6-1-4.4-2.3-6-.3 1-.9 1.7-1.7 2 .3-2.9-1-5.6-3.8-7.5Z"
      />
      <path
        fill={fill}
        opacity=".55"
        d="M12 13c.9 1 1.3 1.9 1.3 2.9a1.9 1.9 0 0 1-3.8.1c0-1.4 1.2-2.1 2.5-3Z"
      />
    </svg>
  );
}
