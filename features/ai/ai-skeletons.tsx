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

/**
 * The Frenz AI welcome — the shape of features/ai/frenz-ai-welcome.tsx since
 * the 2026-10-05 redesign (owner's reference): the showcase card, the credits
 * strip, the crumb pill, two headline lines, the support line, the docked actions.
 * Same paddings as the real page, so nothing moves when it lands.
 */
export function FrenzAIPageSkeleton() {
  return (
    <SkeletonSection label="Loading Frenz AI">
      <div className="pb-6 pt-3 sm:pt-4" aria-hidden>
        <Skeleton className="aspect-[5/4] w-full rounded-[1.375rem] min-[380px]:aspect-[16/10] sm:aspect-[2/1]" />
        <Skeleton className="mt-3 h-14 w-full rounded-[1.25rem]" />
        <Skeleton className="mt-6 h-10 w-48 rounded-full" />
        <Skeleton className="mt-3.5 h-9 w-full max-w-[22rem]" />
        <Skeleton className="mt-2 h-9 w-40 sm:hidden" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      </div>
      <div className="mt-4 flex gap-2" aria-hidden>
        <Skeleton className="h-[3.375rem] flex-1 rounded-full" />
        <Skeleton className="h-[3.375rem] w-[3.375rem] shrink-0 rounded-full sm:w-40" />
      </div>
    </SkeletonSection>
  );
}

/**
 * Explore AI Studio (2026-09-20): the crumb, the headline, then the grid of
 * tool cards — the shape of features/ai/frenz-ai-explore.tsx. The Studio-shell
 * route renders per request, so this is what a cold tap paints first.
 */
