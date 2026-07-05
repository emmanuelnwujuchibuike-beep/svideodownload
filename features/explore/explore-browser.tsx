"use client";

import { motion } from "framer-motion";
import { Clock, Flame } from "lucide-react";
import { useRef, useState } from "react";

import { PostGrid } from "@/components/social/post-grid";
import { CATEGORIES, categoryLabel, type Category } from "@/lib/social/categories";
import type { FeedSort } from "@/lib/social/feed";
import type { PostCard } from "@/lib/social/posts";
import { cn } from "@/lib/utils";

const keyOf = (sort: FeedSort, category: Category | null) => `${sort}:${category ?? "all"}`;

/**
 * Instant client-side Explore. Sort tabs (Trending/Recent) + category chips
 * switch WITHOUT a page reload: each (sort, category) result is fetched once and
 * cached, so re-selecting is instant and the current grid stays on screen (a
 * thin top bar shows while a new combo loads — never a skeleton flash). The URL
 * updates via replaceState for shareability. Seeded server-side for SEO + a fast
 * first paint.
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

  return (
    <div>
      {/* Sort tabs */}
      <div className="mb-4 inline-flex rounded-xl bg-secondary p-1">
        <TabButton active={sort === "trending"} icon={Flame} label="Trending" onClick={() => select("trending", category)} />
        <TabButton active={sort === "recent"} icon={Clock} label="Recent" onClick={() => select("recent", category)} />
      </div>

      {/* Category chips */}
      <div className="mb-6 flex flex-wrap gap-2">
        <Chip active={!category} label="All" onClick={() => select(sort, null)} />
        {CATEGORIES.map((c) => (
          <Chip key={c} active={category === c} label={categoryLabel(c)} onClick={() => select(sort, c)} />
        ))}
      </div>

      {/* Thin top loading bar (only while a new combo loads) */}
      <div className={cn("relative mb-4 h-0.5 overflow-hidden rounded-full transition-opacity", loading ? "opacity-100" : "opacity-0")}>
        <span className="absolute inset-y-0 left-0 w-1/3 animate-[explore-slide_1s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-blue-500 to-violet-500" />
      </div>

      <div className={cn("transition-opacity duration-200", loading && "opacity-60")}>
        <PostGrid
          posts={posts}
          emptyText={
            category
              ? `No ${categoryLabel(category).toLowerCase()} posts yet.`
              : "Nothing here yet — publish a download to get started."
          }
        />
      </div>

      <style>{`@keyframes explore-slide{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}`}</style>
    </div>
  );
}

function TabButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof Flame; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="relative inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition"
    >
      {active ? (
        <motion.span layoutId="explore-tab-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} className="absolute inset-0 rounded-lg bg-background shadow" />
      ) : null}
      <span className={cn("relative z-10 inline-flex items-center gap-1.5", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
        <Icon className="h-4 w-4" /> {label}
      </span>
    </button>
  );
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active ? "border-primary bg-primary/10 text-primary" : "border-border/70 text-muted-foreground hover:border-foreground/20",
      )}
    >
      {label}
    </button>
  );
}
