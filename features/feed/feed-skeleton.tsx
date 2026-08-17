/**
 * Loading skeleton for feed post cards — matches the redesigned flat
 * timeline (owner, 2026-08-17): a hairline bottom border instead of the old
 * boxed/elevated card, rounded media placeholder (spec section 7's premium
 * rounding applies to the loading state too, not just loaded content).
 */
export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border-b border-border/70 py-3 last:border-b-0 dark:border-white/[0.07]">
          <div className="flex items-center gap-3 px-4 sm:px-5">
            <div className="h-11 w-11 shrink-0 rounded-full bg-secondary shimmer" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-32 rounded bg-secondary shimmer" />
              <div className="h-2.5 w-20 rounded bg-secondary shimmer" />
            </div>
          </div>
          <div className="mt-3 space-y-2 px-4 sm:px-5">
            <div className="h-3 w-3/4 rounded bg-secondary shimmer" />
            <div className="h-3 w-1/2 rounded bg-secondary shimmer" />
          </div>
          <div className="mt-3 aspect-video w-full rounded-2xl bg-secondary shimmer" />
          <div className="mt-3 flex gap-6 px-4 sm:px-5">
            {Array.from({ length: 4 }).map((__, j) => (
              <div key={j} className="h-4 w-12 rounded bg-secondary shimmer" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