export function FrenzAIExploreSkeleton() {
  return (
    <SkeletonSection label="Opening AI Studio">
      {/* 2026-10-05: the page opens with the showcase and the credits strip (owner's reference) */}
      <Skeleton className="mt-3 aspect-[5/4] w-full rounded-[1.375rem] min-[380px]:aspect-[16/10] sm:aspect-[2/1]" />
      <Skeleton className="mt-3 h-14 w-full rounded-[1.25rem]" />
      <div className="mt-6">
        <Skeleton className="h-10 w-44 rounded-full" />
        <Skeleton className="mt-3.5 h-9 w-64 max-w-full" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="mt-6 h-3 w-16 rounded-full" />
      <div className="mt-2.5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-[1.375rem] ring-1 ring-inset ring-black/[0.07]" aria-hidden>
            <Skeleton className="aspect-[16/10] w-full rounded-none" />
            <div className="p-3.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-2 h-3 w-full" />
            </div>
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

/**
 * Part 7 §43/§44 — a generation TOOL (Text to Video, Image to Video, Lip Sync,
 * Text to Audio, Voice Cloning): crumb, display title, the input card, the
 * settings card, the cost-and-Generate bar.
 *
 * 🔴 These routes had NO loading boundary of their own, so a tap on a tool
 * fell back to `/ai/loading.tsx` — the WELCOME page's skeleton (hero lines, a
 * four-tile studio card, a tool grid). The member saw the wrong page arrive
 * and then jump into the right one: a layout shift built into the skeleton.
 *
 * The geometry mirrors `AiPageShell` + the workspaces (max-w-2xl, px-4 pt-4,
 * the 1.75rem cards, the 1.5rem bar) and is checked against the real page on a
 * production build by `scripts/_p7-skeleton.tmp.mjs`. Eleven shimmer blocks,
 * transform-only, off under reduced motion (§45).
 */
export function AiToolSkeleton({
  label = "Loading",
  layout = "classic",
}: {
  label?: string;
  /**
   * `reference` — a page already moved to the owner's 2026-10-05 reference
   * layout: showcase, credits strip, the icon + gradient title, ONE card, the
   * action bar. `classic` stays for the tools still waiting for their phase.
   */
  layout?: "classic" | "reference";
}) {
  if (layout === "reference") {
    return (
      <SkeletonSection label={label} className="ai-wash relative min-h-full">
        <div className="relative mx-auto w-full max-w-2xl px-4 pb-16 pt-4 sm:px-6" aria-hidden>
          {/* the showcase shows on tool pages on large screens only (owner, 2026-10-05) */}
          <Skeleton className="mb-3 hidden aspect-[2/1] w-full rounded-[1.375rem] lg:block" />
          <Skeleton className="mt-1 h-14 w-full rounded-[1.25rem] lg:mt-0" />
          <div className="mt-6 flex items-center gap-3 px-1">
            <Skeleton className="h-[2.85rem] w-[2.85rem] rounded-[0.95rem]" />
            <Skeleton className="h-9 w-52 rounded-lg" />
          </div>
          <Skeleton className="mx-1 mt-2.5 h-5 w-64 max-w-full" />
          <Skeleton className="mx-1 mt-2 h-4 w-full max-w-[22rem]" />
          <div className="mt-5 space-y-3 rounded-[1.75rem] p-4 ring-1 ring-inset ring-black/[0.07] sm:p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-full max-w-[18rem]" />
            <Skeleton className="h-[9rem] w-full rounded-2xl" />
            <Skeleton className="h-[6.5rem] w-full rounded-2xl" />
            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
              <Skeleton className="h-[3.75rem] rounded-2xl" />
              <Skeleton className="h-[3.75rem] rounded-2xl" />
            </div>
          </div>
        </div>
      </SkeletonSection>
    );
  }
  return (
    <SkeletonSection label={label} className="ai-wash relative min-h-full">
      <div className="relative mx-auto w-full max-w-2xl px-4 pb-16 pt-4 sm:px-6">
        <Skeleton className="h-3 w-28 rounded-full" />
        <Skeleton className="mt-3.5 h-9 w-full max-w-[20rem] rounded-lg" />
        <Skeleton className="mt-2 h-9 w-48 rounded-lg" />

        <div className="mt-5 rounded-[1.75rem] bg-white/70 p-4 ring-1 ring-inset ring-white/70 sm:p-5" aria-hidden>
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="mt-1.5 h-3 w-full max-w-[18rem]" />
          <Skeleton className="mt-2 h-[8.5rem] w-full rounded-2xl" />
          <Skeleton className="mt-5 h-16 w-full rounded-2xl" />
        </div>

        <div className="mt-4 rounded-[1.75rem] bg-white/55 p-4 ring-1 ring-inset ring-white/50 sm:p-5" aria-hidden>
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="mt-2 h-11 w-full rounded-full" />
          <Skeleton className="mt-4 h-3.5 w-16" />
          <Skeleton className="mt-2 h-11 w-full rounded-full" />
        </div>

        <div className="mt-6 flex h-[4.5rem] items-center rounded-[1.5rem] bg-white/80 px-4 ring-1 ring-inset ring-white/70" aria-hidden>
          <Skeleton className="h-8 w-24" />
          <Skeleton className="ml-auto h-12 w-36 rounded-full" />
        </div>
      </div>
    </SkeletonSection>
  );
}

/**
 * A library page (Your Audios, Your Voices — redesign page 8): the credits
 * strip, the tool title, the primary action, then two item cards. These
 * routes had no fallback of their own and inherited the WELCOME page's
 * (showcase card, hero), so they jumped when the list arrived.
 */
export function AiLibrarySkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <SkeletonSection label={label}>
      <div className="pb-24" aria-hidden>
        <Skeleton className="mb-3 hidden aspect-[2/1] w-full rounded-[1.375rem] lg:block" />
        <Skeleton className="mt-3 h-14 w-full rounded-[1.25rem] lg:mt-0" />
        <div className="mt-6 flex items-center gap-3 px-1">
          <Skeleton className="h-[2.85rem] w-[2.85rem] rounded-[0.95rem]" />
          <Skeleton className="h-9 w-48 rounded-lg" />
        </div>
        <Skeleton className="mx-1 mt-2.5 h-5 w-64 max-w-full" />
        <Skeleton className="mx-1 mt-2 h-4 w-full max-w-[22rem]" />
        <Skeleton className="mt-5 h-12 w-36 rounded-full" />
        <div className="mt-6 space-y-3">
          <Skeleton className="h-[9.5rem] w-full rounded-[1.375rem]" />
          <Skeleton className="h-[9.5rem] w-full rounded-[1.375rem]" />
        </div>
      </div>
    </SkeletonSection>
  );
}
