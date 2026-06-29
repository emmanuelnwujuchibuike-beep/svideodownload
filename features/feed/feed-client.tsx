"use client";

import { AnimatePresence } from "framer-motion";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { FeedPostCard } from "@/features/feed/feed-post-card";
import { FeedSkeleton } from "@/features/feed/feed-skeleton";
import type { FeedItem, HomeFeedSort } from "@/lib/social/home-feed";
import { cn } from "@/lib/utils";

const TABS: { key: HomeFeedSort; label: string }[] = [
  { key: "for_you", label: "For You" },
  { key: "following", label: "Following" },
  { key: "recent", label: "Friends" },
];

const PAGE = 8;

export function FeedClient({
  initialItems,
  initialNextOffset,
}: {
  initialItems: FeedItem[];
  initialNextOffset: number | null;
}) {
  const [sort, setSort] = useState<HomeFeedSort>("for_you");
  const [items, setItems] = useState<FeedItem[]>(initialItems);
  const [nextOffset, setNextOffset] = useState<number | null>(initialNextOffset);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const seen = useRef(new Set(initialItems.map((i) => i.id)));

  const fetchPage = useCallback(
    async (s: HomeFeedSort, offset: number, replace: boolean) => {
      if (replace) setSwitching(true);
      else setLoading(true);
      setError(false);
      try {
        const res = await fetch(`/api/home-feed?sort=${s}&offset=${offset}&limit=${PAGE}`);
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { items: FeedItem[]; nextOffset: number | null };
        if (replace) {
          seen.current = new Set(data.items.map((i) => i.id));
          setItems(data.items);
        } else {
          const fresh = data.items.filter((i) => !seen.current.has(i.id));
          fresh.forEach((i) => seen.current.add(i.id));
          setItems((prev) => [...prev, ...fresh]);
        }
        setNextOffset(data.nextOffset);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
        setSwitching(false);
      }
    },
    [],
  );

  const changeTab = (s: HomeFeedSort) => {
    if (s === sort) return;
    setSort(s);
    setItems([]);
    setNextOffset(null);
    void fetchPage(s, 0, true);
  };

  const remove = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));

  // Infinite scroll
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && nextOffset !== null && !loading && !switching) {
          void fetchPage(sort, nextOffset, false);
        }
      },
      { rootMargin: "600px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [nextOffset, loading, switching, sort, fetchPage]);

  return (
    <section className="mt-4">
      {/* Tabs */}
      <div className="mb-4 flex items-center gap-1 rounded-xl bg-secondary/60 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => changeTab(t.key)}
            aria-pressed={sort === t.key}
            className={cn(
              "flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition",
              sort === t.key ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {switching ? (
        <FeedSkeleton count={3} />
      ) : items.length === 0 && !error ? (
        <EmptyState sort={sort} />
      ) : (
        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {items.map((item, i) => (
              <FeedFragment key={item.id} item={item} index={i} onRemove={remove} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Loader / sentinel */}
      {error ? (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
          <AlertCircle className="h-6 w-6 text-red-400" />
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the feed.</p>
          <button
            type="button"
            onClick={() => fetchPage(sort, items.length, items.length > 0 ? false : true)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <div ref={sentinel} aria-hidden className="h-px" />
          {loading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : null}
          {nextOffset === null && items.length > 0 && !switching ? (
            <p className="py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up ✨</p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Renders a post and, every 5th slot, an advertisement placeholder. */
function FeedFragment({ item, index, onRemove }: { item: FeedItem; index: number; onRemove: (id: string) => void }) {
  return (
    <>
      <FeedPostCard item={item} onRemove={onRemove} />
      {(index + 1) % 5 === 0 ? <AdPlaceholder /> : null}
    </>
  );
}

function AdPlaceholder() {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-dashed border-border/70 bg-secondary/30 p-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Advertisement</p>
        <p className="mt-1 text-sm font-medium text-muted-foreground">Your ad could be here.</p>
      </div>
      <Link href="/pricing" className="rounded-lg bg-card px-3 py-2 text-xs font-semibold text-foreground ring-1 ring-border">
        Remove ads
      </Link>
    </div>
  );
}

function EmptyState({ sort }: { sort: HomeFeedSort }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center">
      <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary">
        <Sparkles className="h-6 w-6" />
      </span>
      <p className="text-sm font-semibold">
        {sort === "for_you" ? "Your feed is warming up" : "Nothing here yet"}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {sort === "for_you"
          ? "Download and publish something, or follow creators to fill your feed."
          : "Follow some creators to see their posts here."}
      </p>
      <Link href="/explore" className="mt-4 inline-block rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white">
        Explore creators
      </Link>
    </div>
  );
}
