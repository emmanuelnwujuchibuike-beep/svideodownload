"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowUp,
  ChevronUp,
  Clock,
  Flame,
  Image as ImageIcon,
  LayoutGrid,
  MessageSquare,
  Sparkles,
  Video,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";

import dynamic from "next/dynamic";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { useTopbarHidden } from "@/features/app-shell/topbar-visibility";
import { FeedPostCard } from "@/features/feed/feed-post-card";
import { FeedSkeleton } from "@/features/feed/feed-skeleton";
import { SparkCard } from "@/features/feed/spark-card";
import type { FeedItem, HomeFeedSort } from "@/lib/social/home-feed";

// The full-screen overlays are interaction-only — code-split so the entire reels
// engine, post viewer and image viewer stay OUT of the initial /home bundle and
// load on first tap. `ssr: false` because they never render on the server.
const ReelsFeed = dynamic(() => import("@/features/reels/reels-feed").then((m) => m.ReelsFeed), {
  ssr: false,
  // Paint black instantly on first tap while the (cached-after) chunk loads.
  loading: () => <div className="fixed inset-0 z-[85] bg-black" aria-hidden />,
});
// Warms the reels chunk ahead of the actual tap so opening feels instant instead
// of showing that black loading frame — the exact same import `dynamic` uses, so
// once it resolves the browser's module cache already has it and mounting is
// synchronous. Safe to call repeatedly (the import is memoized by the runtime).
function preloadReelsFeed() {
  void import("@/features/reels/reels-feed");
}
const PostViewer = dynamic(() => import("@/features/feed/post-viewer").then((m) => m.PostViewer), { ssr: false });
const ImageViewer = dynamic(() => import("@/features/feed/image-viewer").then((m) => m.ImageViewer), { ssr: false });
import {
  type AwaySummary,
  buildSmartStream,
  buildSparkDeck,
  summarizeAway,
} from "@/lib/social/smart-feed";
import { getApi } from "@/lib/sdk/browser";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Icon = ComponentType<{ className?: string }>;

