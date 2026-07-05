"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowUp,
  Clock,
  Flame,
  Image as ImageIcon,
  LayoutGrid,
  MessageSquare,
  Sparkles,
  Users,
  Video,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { FeedPostCard } from "@/features/feed/feed-post-card";
import { FeedSkeleton } from "@/features/feed/feed-skeleton";
import { PostViewer } from "@/features/feed/post-viewer";
import { ReelDeck } from "@/features/feed/reel-viewer";
import { SparkCard } from "@/features/feed/spark-card";
import type { FeedItem, HomeFeedSort } from "@/lib/social/home-feed";
import {
  type AwaySummary,
  balanceByKind,
  buildSmartStream,
  buildSparkDeck,
  summarizeAway,
} from "@/lib/social/smart-feed";
import { getApi } from "@/lib/sdk/browser";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Icon = ComponentType<{ className?: string }>;

const SEGMENTS: { key: HomeFeedSort; label: string; icon: Icon }[] = [
  { key: "for_you", label: "For You", icon: Sparkles },
  { key: "following", label: "Following", icon: Users },
  { key: "recent", label: "Fresh", icon: Clock },
];

/** Smart Filters reshape the loaded stream — kind filters + honest reorders. */
const FILTERS = [
  { id: "all", label: "All", icon: LayoutGrid },
  { id: "video", label: "Videos", icon: Video },
  { id: "photo", label: "Photos", icon: ImageIcon },
  { id: "popular", label: "Popular", icon: Flame },
  { id: "discussed", label: "Discussed", icon: MessageSquare },
] as const satisfies readonly { id: string; label: string; icon: Icon }[];
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
  const [reel, setReel] = useState<{ start: number; commentsId: string | null } | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const seen = useRef(new Set(initialItems.map((i) => i.id)));
  const router = useRouter();

  const deck = useMemo(() => buildSparkDeck({ friendCount }), [friendCount]);
  // Every loaded video, in feed order — the reel playlist. Kept live so the open
  // deck keeps growing as the feed loads more (infinite, TikTok-style).
  const videos = useMemo(() => items.filter((i) => i.mediaKind === "video"), [items]);
  // Latest videos via a ref so openViewer stays a STABLE callback — memoized feed
  // cards then never re-render just because the list grew.
  const videosRef = useRef(videos);
  videosRef.current = videos;

  // Videos open the full-screen reel INSTANTLY (client-side, no navigation/server
  // round-trip) seeded on the tapped clip; everything else opens the split viewer.
  const openViewer = useCallback((it: FeedItem, comments = false) => {
    if (it.mediaKind === "video") {
      const start = Math.max(0, videosRef.current.findIndex((v) => v.id === it.id));
      setReel({ start, commentsId: comments ? it.id : null });
    } else setViewer({ item: it, comments });
  }, []);

  const fetchPage = useCallback(
    async (s: HomeFeedSort, offset: number, replace: boolean) => {
      if (replace) setSwitching(true);
      else setLoading(true);
      setError(false);
      try {
        // Through the shared SDK — same client/path (auth, dedupe, retry, timeout)
        // the native apps use.
        const data = await getApi().action<{ items: FeedItem[]; nextOffset: number | null }>("/api/home-feed", {
          method: "GET",
          query: { sort: s, offset, limit: PAGE },
        });
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

  // The third tab is "Fresh" on desktop (recent feed) but "Reels" on mobile,
  // where it jumps straight into the full-screen reels experience.
  const onSegment = (key: HomeFeedSort) => {
    if (key === "recent" && typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      router.push("/reels");
      return;
    }
    changeSegment(key);
  };

  const remove = useCallback((id: string) => setItems((prev) => prev.filter((i) => i.id !== id)), []);

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
          {/* Colorless, quiet refresh hint — a faint grayscale F (no colorful
              spinner). Rotates a touch with the pull; gently pulses while working. */}
          <span
            className={cn(
              "relative flex h-9 w-9 items-center justify-center rounded-full bg-secondary/60 ring-1 ring-border/50 backdrop-blur",
              refreshing && "motion-safe:animate-pulse",
            )}
            style={{ transform: `rotate(${pull * 2}deg)` }}
          >
            <span className="block [filter:grayscale(1)]" style={{ opacity: 0.3 + pullProgress * 0.45 }}>
              <FrenzLogo size={18} />
            </span>
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
              <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
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

      {/* Controls — sticky under the top bar so you never have to scroll up to
          switch, with a matured monochrome sliding pill (Facebook/X-like, not a
          bright gradient). */}
      <div className="sticky top-16 z-20 -mx-3 mb-4 bg-background/85 px-3 pb-2 pt-2 backdrop-blur-xl sm:-mx-4 sm:px-4">
        {/* Segments */}
        <div className="relative flex items-center gap-1 rounded-2xl bg-secondary/50 p-1 ring-1 ring-inset ring-border/50">
          {SEGMENTS.map((t) => {
            const on = sort === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => onSegment(t.key)}
                aria-pressed={on}
                className="relative flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition active:scale-[0.97]"
              >
                {on ? (
                  <motion.span
                    layoutId="seg-pill"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-xl bg-foreground shadow-sm"
                  />
                ) : null}
                <span className={cn("relative z-10", on ? "text-background" : "text-muted-foreground hover:text-foreground")}>
                  {t.key === "recent" ? (
                    <>
                      <span className="lg:hidden">Reels</span>
                      <span className="hidden lg:inline">Fresh</span>
                    </>
                  ) : (
                    t.label
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((f) => {
            const on = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-pressed={on}
                className={cn(
                  "relative shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition active:scale-95",
                  on ? "text-background" : "border border-border/70 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                {on ? (
                  <motion.span
                    layoutId="filter-pill"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-full bg-foreground"
                  />
                ) : null}
                <span className="relative z-10 flex items-center gap-1.5">
                  <f.icon className="h-3.5 w-3.5" />
                  {f.label}
                </span>
              </button>
            );
          })}
        </div>
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
            <div className="mt-6" aria-hidden>
              <FeedSkeleton count={2} />
            </div>
          ) : null}
          {nextOffset === null && stream.length > 0 && !switching ? (
            <p className="flex items-center justify-center gap-1.5 py-6 text-center text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4" /> You&apos;re all caught up
            </p>
          ) : null}
        </>
      )}

      <PostViewer
        item={viewer?.item ?? null}
        startWithComments={viewer?.comments ?? false}
        onClose={() => setViewer(null)}
      />

      {/* Instant, in-place reel deck — nav stays visible; closes via state (no
          server round-trip on open OR close). */}
      {reel && videos.length ? (
        <ReelDeck
          items={videos}
          startIndex={reel.start}
          variant="page"
          autoOpenCommentsId={reel.commentsId}
          onEndReached={() => {
            if (nextOffset !== null && !loading) void fetchPage(sort, nextOffset, false);
          }}
          onClose={() => setReel(null)}
        />
      ) : null}
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
        <p className="mt-1 text-sm text-muted-foreground">Here&apos;s where to start</p>
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
