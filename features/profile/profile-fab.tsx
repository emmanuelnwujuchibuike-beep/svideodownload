import { Plus } from "lucide-react";
import Link from "next/link";

/**
 * The profile's floating action button (lux brief, 2026-08-04).
 *
 * ── Why it goes to /create and nowhere else ───────────────────────────────
 * A FAB is the single most prominent control on a page, so it has to be the
 * single most likely action — and it has to have a real destination. The
 * doorway lesson from Part 14 applies: a beautiful button that opens a
 * "coming soon" sheet is worse than no button. On your own profile the answer
 * is unambiguous: make something.
 *
 * Owner-only. On someone else's profile the primary action is Follow or
 * Message, both of which already sit in the hero where a visitor looks for
 * them; a floating Create there would be an invitation to post on a profile
 * that isn't yours.
 *
 * ── Placement ────────────────────────────────────────────────────────────
 * `--frenz-nav-clearance` is the app shell's own measurement of the bottom
 * nav plus the iOS home indicator. Reusing it — rather than guessing a
 * bottom offset — is what stops the button sitting under the nav on a phone
 * with a gesture bar.
 *
 * Server component: it is a link. No client JavaScript.
 */
export function ProfileFab() {
  return (
    <Link
      href="/create"
      prefetch={false}
      aria-label="Create"
      className="lux-fab fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full backdrop-blur-sm lg:right-8"
      style={{ bottom: "calc(var(--frenz-nav-clearance, 4.5rem) + 0.75rem)" }}
    >
      <Plus className="h-6 w-6" strokeWidth={2.4} />
    </Link>
  );
}
