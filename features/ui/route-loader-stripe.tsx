/**
 * The server-safe, pure-CSS indeterminate stripe that rides directly under the top
 * bar while a route's skeleton is on screen (owner, 2026-08: "make all skeleton
 * loading in all pages show a stripe loader under the top header ... so everything
 * dont always show white").
 *
 * The client `RouteProgress` bar (features/app-shell/route-progress.tsx) fills on a
 * tap and completes the instant the URL commits — which, for a route with a
 * `loading.tsx`, is the moment the skeleton APPEARS. This picks up from there: an
 * indeterminate segment that slides for the whole time the skeleton streams, so a
 * slow server render never sits under a dead grey header. It hands off seamlessly —
 * same position, same brand color.
 *
 * No hooks, no "use client": it's a plain CSS div, so rendering it from the server
 * `loading.tsx` skeletons (via SkeletonSection) pulls no client JS. Position mirrors
 * the client bar: the safe-area inset the top bars pad for, plus the 4rem bar.
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
