import { Skeleton, SkeletonAvatar } from "@/features/ui/skeleton";

/**
 * Skeleton for the standalone post viewer. Mirrors the real page's layout
 * EXACTLY (same container width, top offset, hero aspect, premium action row +
 * engagement panel + creator card) so the swap to real content is seamless —
 * the post appears to open instantly, never with a jarring reflow or spinner.
 */
export default function PostLoading() {
  return (
    <main className="container max-w-3xl pb-24 pt-28 sm:pt-32">
      <span role="status" aria-live="polite" className="sr-only">
        Loading post…
      </span>

      {/* Hero media */}
      <Skeleton className="aspect-video w-full rounded-3xl" />

      {/* Title + action row */}
      <div className="mt-5 flex flex-wrap items-start justify-between gap-3" aria-hidden>
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-6 w-64 max-w-full rounded-lg" />
          <Skeleton className="h-3.5 w-40 rounded" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-11 w-32 rounded-2xl" />
          <Skeleton className="h-11 w-24 rounded-2xl" />
        </div>
      </div>

      {/* Engagement glass panel */}
      <div className="mt-6 rounded-3xl border border-border/60 bg-card/40 p-4 shadow-soft sm:p-5" aria-hidden>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-20 rounded-2xl" />
          ))}
        </div>
        <div className="mt-4 flex gap-2 border-t border-border/50 pt-4">
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-7 w-28 rounded-full" />
        </div>
      </div>

      {/* Creator card */}
      <div className="mt-6 flex items-center gap-3 rounded-3xl border border-border/60 bg-card/40 p-4 shadow-soft" aria-hidden>
        <SkeletonAvatar className="h-12 w-12" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-36 rounded" />
          <Skeleton className="h-3 w-24 rounded" />
        </div>
        <Skeleton className="h-9 w-20 rounded-xl" />
      </div>

      {/* Comments */}
      <div className="mt-8 space-y-4" aria-hidden>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <SkeletonAvatar className="h-9 w-9" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-32 rounded" />
              <Skeleton className="h-3 w-3/4 rounded" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