const SEGMENTS: { key: HomeFeedSort; label: string }[] = [
  { key: "for_you", label: "For You" },
  { key: "following", label: "Following" },
  { key: "recent", label: "Reels" },
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
const NAV_OPEN_KEY = "frenz:feed-nav-open";
const PULL_THRESHOLD = 72;
const SWIPE_THRESHOLD = 64;
/** Inline, swipeable tabs — "Reels" isn't inline content (it opens the deck
 *  overlay), so it's handled as the swipe destination past the last one. */
const SWIPE_ORDER: HomeFeedSort[] = ["for_you", "following"];

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
  const [items, setItems] = useState<FeedItem[]>(initialItems);
  const [nextOffset, setNextOffset] = useState<number | null>(initialNextOffset);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState(false);
  const [freshCount, setFreshCount] = useState(0);
  const [away, setAway] = useState<AwaySummary | null>(null);
  const [viewer, setViewer] = useState<{ item: FeedItem; comments: boolean } | null>(null);
  const [image, setImage] = useState<FeedItem | null>(null);
  // When the top nav auto-hides on scroll (mobile), the segmented control
  // shifts up to fill the gap it leaves instead of floating below blank space.
  const topbarHidden = useTopbarHidden();
  const [reel, setReel] = useState<{ startId: string; commentsId: string | null } | null>(null);
  // Once an overlay has been opened we keep it mounted (it hides itself when its
  // item is null) so its close animation plays; before first use its chunk is
  // never loaded.
  const [viewerReady, setViewerReady] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  // The nav (segmented control + filter chips) can be tucked away via the tiny
  // handle at its bottom edge — remembered across visits like the quality
  // preference elsewhere in the app.
  const [navOpen, setNavOpen] = useState(true);
  useEffect(() => {
    try {
      const v = localStorage.getItem(NAV_OPEN_KEY);
      if (v === "0") setNavOpen(false);
    } catch {
      /* storage unavailable — default open */
    }
  }, []);
  const toggleNavOpen = useCallback(() => {
    setNavOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(NAV_OPEN_KEY, next ? "1" : "0");
      } catch {
        /* private mode — just won't persist */
      }
      return next;
    });
  }, []);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  // Per-tab cache (For You / Following) so switching is instant and never
  // reloads/flashes a skeleton once a tab has been visited — each entry keeps
  // its own items/pagination cursor/dedup set, restored verbatim on return.
  const sortRef = useRef(sort);
  sortRef.current = sort;
  const cacheRef = useRef<Partial<Record<HomeFeedSort, { items: FeedItem[]; nextOffset: number | null; seen: Set<string> }>> | null>(null);
  if (!cacheRef.current) {
    cacheRef.current = {
      for_you: { items: initialItems, nextOffset: initialNextOffset, seen: new Set(initialItems.map((i) => i.id)) },
    };
  }
  // Scroll position per tab, so switching back "continues from where it
  // stopped" instead of resetting to the top. `direction` drives which way
  // the slide/fade transition below plays (1 = forward/left, -1 = back/right).
  const scrollPosRef = useRef<Partial<Record<HomeFeedSort, number>>>({});
  const restoreScrollFor = useRef<HomeFeedSort | null>(null);
  const [direction, setDirection] = useState(0);

  const deck = useMemo(() => buildSparkDeck({ friendCount }), [friendCount]);
  // Every loaded video, in feed order — the reel playlist. Kept live so the open
  // deck keeps growing as the feed loads more (infinite, TikTok-style).
  const videos = useMemo(() => items.filter((i) => i.mediaKind === "video"), [items]);
  // Latest videos via a ref so openViewer stays a STABLE callback — memoized feed
  // cards then never re-render just because the list grew.
  const videosRef = useRef(videos);
  videosRef.current = videos;

  // Warm the reels chunk once the feed itself has settled — Reels is the single
  // most likely next tap, so by the time anyone actually hits the button its code
  // is already sitting in the browser's module cache and opening it never shows
  // the black loading frame. Deferred to idle time so it never competes with the
  // feed's own first paint/hydration.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ric = window.requestIdleCallback ?? ((cb: IdleRequestCallback) => window.setTimeout(() => cb({} as IdleDeadline), 1500));
    const cic = window.cancelIdleCallback ?? window.clearTimeout;
    const id = ric(preloadReelsFeed);
    return () => cic(id);
  }, []);

  // Videos open the full-screen reel INSTANTLY (client-side, no navigation/server
  // round-trip) seeded on the tapped clip; everything else opens the split viewer.
  const openViewer = useCallback((it: FeedItem, comments = false) => {
    if (it.mediaKind === "video") {
      setReel({ startId: it.id, commentsId: comments ? it.id : null });
    } else if (it.mediaKind === "image") {
      // Photos open full-screen + immersive (closeable like X / Instagram).
      setImageReady(true);
      setImage(it);
    } else {
      setViewerReady(true);
      setViewer({ item: it, comments });
    }
  }, []);

  const fetchPage = useCallback(
    async (s: HomeFeedSort, offset: number, replace: boolean) => {
      const isActiveTab = () => s === sortRef.current;
      // Only the tab actually on screen shows loading UI — a background
      // prefetch of the other tab (below) must stay invisible.
      if (isActiveTab()) {
        if (replace) setSwitching(true);
        else setLoading(true);
        setError(false);
      }
      try {
        // Through the shared SDK — same client/path (auth, dedupe, retry, timeout)
        // the native apps use.
        const data = await getApi().action<{ items: FeedItem[]; nextOffset: number | null }>("/api/home-feed", {
          method: "GET",
          query: { sort: s, offset, limit: PAGE },
        });
        const entry = cacheRef.current![s] ?? { items: [], nextOffset: null, seen: new Set<string>() };
        if (replace) {
          entry.seen = new Set(data.items.map((i) => i.id));
          entry.items = data.items;
        } else {
          const fresh = data.items.filter((i) => !entry.seen.has(i.id));
          fresh.forEach((i) => entry.seen.add(i.id));
          entry.items = [...entry.items, ...fresh];
        }
        entry.nextOffset = data.nextOffset;
        cacheRef.current![s] = entry;
        if (isActiveTab()) {
          setItems(entry.items);
          setNextOffset(entry.nextOffset);
        }
      } catch {
        if (isActiveTab()) setError(true);
      } finally {
        if (isActiveTab()) {
          setLoading(false);
          setSwitching(false);
        }
      }
    },
    [],
  );

  // Silently warm the Following tab's data once the feed has settled, so the
  // FIRST tap on "Following" is also instant instead of showing a skeleton
  // (fetchPage no-ops on the visible UI here since Following isn't active yet).
  useEffect(() => {
    if (typeof window === "undefined" || cacheRef.current?.following) return;
    const ric = window.requestIdleCallback ?? ((cb: IdleRequestCallback) => window.setTimeout(() => cb({} as IdleDeadline), 1500));
    const cic = window.cancelIdleCallback ?? window.clearTimeout;
    const id = ric(() => void fetchPage("following", 0, true));
    return () => cic(id);
  }, [fetchPage]);

  const changeSegment = (s: HomeFeedSort) => {
    if (s === sort) return;
    // Remember exactly where we're leaving so returning here resumes at the
    // same scroll position instead of jumping to the top.
    scrollPosRef.current[sort] = window.scrollY;
    restoreScrollFor.current = s;
    setDirection(SWIPE_ORDER.indexOf(s) > SWIPE_ORDER.indexOf(sort) ? 1 : -1);
    setSort(s);
    // Instant, no reload/skeleton flash, no jump — a visited tab's items are
    // shown verbatim from cache; only a never-visited tab fetches (rare, since
    // the idle prefetch above warms it ahead of time).
    const cached = cacheRef.current![s];
    if (cached) {
      setItems(cached.items);
      setNextOffset(cached.nextOffset);
      setError(false);
    } else {
      void fetchPage(s, 0, true);
    }
  };

  // The third tab is "Reels" on every device — it opens the full reels
  // experience IN PLACE — instant, no route change or loader — seeded on the
  // first already-loaded video. Only if nothing is loaded yet do we fall back
  // to navigating to the /reels route.
  const onSegment = (key: HomeFeedSort) => {
    if (key === "recent") {
      const first = videosRef.current[0];
      if (first) setReel({ startId: first.id, commentsId: null });
      else router.push("/reels");
      return;
    }
    changeSegment(key);
  };

  // Restores the scroll position saved for a tab, once its content has
  // actually rendered (so the page is tall enough to scroll to it). Guarded so
  // it only fires once per real switch, not on every subsequent items change
  // (e.g. infinite-scroll loading more of the CURRENT tab).
  useEffect(() => {
    if (restoreScrollFor.current !== sort) return;
    restoreScrollFor.current = null;
    const y = scrollPosRef.current[sort] ?? 0;
    requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "auto" }));
  }, [sort, items]);

  // A decisive horizontal swipe on the feed switches tabs instantly, the same
  // as tapping — swiping past "Following" opens Reels (same action as tapping
  // its tab). Disambiguated from vertical scroll/pull-to-refresh via the same
  // axis-lock the reel viewer uses.
  const swipeTo = useCallback(
    (dir: "left" | "right") => {
      const idx = SWIPE_ORDER.indexOf(sort);
      if (dir === "left") {
        if (idx < SWIPE_ORDER.length - 1) changeSegment(SWIPE_ORDER[idx + 1]!);
        else onSegment("recent");
      } else if (idx > 0) {
        changeSegment(SWIPE_ORDER[idx - 1]!);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sort],
  );

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
          const activeSeen = cacheRef.current?.[sortRef.current]?.seen;
          if (row.status === "published" && row.visibility === "public" && row.id && !activeSeen?.has(row.id)) {
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

  // Horizontal swipe-to-switch-tabs shares the same touch handlers as
  // pull-to-refresh — axis-locked (as reels does) so a mostly-vertical drag
  // never gets misread as a swipe, and vice versa.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const swipeAxis = useRef<"h" | "v" | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const y = t?.clientY;
    if (y !== undefined && window.scrollY <= 0 && !refreshing) pullStart.current = y;
    else pullStart.current = null;
    swipeStart.current = t ? { x: t.clientX, y: t.clientY } : null;
    swipeAxis.current = null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const y = t?.clientY;
    if (pullStart.current !== null && y !== undefined) {
      const delta = y - pullStart.current;
      if (delta > 0 && window.scrollY <= 0) setPull(Math.min(110, delta * 0.5));
      else if (pull !== 0) setPull(0);
    }
    if (swipeStart.current && swipeAxis.current === null && t) {
      const dx = Math.abs(t.clientX - swipeStart.current.x);
      const dy = Math.abs(t.clientY - swipeStart.current.y);
      if (dx > 10 || dy > 10) swipeAxis.current = dx > dy ? "h" : "v";
    }
  };
  const onTouchEnd = async (e: React.TouchEvent) => {
    if (swipeAxis.current === "h" && swipeStart.current) {
      const endX = e.changedTouches[0]?.clientX ?? swipeStart.current.x;
      const dx = endX - swipeStart.current.x;
      if (Math.abs(dx) > SWIPE_THRESHOLD) swipeTo(dx < 0 ? "left" : "right");
    }
    swipeStart.current = null;
    swipeAxis.current = null;

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
      // Vertical scroll/pull-to-refresh stays entirely native; horizontal
      // swipes are read in JS only (never blocked), same as the reel viewer.
      style={{ touchAction: "pan-y" }}
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

      {/* Controls — a sticky, world-class nav bar. A hairline-bordered glass rail
          holds the hero segmented control (smooth spring-slid indicator) and a
          quiet row of filter chips (edge-faded on mobile; on large screens they
          spread edge-to-edge since there's room). Collapsible via the tiny handle
          at its bottom edge — remembered across visits. Animations are
          transform/opacity/height only (GPU) — premium motion, no jank.
          `backdrop-blur-lg` (not the heavier `-2xl`) — a deliberate perf trim from
          the earlier nav pass; the inset highlight below gives the same premium
          glass feel without the extra GPU cost. */}
      <div
        className={cn(
          "sticky top-16 z-20 -mx-3 mb-4 rounded-b-2xl border-b border-border/50 bg-background/90 px-3 pb-2.5 pt-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_28px_-18px_rgba(0,0,0,0.3)] backdrop-blur-lg transition-transform duration-300 will-change-transform sm:-mx-4 sm:px-4",
          topbarHidden ? "-translate-y-16 lg:translate-y-0" : "translate-y-0",
        )}
      >
        {/* Hero segmented control — minimal text + a thin sliding underline (same
            identity language as the Reels tabs), no pill/border. Always visible,
            even with the filter chips tucked away below. */}
        <div className="flex items-center justify-center gap-8">
          {SEGMENTS.map((t) => {
            const on = sort === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => onSegment(t.key)}
                // Belt-and-suspenders on top of the idle-time warm-up above:
                // pointerdown fires before click on both mouse and touch, so if
                // the idle callback hasn't run yet on a busy device this still
                // buys the chunk fetch a head start before the tap completes.
                onPointerDown={t.key === "recent" ? preloadReelsFeed : undefined}
                aria-pressed={on}
                className="relative flex flex-col items-center gap-1.5 px-0.5 py-1.5 transition active:scale-95"
              >
                <span className={cn("text-[13px] font-semibold tracking-tight transition-colors", on ? "text-foreground" : "text-muted-foreground hover:text-foreground/80")}>
                  {t.label}
                </span>
                {on ? (
                  <motion.span layoutId="seg-underline" transition={{ type: "spring", stiffness: 420, damping: 34 }} className="h-[3px] w-5 rounded-full bg-brand" />
                ) : (
                  <span className="h-[3px] w-5" aria-hidden />
                )}
              </button>
            );
          })}
        </div>

        {/* Quiet filter chips — collapsible via the tiny handle below; the
            segmented control above always stays put. Ghost by default,
            brand-gradient glow when active. Edge-faded horizontal scroll on
            mobile (right-only — never clips the usually-active first chip); on
            large screens there's always room for all five, so they justify
            edge-to-edge instead. */}
        <motion.div
          initial={false}
          animate={{ height: navOpen ? "auto" : 0, opacity: navOpen ? 1 : 0 }}
          transition={{ type: "spring", stiffness: 340, damping: 34 }}
          className="overflow-hidden"
        >
          <div className="-mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [-webkit-mask-image:linear-gradient(90deg,#000_0,#000_90%,transparent)] [mask-image:linear-gradient(90deg,#000_0,#000_90%,transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:justify-between lg:overflow-visible lg:[-webkit-mask-image:none] lg:[mask-image:none]">
            {FILTERS.map((f) => {
              const on = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={on}
                  className={cn(
                    "relative flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-95",
                    on ? "text-white" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {on ? (
                    <motion.span
                      layoutId="filter-pill"
                      transition={{ type: "spring", stiffness: 480, damping: 40 }}
                      className="bg-brand brand-glow absolute inset-0 rounded-full"
                    />
                  ) : null}
                  <f.icon className={cn("relative z-10 h-3.5 w-3.5", on ? "opacity-100" : "opacity-70")} strokeWidth={2.1} />
                  <span className="relative z-10">{f.label}</span>
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* Tiny collapse/expand handle — a small tab at the very bottom edge of
            the nav, on every screen size. Only tucks away the filter chips —
            the For You / Following / Reels tabs above always stay visible. */}
        <button
          type="button"
          onClick={toggleNavOpen}
          aria-label={navOpen ? "Hide filters" : "Show filters"}
          aria-expanded={navOpen}
          className="absolute -bottom-2.5 left-1/2 z-10 flex h-5 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-border/60 bg-background shadow-sm transition hover:bg-secondary active:scale-90"
        >
          <motion.span animate={{ rotate: navOpen ? 0 : 180 }} transition={{ type: "spring", stiffness: 380, damping: 30 }} className="flex">
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          </motion.span>
        </button>
      </div>

      {/* Switching tabs (tap OR swipe) slides + crossfades the whole pane —
          `popLayout` takes the outgoing pane out of flow so it doesn't add
          height while both briefly overlap. Purely transform/opacity (GPU),
          and never delays the new content — it's already cached, so it
          appears instantly while the transition plays. */}
      <div className="relative">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={sort}
            initial={{ opacity: 0, x: direction >= 0 ? 24 : -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction >= 0 ? -24 : 24 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
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
          </motion.div>
        </AnimatePresence>
      </div>

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

      {viewerReady ? (
        <PostViewer
          item={viewer?.item ?? null}
          startWithComments={viewer?.comments ?? false}
          onClose={() => setViewer(null)}
        />
      ) : null}
      {imageReady ? <ImageViewer item={image} onClose={() => setImage(null)} /> : null}

      {/* Instant, in-place full reels experience (For You / Following tabs), nav
          visible, seeded on the tapped video — closes via state (no navigation). */}
      {reel && videos.length ? (
        <ReelsFeed
          initialItems={videos}
          initialOffset={nextOffset}
          startId={reel.startId}
          commentsId={reel.commentsId}
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
