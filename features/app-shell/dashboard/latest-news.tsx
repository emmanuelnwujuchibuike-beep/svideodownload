"use client";

import Link from "next/link";
import { useState } from "react";

import { cn } from "@/lib/utils";

const TABS = ["All", "Technology", "Sports", "Entertainment", "Business", "Politics", "Science"] as const;
type Tab = (typeof TABS)[number];

const NEWS: { title: string; cat: Exclude<Tab, "All">; sub: string; time: string; gradient: string }[] = [
  { title: "AI tools that will change the future in 2026", cat: "Technology", sub: "The latest in AI and tech", time: "2h ago", gradient: "from-cyan-500 to-blue-600" },
  { title: "Champions League highlights and results", cat: "Sports", sub: "Top matches & results", time: "4h ago", gradient: "from-emerald-500 to-green-600" },
  { title: "New movie drops this weekend!", cat: "Entertainment", sub: "Celebs, movies & more", time: "5h ago", gradient: "from-rose-500 to-pink-600" },
  { title: "Markets see major changes today", cat: "Business", sub: "Markets & economy", time: "6h ago", gradient: "from-amber-500 to-orange-600" },
  { title: "New discoveries beyond our galaxy", cat: "Science", sub: "Discoveries & research", time: "7h ago", gradient: "from-indigo-500 to-violet-600" },
  { title: "Global policy shifts to watch", cat: "Politics", sub: "Global political updates", time: "8h ago", gradient: "from-slate-500 to-slate-700" },
];

/** Latest News with category tabs. */
export function LatestNewsTabs() {
  const [tab, setTab] = useState<Tab>("All");
  const items = tab === "All" ? NEWS : NEWS.filter((n) => n.cat === tab);

  return (
    <section className="mt-5 rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-bold">📰 Latest News</h2>
        <Link href="/blog" className="text-xs font-semibold text-primary hover:underline">View all</Link>
      </div>

      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition",
              tab === t ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white" : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((n) => (
          <Link key={n.title} href="/blog" className="group w-44 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-background transition hover:-translate-y-1 hover:shadow-card">
            <div className={`relative aspect-video bg-gradient-to-br ${n.gradient}`}>
              <span className="absolute left-2 top-2 rounded-md bg-black/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white backdrop-blur">{n.cat}</span>
            </div>
            <div className="p-2.5">
              <p className="line-clamp-2 text-xs font-semibold leading-snug group-hover:text-primary">{n.title}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">{n.time}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
