"use client";

import { ChevronRight, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useInView } from "@/features/data";
import { CATEGORIES, categoryLabel } from "@/lib/social/categories";
import type { PostCard } from "@/lib/social/posts";
import { formatCompactNumber } from "@/lib/utils";

const RAIL_GRADIENTS = [
  "from-amber-500 to-orange-600",
  "from-emerald-500 to-green-600",
  "from-rose-500 to-fuchsia-600",
  "from-sky-500 to-blue-600",
  "from-red-500 to-rose-600",
  "from-violet-500 to-purple-600",
];

/** Trending rail with in-place category filtering — chips only appear for
 * categories that actually have videos, so a topic always matches its content. */
export function TrendingRail({ posts }: { posts: PostCard[] }) {
  const [active, setActive] = useState<string>("all");
  const router = useRouter();

  // Warm the destinations while the rail is still ~a screen away, so the first
  // tap opens instantly instead of paying a cold navigation — and Next keeps the
  // prefetched result cached, so it stays instant (owner's "cache-first, keeps
  // opening instantly"). Only a handful, so it never floods the network.
  const { ref: warmRef, inView } = useInView<HTMLDivElement>({ rootMargin: "800px" });
  useEffect(() => {
    if (!inView) return;
    router.prefetch("/explore");
    for (const p of posts.slice(0, 6)) router.prefetch(`/p/${p.id}`);
  }, [inView, posts, router]);

  // Categories present in the data, ordered by the canonical taxonomy.
  const present = useMemo(() => {
    const set = new Set(posts.map((p) => p.category).filter(Boolean) as string[]);
    return CATEGORIES.filter((c) => set.has(c));
  }, [posts]);

  const filtered = active === "all" ? posts : posts.filter((p) => p.category === active);

  const chip = (key: string, label: string) => {
    const on = active === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setActive(key)}
        aria-pressed={on}
        className={
          "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 active:scale-95 " +
          (on
            ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/25"
            : "border border-border/70 font-medium text-muted-foreground hover:-translate-y-px hover:border-foreground/20 hover:text-foreground")
        }
      >
        {label}
      </button>
    );
  };

  return (
    <>
      {/* Prefetch sentinel — fires the warm-up ~800px before the rail is on screen. */}
      <div ref={warmRef} aria-hidden className="h-0" />
      {/* Category chips */}
      <div className="mb-5 mt-4 flex flex-wrap gap-2">
        {chip("all", "All")}
        {present.map((c) => chip(c, categoryLabel(c)))}
      </div>

      {/* Rail — re-keyed by active so the whole strip re-cascades on switch */}
      <div className="relative">
        <div
          key={active}
          className="-mx-1 flex gap-3.5 overflow-x-auto px-1 pb-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {filtered.map((p, i) => (
            <Link
              key={p.id}
              href={`/p/${p.id}`}
              // Portrait 9:16 — these are reels; a landscape crop fought the format.
              // Staggered entrance: each card fades-up a beat after the last (capped
              // so a long rail doesn't crawl in). GPU transform/opacity only, and the
              // global reduced-motion guard neutralises `.animate-fade-up`.
              style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
              className="group relative aspect-[9/16] w-40 shrink-0 animate-fade-up overflow-hidden rounded-[1.25rem] shadow-soft ring-1 ring-border/60 transition-all duration-300 [transition-timing-function:var(--ease-spring)] will-change-transform hover:-translate-y-1.5 hover:shadow-elevated hover:ring-violet-500/30"
            >
              {p.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.thumbnailUrl} alt={p.title} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 [transition-timing-function:var(--ease-out)] group-hover:scale-[1.08]" />
              ) : (
                <span className={`absolute inset-0 bg-gradient-to-br ${RAIL_GRADIENTS[i % RAIL_GRADIENTS.length]}`} />
              )}
              <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/5 to-black/15" />

              {/* Sheen that sweeps across on hover — the "alive" cue. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 [transition-timing-function:var(--ease-out)] group-hover:translate-x-full"
              />

              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/40 backdrop-blur transition-all duration-300 [transition-timing-function:var(--ease-spring)] group-hover:scale-110 group-hover:bg-white/35">
                  <Play className="ml-0.5 h-5 w-5 fill-white text-white" />
                </span>
              </span>
              {p.category ? (
                <span className="absolute left-2 top-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white backdrop-blur">
                  {categoryLabel(p.category)}
                </span>
              ) : null}
              <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                <Play className="h-2.5 w-2.5 fill-white" /> {formatCompactNumber(p.viewsCount)}
              </span>
            </Link>
          ))}
        </div>
        <Link
          href="/explore"
          aria-label="View more trending"
          className="absolute -right-2 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-card shadow-card ring-1 ring-border/60 transition-all hover:scale-110 hover:ring-violet-500/30 lg:flex"
        >
          <ChevronRight className="h-5 w-5" />
        </Link>
      </div>
    </>
  );
}
