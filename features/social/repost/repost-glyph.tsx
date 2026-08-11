/**
 * The Frenzsave repost mark.
 *
 * The brief asks for a "dual arrow icon" that "should immediately feel like a
 * Frenzsave feature" and explicitly not a copy of TikTok's.
 *
 * ── Why this is drawn rather than imported ───────────────────────────────
 * Every repost surface in the app currently uses Lucide's `Repeat2`, which is a
 * loop: two arrows chasing each other round a rectangle. It reads as "again",
 * which is what a retweet is — and it is the same glyph five other products
 * use, so it carries none of this one's meaning.
 *
 * A Frenzsave repost is a RECOMMENDATION passed to someone. So the mark is two
 * arrows that do not loop: they cross and continue outward, one leading and one
 * following, with unequal stroke weights so the leading arrow reads as the
 * hand-off and the trailing one as the return. It stays legible at 16px, which
 * is the size that decided most of it — a third element or a curve tighter than
 * the stroke width turns to mud there.
 *
 * `currentColor` throughout, so a parent decides the colour and the active
 * state costs no second asset.
 */
export function RepostGlyph({
  className,
  strokeWidth = 2,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* Leading arrow — outward, heavier: the recommendation being passed on. */}
      <path d="M3.5 8.5h13" strokeWidth={strokeWidth} />
      <path d="M13 5 16.5 8.5 13 12" strokeWidth={strokeWidth} />
      {/* Trailing arrow — returning, lighter: what comes back from the person
          you sent it to. Deliberately not a mirror image; a symmetrical pair
          reads as a refresh loop, which is the icon this one exists to avoid. */}
      <path d="M20.5 15.5h-13" strokeWidth={strokeWidth * 0.82} opacity={0.9} />
      <path d="M11 12 7.5 15.5 11 19" strokeWidth={strokeWidth * 0.82} opacity={0.9} />
    </svg>
  );
}
