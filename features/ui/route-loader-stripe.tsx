/**
 * The stripe loader — a pure-CSS indeterminate segment that rides directly under the
 * top bar ONLY while a route's skeleton is actually on screen (owner, 2026-08: "the
 * stripe loader should only show on skeleton loading to avoid total white screen").
 *
 * It lives inside `SkeletonSection`, which is rendered exclusively by route
 * `loading.tsx` files — and Next only shows a `loading.tsx` when that segment is
 * genuinely still fetching (a cached/instant navigation skips it entirely). So the
 * stripe appears for real loads and never flashes on an instant page switch. A
 * client-side, tap-triggered progress bar was tried and removed: it showed on every
 * navigation (including instant ones), which read as "every page loads" — exactly
 * what the owner did NOT want.
 *
 * No hooks, no "use client": a plain CSS div, so rendering it from the server
 * skeletons pulls no client JS. Positioned at the safe-area inset the top bars pad
 * for, plus the 4rem bar height.
 */
export function RouteLoaderStripe() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 z-[45]"
      style={{ top: "calc(var(--frenz-safe-top, 0px) + 4rem)" }}
    >
      <div className="frenz-route-indeterminate h-0.5 w-full bg-primary/10" />
    </div>
  );
}
