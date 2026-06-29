"use client";

import { ChevronRight, Play } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

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
          on
            ? "rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white"
            : "rounded-full border border-border/70 px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-foreground/20 hover:text-foreground"
        }
      >
        {label}
      </button>
    );
  };

  return (
    <>
      {/* Category chips */}
      <div className="mb-5 mt-4 flex flex-wrap gap-2">
        {chip("all", "All")}
        {present.map((c) => chip(c, categoryLabel(c)))}
      </div>

      {/* Rail — re-keyed by active so it fades on switch */}
      <div className="relative">
        <div
          key={active}
          className="-mx-1 flex animate-fade-up gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {filtered.map((p, i) => (
            <Link
              key={p.id}
              href={`/p/${p.id}`}
              className="group relative aspect-[4/3] w-44 shrink-0 overflow-hidden rounded-2xl shadow-soft ring-1 ring-border/60 transition hover:-translate-y-1 hover:shadow-card"
            >
              {p.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105" />
              ) : (
                <span className={`absolute inset-0 bg-gradient-to-br ${RAIL_GRADIENTS[i % RAIL_GRADIENTS.length]}`} />
              )}
              <span className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/25 backdrop-blur transition group-hover:bg-white/40">
                  <Play className="h-5 w-5 fill-white text-white" />
                </span>
              </span>
              {p.category ? (
                <span className="absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white backdrop-blur">
                  {categoryLabel(p.category)}
                </span>
              ) : null}
              <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                <Play className="h-2.5 w-2.5 fill-white" /> {formatCompactNumber(p.viewsCount)}
              </span>
            </Link>
          ))}
        </div>
        <Link
          href="/explore"
          aria-label="View more trending"
          className="absolute -right-2 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-card shadow-card ring-1 ring-border/60 transition hover:scale-105 lg:flex"
        >
          <ChevronRight className="h-5 w-5" />
        </Link>
      </div>
    </>
  );
}
