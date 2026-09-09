import { MyDiamondCrownBadge } from "@/components/badges/my-diamond-crown-badge";

/**
 * The Pro mark used across Frenz AI.
 *
 * ── Why gold and not another gradient ─────────────────────────────────────────
 * Premium is already spoken for in this design system: `--gold`, `.text-gradient-gold`
 * and `.ring-hairline-gold` exist precisely so paid moments read the same
 * everywhere. Frenz AI's own colour is the blue→purple brand sweep; if Pro used
 * that too, the badge would disappear into the surface it sits on and the page
 * would be one gradient with a word in it.
 *
 * ── Tasteful means small, not hidden ──────────────────────────────────────────
 * Owner: "Show a tasteful Pro badge throughout the experience… visible but not
 * aggressive." So it is a hairline pill at caption size — no glow, no animation,
 * no filled block — and it never gates the interface it labels. A free member
 * sees this badge and the whole tool behind it.
 *
 * `PRO` is styled uppercase rather than written uppercase, so a screen reader
 * says "pro feature" instead of spelling out three letters.
 */
export function AICleanProBadge({ className }: { className?: string }) {
  /*
    ── 🔴 THE PLATFORM BADGE, NOT A SECOND ONE ────────────────────────────

    Owner, 2026-09-09: "remove this pro badge and use the platform own pro and
    business badge without the text pro or business or max, just with their
    badge."

    This was a gold pill reading PRO — a badge invented for Frenz AI while the
    rest of the product already had one. Two marks for the same fact is how a
    product stops looking like one product, and the AI pill had a further
    problem: it said PRO to everybody, including Business members and free
    ones, because it described the FEATURE rather than the viewer.

    `MyDiamondCrownBadge` resolves the signed-in viewer's own plan and draws
    the platform seal — a crowned hexagon for Pro, a faceted diamond for
    Business — with no label, which is the whole request. It renders NOTHING
    for a free member, which is correct: a badge is a statement about who you
    are, and free is not a tier to decorate.

    ⚠️ `max_ai` has no seal yet. `BillingPlan` is free/pro/business, so that
    plan will need its own silhouette in `DiamondCrownBadge` when it ships —
    borrowing the Business diamond would claim the wrong tier.
  */
  return <MyDiamondCrownBadge size="sm" className={className} />;
}
