import { Plus } from "lucide-react";
import Link from "next/link";

/**
 * The profile's floating action button (lux brief, 2026-08-04).
 *
 * ── The destination, and the bug it had ──────────────────────────────────
 * A FAB is the most prominent control on a page, so it has to have a real
 * destination. This one pointed at `/create`, which does not exist — the
 * route has only `post`, `reel` and `story` children and no index page — so
 * the button 404'd (owner, 2026-08-04).
 *
 * That is exactly the doorway failure the Part 14 lesson names, committed by
 * the very component written to avoid it. The lesson evidently needs applying
 * to NEW affordances and not only to inherited ones: a link is not "real"
 * because the path looks plausible, only because the route exists.
 *
 * It now goes to `/create/post`, the destination the navigation registry
 * already calls "Create post".
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
      href="/create/post"
      prefetch={false}
      aria-label="Create a post"
      className="lux-fab fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full backdrop-blur-sm lg:right-8"
      style={{ bottom: "calc(var(--frenz-nav-clearance, 4.5rem) + 0.75rem)" }}
    >
      <Plus className="h-6 w-6" strokeWidth={2.4} />
    </Link>
  );
}
