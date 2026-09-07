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
