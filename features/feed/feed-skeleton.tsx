/** Loading skeleton for feed post cards. */
export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-secondary shimmer" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-32 rounded bg-secondary shimmer" />
              <div className="h-2.5 w-20 rounded bg-secondary shimmer" />
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <div className="h-3 w-3/4 rounded bg-secondary shimmer" />
            <div className="h-3 w-1/2 rounded bg-secondary shimmer" />
          </div>
          <div className="mt-3 aspect-video w-full rounded-xl bg-secondary shimmer" />
          <div className="mt-3 flex gap-6">
            {Array.from({ length: 4 }).map((__, j) => (
              <div key={j} className="h-4 w-12 rounded bg-secondary shimmer" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
