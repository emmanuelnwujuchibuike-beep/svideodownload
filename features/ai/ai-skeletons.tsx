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

/** The Frenz AI welcome: the hero lines, the studio card with its pill, then the tool grid — the shape of features/ai/frenz-ai-welcome.tsx. */
export function FrenzAIPageSkeleton() {
  return (
    <SkeletonSection label="Loading Frenz AI">
      <div className="mb-6 pt-1">
        <Skeleton className="h-3 w-16 rounded-full" />
        <Skeleton className="mt-3 h-9 w-64 max-w-full" />
        <Skeleton className="mt-2 h-9 w-40" />
        <Skeleton className="mt-3 h-4 w-72 max-w-full" />
      </div>

      <div className="rounded-[1.75rem] border border-border/70 p-4 sm:p-6" aria-hidden>
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-[0.95rem]" />
          <div>
            <Skeleton className="h-[18px] w-32" />
            <Skeleton className="mt-2 h-3.5 w-44" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-[1.15rem] border border-border/60 p-3">
              <Skeleton className="h-8 w-8 rounded-[0.6rem]" />
              <Skeleton className="mt-2.5 h-3.5 w-24" />
              <Skeleton className="mt-2 h-3 w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-5 h-14 w-full rounded-full" />
      </div>

      <Skeleton className="mt-7 h-3 w-16 rounded-full" />
      <div className="mt-2.5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-[1.2rem] border border-border/70 p-3" aria-hidden>
            <Skeleton className="h-9 w-9 rounded-[0.7rem]" />
            <Skeleton className="mt-3 h-4 w-24" />
            <Skeleton className="mt-2 h-3 w-full" />
          </div>
        ))}
      </div>
    </SkeletonSection>
  );
}

/**
 * Character Replace: the crumb and headline, the stepper, then the first
 * step's picker — the shape the workspace opens in, so the swap is silent.
 */
export function CharacterReplaceSkeleton() {
  return (
    <SkeletonSection label="Loading Character Replace">
      <div className="mb-5">
        <Skeleton className="h-8 w-40 rounded-full" />
        <Skeleton className="mt-4 h-9 w-72 max-w-full" />
        <Skeleton className="mt-2.5 h-4 w-80 max-w-full" />
      </div>

      <div className="mb-5 flex items-center gap-2" aria-hidden>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className={i === 0 ? "h-2 flex-[2] rounded-full" : "h-2 flex-1 rounded-full opacity-60"} />
        ))}
      </div>

      <div className="rounded-3xl border border-border/70 p-4 sm:p-6" aria-hidden>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-3.5 w-64 max-w-full" />
        <Skeleton className="mt-5 h-52 w-full rounded-3xl sm:h-60" />
      </div>

      <div className="mt-5 flex justify-end" aria-hidden>
        <Skeleton className="h-12 w-36 rounded-full" />
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

      {/*
        The grid — TWO across, exactly as the real one renders, and bare
        squares because the caption now sits inside the tile.

        🔴 Kept in step with `HISTORY_GRID` in frenz-ai-history.tsx by hand,
        which is the one thing about this file that can rot: a skeleton drawn
        at a different column count than the list it stands in for produces a
        visible jump at the moment the data arrives, and nothing fails.
      */}
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="aspect-square w-full animate-pulse rounded-2xl bg-secondary motion-reduce:animate-none"
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The Character Replace CREATE page's fallback (2026-09-20): the header
 * strip — eyebrow, the step title, the scope chip, the stepper — in its own
 * place, then the step's card. Shown only when the create route's data is
 * not yet in the router cache (the scope page prefetches it on landing).
 */
export function CharacterReplaceCreateSkeleton() {
  return (
    <SkeletonSection label="Opening Character Replace">
      <div className="mt-4">
        <Skeleton className="h-3 w-44 rounded-full" />
        <div className="mt-3 flex items-end justify-between gap-4">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-9 w-36 rounded-full" />
        </div>
      </div>
      <div className="mt-5 flex items-center gap-2" aria-hidden>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className={i === 1 ? "h-2 flex-[2] rounded-full" : "h-2 flex-1 rounded-full opacity-60"} />
        ))}
      </div>
      <div className="mt-6 rounded-3xl border border-border/70 p-4 sm:p-6" aria-hidden>
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="mt-4 h-5 w-40" />
        <Skeleton className="mt-2 h-3.5 w-64 max-w-full" />
        <Skeleton className="mt-5 h-52 w-full rounded-3xl sm:h-60" />
      </div>
      <div className="mt-5 flex justify-between" aria-hidden>
        <Skeleton className="h-12 w-28 rounded-full" />
        <Skeleton className="h-12 w-36 rounded-full" />
      </div>
    </SkeletonSection>
  );
}
