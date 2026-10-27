"use client";

import { Compass } from "lucide-react";
import { useRef, useState } from "react";

import { VideoTile } from "@/features/search/video-tile";
import { PullToRefresh } from "@/features/ui/pull-to-refresh";
import { CATEGORIES, categoryLabel, type Category } from "@/lib/social/categories";
import type { FeedSort } from "@/lib/social/feed";
import { postViewHref } from "@/lib/social/post-url";
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
  /*
    Discover design on /explore (owner, 2026-10-27: "use same design for the explore page too"): the section
    heading, ONE row of pill chips — Trending · Recent, then the categories — and the 3-column grid of video
    tiles the Discover screen uses. Not sticky: the topbar is hidden here and the grid is short (24 posts).
  */
  return (
    <PullToRefresh onRefresh={refresh}>
      <section aria-labelledby="explore-videos">
        <h2 id="explore-videos" className="px-1 pb-2.5 pt-[26px] font-heading text-[19px] font-bold tracking-[-0.4px]">
          Explore videos
        </h2>
        <div role="toolbar" aria-label="Sort and categories" className="explore-rail -mx-4 gap-2 px-4 pb-1">
          <Chip active={sort === "trending"} label="Trending" onClick={() => void select("trending", category)} />
          <Chip active={sort === "recent"} label="Recent" onClick={() => void select("recent", category)} />
          <span aria-hidden className="mx-0.5 w-px shrink-0 self-stretch bg-frenz-line" />
          <Chip active={!category} label="All" onClick={() => void select(sort, null)} />
          {CATEGORIES.map((c) => (
            <Chip key={c} active={category === c} label={categoryLabel(c)} onClick={() => void select(sort, c)} />
          ))}
        </div>

        <div className="mt-3">
          {loading && posts.length === 0 ? (
            <ExploreSkeletonGrid />
          ) : posts.length === 0 ? (
            <EmptyState category={category} onReset={() => void select(sort, null)} />
          ) : (
            <ul className={cn("grid grid-cols-3 gap-2 transition-opacity duration-200 lg:grid-cols-4", loading && "opacity-60")}>
              {posts.map((post) => (
                <li key={post.id}>
                  <VideoTile video={{ ...post, href: postViewHref(post) }} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </PullToRefresh>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Controls
   ──────────────────────────────────────────────────────────────────────── */

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-11 shrink-0 rounded-full px-[18px] text-[15px] font-bold transition-transform active:scale-[0.97] motion-reduce:active:scale-100",
        active ? "bg-frenz-ink text-frenz-page" : "border border-frenz-line bg-frenz-card text-frenz-ink/80",
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
    <ul role="status" aria-live="polite" className="grid grid-cols-3 gap-2 lg:grid-cols-4">
      <li className="sr-only">Loading Explore…</li>
      {Array.from({ length: 9 }).map((_, i) => (
        <li key={i} aria-hidden className="aspect-[3/4] rounded-[18px] bg-frenz-fill" />
      ))}
    </ul>
  );
}

function EmptyState({ category, onReset }: { category: Category | null; onReset: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span
        aria-hidden
        className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-frenz-fill text-frenz-muted"
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
          className="mt-5 inline-flex h-11 items-center rounded-full bg-frenz-gradient-x px-5 text-[14px] font-bold text-white transition-transform duration-150 active:scale-[0.97] motion-reduce:transition-none"
        >
          Browse everything
        </button>
      ) : null}
    </div>
  );
}
