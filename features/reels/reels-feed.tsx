"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Clapperboard } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { BrandLoader } from "@/features/app-shell/brand-loader";
import { ReelDeck } from "@/features/feed/reel-viewer";
import { getApi } from "@/lib/sdk/browser";
import type { FeedItem } from "@/lib/social/home-feed";
import { cn } from "@/lib/utils";

type Tab = "for_you" | "following";

// Module-level (not component state) so it survives a fresh mount when the
// Router Cache restores a cached in-app navigation back to /reels — the exact
// same idiom features/feed/smart-feed.tsx uses for its own "Alive on return"
// clock. Resets only on a real page reload/new tab.
let lastReelsFetchAt = 0;

/**
 * Full-screen /reels with a For You / Following toggle. "For You" is the
 * personalized deck (seeded from the server); "Following" refetches to reels only
 * from people you follow. Each tab keeps its own infinite scroll.
 */
export function ReelsFeed({
  initialItems,
  initialOffset,
  startId,
  startSlideIndex,
  commentsId,
  onClose,
}: {
  initialItems: FeedItem[];
  initialOffset: number | null;
  /** Seed the For You deck on this video (feed/trending tap opens here). */
  startId?: string;
  /** Which video of that reel's own album to open on — a feed/post carousel
   *  tap on slide N of a video album should land there, not always slide 0. */
  startSlideIndex?: number;
  /** Open this reel's comments on entry. */
  commentsId?: string | null;
  /** When rendered as an in-place overlay (from the feed), closes via state. */
  onClose?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Deep-linked from a "Comment" tap (?start=<id>&comments=1) OR passed directly.
  const autoOpenCommentsId = commentsId ?? (searchParams.get("comments") === "1" ? searchParams.get("start") : null);
  // Overlay use closes via state; the /reels route goes back (instant, cached) or
  // falls back to /home.
  const close = useCallback(() => {
    if (onClose) return onClose();
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/home");
  }, [router, onClose]);
  const [tab, setTab] = useState<Tab>("for_you");
  const [items, setItems] = useState<FeedItem[]>(initialItems);
  const [offset, setOffset] = useState<number | null>(initialOffset);
  const [switching, setSwitching] = useState(false);
  // Slide direction for the tab transition (For You ↔ Following).
  const [direction, setDirection] = useState(1);
  const seen = useRef<Set<string>>(new Set(initialItems.map((i) => i.id)));
  const loading = useRef(false);

  // Per-tab cache so switching is instant and never reloads/flashes a loader
  // once a tab has been visited — snapshotted the moment you swipe away, and
  // restored verbatim (items, pagination cursor, dedup set) on return.
  const cacheRef = useRef<Record<Tab, { items: FeedItem[]; offset: number | null; seen: Set<string> } | null> | null>(null);
  if (!cacheRef.current) {
    cacheRef.current = { for_you: { items: initialItems, offset: initialOffset, seen: seen.current }, following: null };
  }
  // Remembers the last reel index viewed per tab, so returning to a tab lands
  // on the same reel instead of jumping back to the first one ("the top").
  const lastIndexRef = useRef<Record<Tab, number>>({ for_you: 0, following: 0 });
  // True once For You has reported an active index at least once — after that,
  // a return visit resumes from `lastIndexRef` instead of re-seeking `startId`.
  const forYouSeeded = useRef(false);

  const fetchPage = useCallback(async (sort: Tab, off: number) => {
    try {
      // Reels has its OWN API (format='reel' posts only) — a separate product
      // from the feed, through the shared SDK like everything else.
      const res = await getApi().action<{ items: FeedItem[]; nextOffset: number | null }>("/api/reels", {
        method: "GET",
        query: { sort, offset: off, limit: 24 },
      });
      if (off === 0) lastReelsFetchAt = Date.now();
      return res;
    } catch {
      return { items: [] as FeedItem[], nextOffset: null as number | null };
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loading.current || offset === null) return;
    loading.current = true;
    try {
      const d = await fetchPage(tab, offset);
      const fresh = (d.items ?? []).filter((i) => i.mediaKind === "video" && !seen.current.has(i.id));
      for (const i of fresh) seen.current.add(i.id);
      if (fresh.length) setItems((prev) => [...prev, ...fresh]);
      setOffset(d.nextOffset);
    } finally {
      loading.current = false;
    }
  }, [offset, tab, fetchPage]);

  const switchTab = useCallback(
    async (next: Tab) => {
      if (next === tab || switching) return;
      // Snapshot exactly where we're leaving so returning here is instant and
      // resumes on the same reel.
      cacheRef.current![tab] = { items, offset, seen: seen.current };
      setDirection(next === "following" ? 1 : -1);
      setTab(next);
      const cached = cacheRef.current![next];
      if (cached) {
        // Already loaded (or silently prefetched below) — instant, no
        // spinner, no reload, no jump to the first reel.
        seen.current = cached.seen;
        setItems(cached.items);
        setOffset(cached.offset);
        return;
      }
      setSwitching(true);
      seen.current = new Set();
      setItems([]);
      setOffset(null);
      const d = await fetchPage(next, 0);
      const fresh = (d.items ?? []).filter((i) => i.mediaKind === "video" && !seen.current.has(i.id));
      for (const i of fresh) seen.current.add(i.id);
      setItems(fresh);
      setOffset(d.nextOffset);
      setSwitching(false);
    },
    [tab, switching, items, offset, fetchPage],
  );

  // Silently warm the Following tab in the background the moment the deck
  // mounts, so even the FIRST swipe/tap to it is instant instead of showing
  // the full-screen loader.
  useEffect(() => {
    if (cacheRef.current!.following) return;
    let cancelled = false;
    void (async () => {
      const d = await fetchPage("following", 0);
      if (cancelled) return;
      const freshSeen = new Set<string>();
      const fresh = (d.items ?? []).filter((i) => i.mediaKind === "video" && !freshSeen.has(i.id));
      fresh.forEach((i) => freshSeen.add(i.id));
      cacheRef.current!.following = { items: fresh, offset: d.nextOffset, seen: freshSeen };
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  // Alive on return: a reel posted while this installed PWA was backgrounded
  // (or the device was offline) never showed up even after switching back to
  // the app — this deck has no realtime subscription and, unlike smart-feed's
  // Home feed, no client refetch at all beyond explicit pagination, so it just
  // sat on whatever `initialItems` SSR handed it at the last real page load.
  // Coming back after ≥2 min quietly fetches page 0 of the CURRENT tab and
  // APPENDS any genuinely new reels to the end of the deck (never prepends or
  // replaces — the reel the viewer is actively on must never move).
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const lastHiddenAt = useRef<number | null>(null);
  useEffect(() => {
    const STALE_MS = 2 * 60_000;

    const revive = async () => {
      const activeTab = tabRef.current;
      const d = await fetchPage(activeTab, 0);
      if (tabRef.current !== activeTab) return; // switched tabs while this was in flight
      const fresh = (d.items ?? []).filter((i) => i.mediaKind === "video" && !seen.current.has(i.id));
      if (!fresh.length) return;
      for (const i of fresh) seen.current.add(i.id);
      setItems((prev) => [...prev, ...fresh]);
    };

    // Covers returning via cached CROSS-PAGE navigation too (the generous
    // staleTimes.dynamic in next.config.ts is what makes that nav instant) —
    // visibilitychange alone can't see that case, the tab was never actually
    // hidden. `lastReelsFetchAt` is module-level so it's correct regardless of
    // whether this component instance persisted or got a fresh mount.
    if (lastReelsFetchAt === 0) lastReelsFetchAt = Date.now(); // true first mount — SSR data is already fresh
    else if (Date.now() - lastReelsFetchAt >= STALE_MS) void revive();

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        lastHiddenAt.current = Date.now();
      } else if (lastHiddenAt.current !== null) {
        if (Date.now() - lastHiddenAt.current >= STALE_MS) void revive();
        lastHiddenAt.current = null;
      }
    };
    const onOnline = () => void revive();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [fetchPage]);

  return (
    <>
      {/* For You / Following toggle — minimal text, no pill/border, just a thin
          sliding underline to identify the active tab (small enough to always
          fit, even on the narrowest phones). Sits near the very top on every
          size — on lg it's re-centered over the actual video-viewing area:
          the app sidebar (16rem) on the left AND the persistent comments panel
          (400px) reserved on the right, so it never compresses against the
          top-right options (•••) button. */}
      <div className="fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-40 flex -translate-x-1/2 items-center gap-6 lg:left-[calc(50%-4.5rem)]">
        {([
          { id: "for_you" as const, label: "For You" },
          { id: "following" as const, label: "Following" },
        ]).map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTab(t.id)}
              aria-pressed={on}
              className="relative flex flex-col items-center gap-1 px-0.5 py-1 transition active:scale-95"
            >
              <span className={cn("text-[13px] font-semibold drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)] transition-colors", on ? "text-white" : "text-white/60 hover:text-white/85")}>
                {t.label}
              </span>
              {on ? (
                <motion.span layoutId="reel-tab-underline" transition={{ type: "spring", stiffness: 420, damping: 34 }} className="h-[3px] w-5 rounded-full bg-white" />
              ) : (
                <span className="h-[3px] w-5" aria-hidden />
              )}
            </button>
          );
        })}
      </div>

      {switching ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black" aria-hidden>
          <BrandLoader size={60} delayMs={0} overlay={false} />
        </div>
      ) : items.length === 0 ? (
        <div className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center">
          <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-3xl bg-secondary text-muted-foreground">
            <Clapperboard className="h-6 w-6" />
          </span>
          <p className="font-semibold">{tab === "following" ? "No reels from people you follow" : "No reels yet"}</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            {tab === "following"
              ? "Follow more creators to fill your Following reels."
              : "Follow creators or publish a video to see reels here."}
          </p>
          <Link href="/explore" className="mt-4 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white shadow-md brand-glow">
            Discover creators
          </Link>
        </div>
      ) : (
        /* The two tabs SLIDE past each other (owner spec: smooth switching,
           never a reload or jump) — pure transform/opacity, GPU-composited.
           Each tab's deck resumes on its last reel, and the reel itself
           resumes at its last playback position (resume-positions store).
           This wrapper is `fixed inset-0` (matching ReelDeck's own root)
           rather than a plain in-flow box: framer-motion leaves an inline
           `transform` on an animated element even at rest, and ANY transform
           on an ancestor makes descendant `position: fixed` children (the
           reel's top bar, scrubber, safe-area chrome…) anchor to THAT
           ancestor's box instead of the true viewport — which is exactly
           what silently stopped the reel deck short of the real screen edges
           (under the status bar) once this slide wrapper was introduced. A
           `fixed inset-0` wrapper's box already equals the full viewport, so
           nothing shifts — the fix is invisible except that the deck reaches
           all the way to the true top again. */
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={tab}
            custom={direction}
            initial={{ x: direction >= 0 ? "18%" : "-18%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: direction >= 0 ? "-18%" : "18%", opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
            className="fixed inset-0 z-30"
          >
            <ReelDeck
              items={items}
              // First time For You mounts, seed on the tapped clip (deep link from
              // the feed); every other mount (a return visit after switching away)
              // resumes on whichever reel was last active in this tab, instead of
              // jumping back to the first one.
              startIndex={
                tab === "for_you" && startId && !forYouSeeded.current
                  ? Math.max(0, items.findIndex((i) => i.id === startId))
                  : (lastIndexRef.current[tab] ?? 0)
              }
              startSlideIndex={tab === "for_you" && startId && !forYouSeeded.current ? startSlideIndex : undefined}
              variant="page"
              onEndReached={loadMore}
              onClose={close}
              autoOpenCommentsId={tab === "for_you" ? autoOpenCommentsId : null}
              // Swipe left reveals the next tab (Following, to the right in the tab
              // list); swipe right goes back — same instant switch as tapping.
              onSwipeTab={(dir) => void switchTab(dir === "left" ? "following" : "for_you")}
              onActiveIndexChange={(i) => {
                lastIndexRef.current[tab] = i;
                if (tab === "for_you") forYouSeeded.current = true;
              }}
            />
          </motion.div>
        </AnimatePresence>
      )}
    </>
  );
}
