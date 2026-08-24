"use client";

import { Clock, Compass, Flame } from "lucide-react";
import { useRef, useState } from "react";

import { ExploreCard, ExploreCardSkeleton } from "@/features/explore/explore-card";
import { PullToRefresh } from "@/features/ui/pull-to-refresh";
import { CATEGORIES, categoryLabel, type Category } from "@/lib/social/categories";
import type { FeedSort } from "@/lib/social/feed";
import type { PostCard } from "@/lib/social/posts";
import { cn } from "@/lib/utils";

const keyOf = (sort: FeedSort, category: Category | null) => `${sort}:${category ?? "all"}`;

/**
 * Explore — an immersive two-column discovery feed.
 *
 * Rebuilt to the owner's reference (`public/explore page.jpg`). The behaviour
 * that already worked is untouched: sort/category selections are fetched once
 * and cached, re-selecting is instant, the current grid stays on screen while a
 * new combo loads, the URL updates via `replaceState` without navigating, and
 * pull-to-refresh still bypasses the cache. What changed is everything above
 * and around that — the header, the controls, and the card.
 *
 * ── 🔴 THE GRID IS THE PAGE ──────────────────────────────────────────────
 * The old layout spent most of the first screen on a header, a tab row, a
 * wrapped block of fourteen category chips and a loading bar before reaching
 * any content. The chips now scroll horizontally on one line and the vertical
 * rhythm is tightened, so the first viewport opens on artwork instead of
 * chrome — which is the whole difference between "a filtered list" and "a
 * discovery feed".
 *
 * ── 🔴 THE GRID IS ALSO BOUNDED ──────────────────────────────────────────
 * `getFeed` returns 24 posts, so there is no unbounded list here and nothing to
 * virtualize — virtualization would be machinery guarding a case the API
 * cannot produce. Every tile below the first row is lazy, and each declares its
 * aspect ratio before the bytes arrive, so a screenful of images streaming in
 * cannot shift the layout.
 */
