"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowUp, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { FeedPostCard } from "@/features/feed/feed-post-card";
import { FeedSkeleton } from "@/features/feed/feed-skeleton";
import { PostViewer } from "@/features/feed/post-viewer";
import type { FeedItem, HomeFeedSort } from "@/lib/social/home-feed";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const TABS: { key: HomeFeedSort; label: string }[] = [
  { key: "for_you", label: "For You" },
  { key: "following", label: "Following" },
  { key: "recent", label: "Recent" },
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
  const [freshCount, setFreshCount] = useState(0);
  const [viewer, setViewer] = useState<{ item: FeedItem; comments: boolean } | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const seen = useRef(new Set(initialItems.map((i) => i.id)));

  const openViewer = (it: FeedItem, comments = false) => setViewer({ item: it, comments });

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

  const refreshTop = () => {
    setFreshCount(0);
    void fetchPage(sort, 0, true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Realtime: surface newly published public posts as a "new posts" pill.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("feed-posts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        (payload) => {
          const row = payload.new as { status?: string; visibility?: string; id?: string };
          if (row.status === "published" && row.visibility === "public" && row.id && !seen.current.has(row.id)) {
            setFreshCount((n) => n + 1);
          }
        },
      )
      .subscribe();
    return () => {
      void channel.unsubscribe();
    };
  }, []);

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
    <section className="relative mt-4">
      {/* Realtime "new posts" pill */}
      <AnimatePresence>
        {freshCount > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="pointer-events-none sticky top-[4.5rem] z-20 flex justify-center"
          >
            <button
              type="button"
              onClick={refreshTop}
              className="pointer-events-auto -mt-1 mb-3 flex items-center gap-1.5 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/30"
            >
              <ArrowUp className="h-4 w-4" /> {freshCount} new {freshCount === 1 ? "post" : "posts"}
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

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
              <FeedFragment key={item.id} item={item} index={i} onRemove={remove} onOpen={openViewer} />
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

      {/* Fullscreen in-place viewer (plays inline; no navigation) */}
      <PostViewer
        item={viewer?.item ?? null}
        startWithComments={viewer?.comments ?? false}
        onClose={() => setViewer(null)}
      />
    </section>
  );
}

/** Renders a post and, every 5th slot, an advertisement placeholder. */
function FeedFragment({
  item,
  index,
  onRemove,
  onOpen,
}: {
  item: FeedItem;
  index: number;
  onRemove: (id: string) => void;
  onOpen: (item: FeedItem, startComments?: boolean) => void;
}) {
  return (
    <>
      <FeedPostCard item={item} onRemove={onRemove} onOpen={onOpen} />
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
