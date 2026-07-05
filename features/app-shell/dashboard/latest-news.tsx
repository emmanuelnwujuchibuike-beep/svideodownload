"use client";

import { ArrowRight, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const TABS = ["All", "Technology", "Sports", "Entertainment", "Business", "Politics", "Science"] as const;
type Tab = (typeof TABS)[number];

type NewsItem = { title: string; cat: Exclude<Tab, "All">; sub: string; time: string; gradient: string };

const NEWS: NewsItem[] = [
  { title: "AI tools that will change the future in 2026", cat: "Technology", sub: "The latest in AI and tech", time: "2h ago", gradient: "from-cyan-500 to-blue-600" },
  { title: "Champions League highlights and results", cat: "Sports", sub: "Top matches & results", time: "4h ago", gradient: "from-emerald-500 to-green-600" },
  { title: "New movie drops this weekend!", cat: "Entertainment", sub: "Celebs, movies & more", time: "5h ago", gradient: "from-rose-500 to-pink-600" },
  { title: "Markets see major changes today", cat: "Business", sub: "Markets & economy", time: "6h ago", gradient: "from-amber-500 to-orange-600" },
  { title: "New discoveries beyond our galaxy", cat: "Science", sub: "Discoveries & research", time: "7h ago", gradient: "from-indigo-500 to-violet-600" },
  { title: "Global policy shifts to watch", cat: "Politics", sub: "Global political updates", time: "8h ago", gradient: "from-slate-500 to-slate-700" },
];

/** Latest News with category tabs — cards open a fullscreen reader. */
export function LatestNewsTabs() {
  const [tab, setTab] = useState<Tab>("All");
  const [active, setActive] = useState<NewsItem | null>(null);
  const items = tab === "All" ? NEWS : NEWS.filter((n) => n.cat === tab);

  return (
    <section className="mt-5 rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-bold text-foreground">📰 Latest News</h2>
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
          <button key={n.title} type="button" onClick={() => setActive(n)} className="group w-44 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-background text-left transition hover:-translate-y-1 hover:shadow-card">
            <div className={`relative aspect-video bg-gradient-to-br ${n.gradient}`}>
              <span className="absolute left-2 top-2 rounded-md bg-black/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white backdrop-blur">{n.cat}</span>
            </div>
            <div className="p-2.5">
              <p className="line-clamp-2 text-xs font-semibold leading-snug text-foreground group-hover:text-primary">{n.title}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">{n.time}</p>
            </div>
          </button>
        ))}
      </div>

      {active ? <NewsViewer item={active} onClose={() => setActive(null)} /> : null}
    </section>
  );
}

function NewsViewer({ item, onClose }: { item: NewsItem; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // overflowY only — the `overflow` shorthand also resets overflow-x, undoing
    // the `overflow-x: clip` on <body> that keeps the app sidebar sticky.
    document.body.style.overflowY = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflowY = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[92] flex flex-col bg-black/95 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={item.title}>
      <button type="button" onClick={onClose} aria-label="Close" className="fixed left-4 top-4 z-10 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20">
        <X className="h-4 w-4" /> Close
      </button>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div className="w-full max-w-2xl overflow-hidden rounded-3xl bg-card shadow-elevated">
          <div className={`relative aspect-video bg-gradient-to-br ${item.gradient}`}>
            <span className="absolute left-4 top-4 rounded-md bg-black/40 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur">{item.cat}</span>
          </div>
          <div className="p-6">
            <h2 className="text-xl font-extrabold tracking-[-0.02em] text-foreground sm:text-2xl">{item.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{item.time}</p>
            <p className="mt-4 leading-relaxed text-muted-foreground">{item.sub}. Read the full story and more updates on the Frenz blog.</p>
            <Link href="/blog" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-95">
              Read full story <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
