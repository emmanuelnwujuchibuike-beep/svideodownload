import { Skeleton, SkeletonSection } from "@/features/ui/skeleton";

/**
 * The loading shapes for Frenz AI's two routes.
 *
 * ── Structure, not a spinner ──────────────────────────────────────────────────
 * Both of these draw the page that is coming: the same header block in the same
 * place, the same card geometry, the same stage. Next streams the loading
 * boundary on the click, so the layout is on screen before the server has
 * finished — which is why a tap feels answered instantly and why nothing shifts
 * when the real content replaces this.
 *
 * A full-page spinner would take the same time and tell the person nothing about
 * where they are going. Server components (no "use client"): a skeleton that
 * ships JavaScript to animate a placeholder has missed its own point — the
 * shimmer is a CSS utility from `globals.css`.
 */

/** The Frenz AI hub: header, then the tool grid. */
export function FrenzAIPageSkeleton() {
  return (
    <SkeletonSection label="Loading Frenz AI">
      <div className="mb-5">
        <Skeleton className="h-4 w-24 rounded-full" />
        <Skeleton className="mt-3 h-8 w-56" />
        <Skeleton className="mt-2.5 h-4 w-72 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-3xl border border-border/70 p-5 sm:p-6" aria-hidden>
            <Skeleton className="h-11 w-11 rounded-2xl" />
            <Skeleton className="mt-4 h-5 w-28" />
            <Skeleton className="mt-2.5 h-3.5 w-full" />
            <Skeleton className="mt-1.5 h-3.5 w-2/3" />
          </div>
        ))}
      </div>
    </SkeletonSection>
  );
}

/** AI Clean: header, then the stage with its drop zone. */
export function AICleanSkeleton() {
  return (
    <SkeletonSection label="Loading AI Clean">
      <div className="mb-5">
        <Skeleton className="h-4 w-32 rounded-full" />
        <Skeleton className="mt-3 h-8 w-64 max-w-full" />
        <Skeleton className="mt-2.5 h-4 w-80 max-w-full" />
      </div>

      <div className="rounded-3xl border border-border/70 p-4 sm:p-6" aria-hidden>
        <div className="mx-auto mb-5 flex flex-col items-center">
          <Skeleton className="h-4 w-20 rounded-full" />
          <Skeleton className="mt-2 h-3.5 w-56 max-w-full" />
        </div>
        <Skeleton className="h-56 w-full rounded-3xl sm:h-64" />
        <div className="mt-4 flex justify-center">
          <Skeleton className="h-5 w-36 rounded-full" />
        </div>
      </div>
    </SkeletonSection>
  );
}

/**
 * The AI history page's fallback — the grid's own shape.
 *
 * 🔴 Not a spinner and not the shared loading stripe. This route is one server
 * round trip from being instant, and what somebody sees for that moment should
 * be the layout they are about to get, in the same place. A spinner says "wait";
 * a skeleton in the right shape says "it is coming, and here is where".
 *
 * It exists because NONE of the public /ai routes had a `loading.tsx`, so a tap
 * blocked on the server with no feedback at all and people tapped twice.
 */
export function FrenzAIHistorySkeleton() {
  return (
    <div className="px-4 pb-10 pt-5 sm:px-6" aria-hidden>
      <div className="h-8 w-40 animate-pulse rounded-full bg-secondary motion-reduce:animate-none" />
      <div className="mt-4 h-9 w-56 animate-pulse rounded-lg bg-secondary motion-reduce:animate-none" />
      <div className="mt-2.5 h-4 w-full max-w-md animate-pulse rounded bg-secondary motion-reduce:animate-none" />

      {/* The filter tabs. */}
      <div className="mt-6 h-11 w-full animate-pulse rounded-full bg-secondary motion-reduce:animate-none" />

      {/* The grid — three across, exactly as the real one renders. */}
      <div className="mt-5 grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="min-w-0">
            <div className="aspect-square w-full animate-pulse rounded-2xl bg-secondary motion-reduce:animate-none" />
            <div className="mt-1.5 h-3 w-3/4 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
            <div className="mt-1 h-2.5 w-1/2 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </div>
  );
}