export function ExploreBrowser({
  initialPosts,
  initialSort,
  initialCategory,
}: {
  initialPosts: PostCard[];
  initialSort: FeedSort;
  initialCategory: Category | null;
}) {
  const cache = useRef<Map<string, PostCard[]>>(new Map([[keyOf(initialSort, initialCategory), initialPosts]]));
  const reqId = useRef(0);
  const [sort, setSort] = useState<FeedSort>(initialSort);
  const [category, setCategory] = useState<Category | null>(initialCategory);
  const [posts, setPosts] = useState<PostCard[]>(initialPosts);
  const [loading, setLoading] = useState(false);

  const select = async (nextSort: FeedSort, nextCategory: Category | null) => {
    setSort(nextSort);
    setCategory(nextCategory);

    // Reflect in the URL without navigating.
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams();
      if (nextSort !== "trending") sp.set("sort", nextSort);
      if (nextCategory) sp.set("category", nextCategory);
      const q = sp.toString();
      window.history.replaceState(window.history.state, "", q ? `/explore?${q}` : "/explore");
    }

    const k = keyOf(nextSort, nextCategory);
    const cached = cache.current.get(k);
    if (cached) {
      setPosts(cached);
      setLoading(false);
      return;
    }

    const id = ++reqId.current;
    setLoading(true);
    try {
      const sp = new URLSearchParams({ sort: nextSort });
      if (nextCategory) sp.set("category", nextCategory);
      const res = await fetch(`/api/explore?${sp.toString()}`);
      const json = (await res.json()) as { posts: PostCard[] };
      if (id !== reqId.current) return; // a newer selection won
      cache.current.set(k, json.posts ?? []);
      setPosts(json.posts ?? []);
    } catch {
      /* keep current grid */
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  };

  // Pull-to-refresh: a real refetch of the CURRENT combo, bypassing the cache
  // `select` would otherwise serve.
  const refresh = async () => {
    const id = ++reqId.current;
    try {
      const sp = new URLSearchParams({ sort });
      if (category) sp.set("category", category);
      const res = await fetch(`/api/explore?${sp.toString()}`);
      const json = (await res.json()) as { posts: PostCard[] };
      if (id !== reqId.current) return;
      cache.current.set(keyOf(sort, category), json.posts ?? []);
      setPosts(json.posts ?? []);
    } catch {
      /* keep current grid */
    }
  };

  // Only ever ONE featured tile, and never in the first four — a wide card at
  // the top would cost the first screen a row of discovery, and one every few
  // cards would stop being a break in the rhythm and become the rhythm.
  const featuredAt = posts.length >= 9 ? 8 : -1;

  return (
    <PullToRefresh onRefresh={refresh}>
      {/*
        The controls, on ONE sticky layer. Keeping the segmented control with
        the chips means a reader who has scrolled into the grid can still
        switch sort or category without scrolling back — the brief's "remain
        accessible while scrolling" — while costing a single sticky element
        rather than two competing ones.
      */}
      <div className="sticky top-[calc(4rem+var(--frenz-safe-top)+var(--frenz-announce-h,0px))] z-20 -mx-3 bg-background/95 px-3 pb-2 pt-1 sm:-mx-4 sm:px-4">
        <div className="flex items-center gap-2">
          <Segmented sort={sort} onSelect={(s) => void select(s, category)} />
        </div>

        <div
          role="tablist"
          aria-label="Categories"
          className="explore-rail -mx-3 mt-2 gap-1.5 px-3 sm:-mx-4 sm:px-4"
        >
          <Chip active={!category} label="All" onClick={() => void select(sort, null)} />
          {CATEGORIES.map((c) => (
            <Chip
              key={c}
              active={category === c}
              label={categoryLabel(c)}
              onClick={() => void select(sort, c)}
            />
          ))}
        </div>
      </div>

      {/*
        🔴 The grid is `pb`-padded clear of the bottom nav via the shared token
        the nav publishes, so the last row is never hidden behind it on any
        device — safe-area inset included, without this file knowing the bar's
        height.
      */}
      <div
        className="mt-2.5"
        style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}
      >
        {loading && posts.length === 0 ? (
          <ExploreSkeletonGrid />
        ) : posts.length === 0 ? (
          <EmptyState category={category} onReset={() => void select(sort, null)} />
        ) : (
          <div
            className={cn(
              "grid grid-cols-2 gap-x-2.5 gap-y-3 transition-opacity duration-200 sm:gap-x-3 lg:grid-cols-3 xl:grid-cols-4",
              loading && "opacity-60",
            )}
          >
            {posts.map((post, i) => (
              <ExploreCard
                key={post.id}
                post={post}
                featured={i === featuredAt}
                // Only the two tiles that are actually above the fold.
                priority={i < 2}
              />
            ))}
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Controls
   ──────────────────────────────────────────────────────────────────────── */

/**
 * The Trending / Recent selector.
 *
 * The active state is a real moving element: one absolutely-positioned pill
 * translated between the two halves, so switching reads as the control
 * responding rather than as two buttons swapping colours. `transform` only —
 * no width animation, nothing that triggers layout.
 */
function Segmented({ sort, onSelect }: { sort: FeedSort; onSelect: (s: FeedSort) => void }) {
  const isRecent = sort === "recent";
  return (
    <div
      role="tablist"
      aria-label="Sort"
      className="relative inline-flex rounded-full bg-secondary/80 p-1 ring-1 ring-inset ring-border/60"
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-foreground shadow-[0_2px_8px_-2px_rgba(0,0,0,0.35)]",
          "transition-transform duration-250 ease-[var(--ease-out)] motion-reduce:transition-none",
        )}
        style={{ transform: isRecent ? "translateX(100%)" : "translateX(0)" }}
      />
      <SegButton active={!isRecent} icon={Flame} label="Trending" onClick={() => onSelect("trending")} />
      <SegButton active={isRecent} icon={Clock} label="Recent" onClick={() => onSelect("recent")} />
    </div>
  );
}

function SegButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Flame;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        // 40px tall: comfortably over the minimum touch target.
        "relative z-10 inline-flex min-w-[104px] items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[13.5px] font-semibold",
        "transition-colors duration-200 motion-reduce:transition-none",
        active ? "text-background" : "text-muted-foreground",
      )}
    >
      <Icon className="h-[15px] w-[15px]" aria-hidden />
      {label}
    </button>
  );
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold",
        "transition-colors duration-150 motion-reduce:transition-none",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary/70 text-muted-foreground ring-1 ring-inset ring-border/50 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   States
   ──────────────────────────────────────────────────────────────────────── */

/** The same grid, the same ratios — so nothing moves when the posts arrive. */
function ExploreSkeletonGrid() {
  return (
    <div role="status" aria-live="polite" className="grid grid-cols-2 gap-x-2.5 gap-y-3 sm:gap-x-3 lg:grid-cols-3 xl:grid-cols-4">
      <span className="sr-only">Loading Explore…</span>
      {Array.from({ length: 6 }).map((_, i) => (
        <ExploreCardSkeleton key={i} />
      ))}
    </div>
  );
}

function EmptyState({ category, onReset }: { category: Category | null; onReset: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span
        aria-hidden
        className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary text-muted-foreground"
      >
        <Compass className="h-7 w-7" />
      </span>
      <p className="text-[16px] font-semibold">No fresh content here yet.</p>
      <p className="mt-1.5 max-w-xs text-[13.5px] text-muted-foreground">
        {category
          ? `Nothing in ${categoryLabel(category)} right now. Try another category or check back soon.`
          : "Nothing has been published yet — publish a download to get started."}
      </p>
      {category ? (
        <button
          type="button"
          onClick={onReset}
          className="mt-5 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground transition-transform duration-150 active:scale-[0.97] motion-reduce:transition-none"
        >
          Browse everything
        </button>
      ) : null}
    </div>
  );
}
