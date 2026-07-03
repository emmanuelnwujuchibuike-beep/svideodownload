"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowUp, Clock, Loader2, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { FeedPostCard } from "@/features/feed/feed-post-card";
import { FeedSkeleton } from "@/features/feed/feed-skeleton";
import { PostViewer } from "@/features/feed/post-viewer";
import { ReelViewer } from "@/features/feed/reel-viewer";
import { SparkCard } from "@/features/feed/spark-card";
import type { FeedItem, HomeFeedSort } from "@/lib/social/home-feed";
import {
  type AwaySummary,
  balanceByKind,
  buildSmartStream,
  buildSparkDeck,
  summarizeAway,
} from "@/lib/social/smart-feed";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const SEGMENTS: { key: HomeFeedSort; label: string }[] = [
  { key: "for_you", label: "For You" },
  { key: "following", label: "Following" },
  { key: "recent", label: "Fresh" },
];

/** Smart Filters reshape the loaded stream — kind filters + honest reorders. */
const FILTERS = [
  { id: "all", label: "All" },
  { id: "video", label: "Videos" },
  { id: "photo", label: "Photos" },
  { id: "popular", label: "Popular" },
  { id: "discussed", label: "Discussed" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

const PAGE = 8;
const SEEN_KEY = "frenz:feed-seen-at";
const PULL_THRESHOLD = 72;

function applyFilter(items: FeedItem[], f: FilterId): FeedItem[] {
  switch (f) {
    case "video":
      return items.filter((i) => i.mediaKind === "video");
    case "photo":
      return items.filter((i) => i.mediaKind === "image");
    case "popular":
      return [...items].sort(
        (a, b) => b.likesCount + b.sharesCount * 3 - (a.likesCount + a.sharesCount * 3),
      );
    case "discussed":
      return [...items].sort((a, b) => b.commentsCount - a.commentsCount);
    default:
      return items;
  }
}

export function SmartFeed({
  initialItems,
  initialNextOffset,
  friendCount = 0,
}: {
  initialItems: FeedItem[];
  initialNextOffset: number | null;
  friendCount?: number;
}) {
  const [sort, setSort] = useState<HomeFeedSort>("for_you");
  const [filter, setFilter] = useState<FilterId>("all");
  const [items, setItems] = useState<FeedItem[]>(() => balanceByKind(initialItems));
  const [nextOffset, setNextOffset] = useState<number | null>(initialNextOffset);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState(false);
  const [freshCount, setFreshCount] = useState(0);
  const [away, setAway] = useState<AwaySummary | null>(null);
  const [viewer, setViewer] = useState<{ item: FeedItem; comments: boolean } | null>(null);
  const [reel, setReel] = useState<FeedItem | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const seen = useRef(new Set(initialItems.map((i) => i.id)));

  const deck = useMemo(() => buildSparkDeck({ friendCount }), [friendCount]);

  // Videos open the fullscreen reel; everything else opens the split viewer.
  const openViewer = (it: FeedItem, comments = false) => {
    if (it.mediaKind === "video") setReel(it);
    else setViewer({ item: it, comments });
  };

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
          setItems(balanceByKind(data.items));
        } else {
          const fresh = data.items.filter((i) => !seen.current.has(i.id));
          fresh.forEach((i) => seen.current.add(i.id));
          // Balance each page on arrival so the existing feed never reshuffles.
          setItems((prev) => [...prev, ...balanceByKind(fresh)]);
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

  const changeSegment = (s: HomeFeedSort) => {
    if (s === sort) return;
    setSort(s);
    setItems([]);
    setNextOffset(null);
    void fetchPage(s, 0, true);
  };

  const remove = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));

  const refreshTop = useCallback(() => {
    setFreshCount(0);
    void fetchPage(sort, 0, true);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [fetchPage, sort]);

  /* ── While you were away ─────────────────────────────────────────────── */
  useEffect(() => {
    try {
      const prev = Number(localStorage.getItem(SEEN_KEY)) || null;
      setAway(summarizeAway(initialItems, prev));
      localStorage.setItem(SEEN_KEY, String(Date.now()));
    } catch {
      /* storage blocked */
    }
    // Only on first mount — compares against the *previous* visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Realtime "new posts" pill ───────────────────────────────────────── */
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("smart-feed-posts")
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

  /* ── Infinite scroll ─────────────────────────────────────────────────── */
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && nextOffset !== null && !loading && !switching) {
          void fetchPage(sort, nextOffset, false);
        }
      },
      { rootMargin: "800px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [nextOffset, loading, switching, sort, fetchPage]);

  /* ── Premium pull-to-refresh (touch) ─────────────────────────────────── */
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullStart = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    const y = e.touches[0]?.clientY;
    if (y !== undefined && window.scrollY <= 0 && !refreshing) pullStart.current = y;
    else pullStart.current = null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const y = e.touches[0]?.clientY;
    if (pullStart.current === null || y === undefined) return;
    const delta = y - pullStart.current;
    if (delta > 0 && window.scrollY <= 0) setPull(Math.min(110, delta * 0.5));
    else if (pull !== 0) setPull(0);
  };
  const onTouchEnd = async () => {
    if (pullStart.current === null) return;
    pullStart.current = null;
    if (pull >= PULL_THRESHOLD) {
      setRefreshing(true);
      setPull(PULL_THRESHOLD);
      try {
        navigator.vibrate?.(12);
      } catch {
        /* no haptics */
      }
      await fetchPage(sort, 0, true);
      setRefreshing(false);
    }
    setPull(0);
  };

  const pullProgress = Math.min(1, pull / PULL_THRESHOLD);

  /* ── Build the smart stream from the filtered, loaded items ───────────── */
  const stream = useMemo(
    () => buildSmartStream(applyFilter(items, filter), { deck, sparkEvery: 6, balance: false }),
    [items, filter, deck],
  );

  return (
    <section
      className="relative mt-4"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Premium pull-to-refresh indicator */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center overflow-hidden"
        style={{ height: pull, opacity: pull > 4 ? 1 : 0 }}
      >
        <div className="relative flex items-center justify-center" style={{ transform: `translateY(${pull - 40}px)` }}>
          {/* electric energy wave */}
          <span
            className="absolute rounded-full bg-gradient-to-br from-blue-500 to-violet-600 blur-md"
            style={{ height: 44, width: 44, opacity: 0.35 + pullProgress * 0.4, transform: `scale(${0.6 + pullProgress * 0.8})` }}
          />
          <span
            className={cn(
              "relative flex h-9 w-9 items-center justify-center rounded-full bg-background shadow-elevated ring-1 ring-violet-500/40",
              refreshing && "animate-spin",
            )}
            style={{ transform: `rotate(${pull * 3}deg)` }}
          >
            <FrenzLogo size={20} />
          </span>
        </div>
      </div>

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

      {/* While you were away */}
      <AnimatePresence>
        {away ? (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-4 overflow-hidden"
          >
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600/15 to-violet-600/15 p-4 ring-1 ring-inset ring-violet-500/20">
              <button
                type="button"
                onClick={() => setAway(null)}
                aria-label="Dismiss"
                className="absolute right-3 top-3 text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-500 dark:text-violet-300">
                <Clock className="h-3.5 w-3.5" /> While you were away
              </p>
              <p className="mt-1 text-sm font-medium">
                {away.newPosts} new {away.newPosts === 1 ? "post" : "posts"} in the last {away.sinceHours}h
                {away.fromFollowing > 0 ? ` · ${away.fromFollowing} from people you follow` : ""}.
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Segments */}
      <div className="flex items-center gap-1 rounded-2xl bg-secondary/60 p-1">
        {SEGMENTS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => changeSegment(t.key)}
            aria-pressed={sort === t.key}
            className={cn(
              "flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition",
              sort === t.key ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Smart Filters */}
      <div className="-mx-1 mt-3 mb-4 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition",
              filter === f.id
                ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-sm shadow-violet-500/25"
                : "border border-border/70 bg-card/60 text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {switching ? (
        <FeedSkeleton count={3} />
      ) : stream.length === 0 && !error ? (
        <ZeroEmptyFeed sort={sort} filter={filter} deck={deck} />
      ) : (
        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {stream.map((slot) =>
              slot.type === "post" ? (
                <FeedPostCard key={slot.item.id} item={slot.item} reason={slot.reason} onRemove={remove} onOpen={openViewer} />
              ) : (
                <SparkCard key={slot.card.id} card={slot.card} />
              ),
            )}
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
            onClick={() => fetchPage(sort, items.length, items.length === 0)}
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
          {nextOffset === null && stream.length > 0 && !switching ? (
            <p className="py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up ✨</p>
          ) : null}
        </>
      )}

      <PostViewer
        item={viewer?.item ?? null}
        startWithComments={viewer?.comments ?? false}
        onClose={() => setViewer(null)}
      />
      <ReelViewer item={reel} onClose={() => setReel(null)} />
    </section>
  );
}

/**
 * Zero Empty Feed (exclusive #10): the feed is never blank. When there's nothing
 * to rank, we surface clearly-labelled discovery cards so there's always a next
 * step — creators, friends and trending downloads.
 */
function ZeroEmptyFeed({
  sort,
  filter,
  deck,
}: {
  sort: HomeFeedSort;
  filter: FilterId;
  deck: ReturnType<typeof buildSparkDeck>;
}) {
  const heading =
    filter !== "all"
      ? `No ${filter === "video" ? "videos" : filter === "photo" ? "photos" : "matches"} here yet`
      : sort === "following"
        ? "Follow creators to fill this feed"
        : "Your feed is warming up";
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-dashed border-border/70 p-8 text-center">
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary">
          <Sparkles className="h-6 w-6" />
        </span>
        <p className="text-sm font-semibold">{heading}</p>
        <p className="mt-1 text-sm text-muted-foreground">Here&apos;s where to start 👇</p>
      </div>
      {deck.map((card) => (
        <SparkCard key={card.id} card={card} />
      ))}
      <Link
        href="/explore"
        className="block rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 text-center text-sm font-semibold text-white"
      >
        Explore everything
      </Link>
    </div>
  );
}
