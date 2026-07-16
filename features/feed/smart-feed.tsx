"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowUp, Clock, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import dynamic from "next/dynamic";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { lockTopbarVisible } from "@/features/app-shell/topbar-visibility";
import { setTopbarCenter } from "@/features/app-shell/topbar-slot";
import { ContinueInReels } from "@/features/feed/continue-in-reels";
import { FeedPostCard } from "@/features/feed/feed-post-card";
import { FeedSkeleton } from "@/features/feed/feed-skeleton";
import { ImageOpenFallback } from "@/features/feed/image-open-fallback";
import { FeedTopbarTabs } from "@/features/feed/feed-topbar-tabs";
import { SparkCard } from "@/features/feed/spark-card";
import { haptic } from "@/lib/motion/haptics";
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
// Same instant-paint fallback as ReelsFeed above — PostViewer (text/audio
// posts) has no single dominant photo to preview ahead of time, so a plain
// black frame (matching Reels, which nobody's complained about) is the right
// minimal fix here; ImageViewer gets a richer one below.
const PostViewer = dynamic(() => import("@/features/feed/post-viewer").then((m) => m.PostViewer), {
  ssr: false,
  loading: () => <div className="fixed inset-0 z-[85] bg-black" aria-hidden />,
});
const ImageViewer = dynamic(() => import("@/features/feed/image-viewer").then((m) => m.ImageViewer), { ssr: false });
// Same warm-up as `preloadReelsFeed`, for the two other viewer chunks — an
// image tap should open exactly as instantly as a video tap does, not stall
// on a first-time chunk fetch. Returns the underlying promise so callers can
// track resolution (see `viewerChunksReady` below), not just fire-and-forget.
function preloadPostViewers() {
  return Promise.all([import("@/features/feed/image-viewer"), import("@/features/feed/post-viewer")]);
}
import {
  type AwaySummary,
  balanceByKind,
  buildSmartStream,
  buildSparkDeck,
  summarizeAway,
} from "@/lib/social/smart-feed";
import { loadFeedContinuity, saveFeedContinuity } from "@/lib/social/feed-continuity";
import { getApi } from "@/lib/sdk/browser";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";


const PAGE = 8;
const SEEN_KEY = "frenz:feed-seen-at";
const PULL_THRESHOLD = 72;
const SWIPE_THRESHOLD = 64;
// Module-level (not component state): when the active tab's data was actually
// last fetched from the server. Survives even if SmartFeed remounts when the
// client Router Cache restores a cached /home navigation — a plain
// `useRef`/`useState` wouldn't, since those reset on every fresh mount. This
// is what lets "auto refresh while already shown" work for CROSS-PAGE
// navigation back to Home, not just the tab-backgrounded case the "Alive on
// return" effect below already covered on its own (visibilitychange never
// fires for an in-app route change — the tab itself never actually hides).
let lastFeedFetchAt = 0;
/** Inline, swipeable tabs — "Reels" isn't inline content (it opens the deck
 *  overlay), so it's handled as the swipe destination past the last one. */
const SWIPE_ORDER: HomeFeedSort[] = ["for_you", "following"];

/** A fresh reshuffle token. Same alphabet the API route sanitises to, so it
 *  always survives the round-trip intact. */
function newFeedSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function SmartFeed({
  initialItems,
  initialNextOffset,
  initialSeed,
  friendCount = 0,
  quietMode = false,
}: {
  initialItems: FeedItem[];
  initialNextOffset: number | null;
  /** This refresh's reshuffle token, minted server-side per request (see
   *  home/page.tsx). Every page request below reuses it so the whole scroll
   *  agrees on ONE arrangement; a new one is minted only on an explicit
   *  refresh, which is what re-orders the feed. */
  initialSeed?: string;
  friendCount?: number;
  /** Feature 17 Part 13's Quiet Mode — suppresses Spark discovery cards and
   *  the "while you were away" catch-up banner; everything else (the real
   *  feed itself, infinite scroll, tab switching) is untouched. */
  quietMode?: boolean;
}) {
  const [sort, setSort] = useState<HomeFeedSort>("for_you");
  // Balanced once up front (server-rendered first page never went through
  // fetchPage's balancing below) so content-type mixing is correct from the
  // very first paint, not just after the first client-side page load.
  // Held in a ref, not state: changing it must NOT re-render on its own — it
  // only ever changes as part of a refresh that's already re-rendering.
  const seedRef = useRef<string>(initialSeed ?? newFeedSeed());
  const [items, setItems] = useState<FeedItem[]>(() => balanceByKind(initialItems));
  const [nextOffset, setNextOffset] = useState<number | null>(initialNextOffset);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState(false);
  const [freshCount, setFreshCount] = useState(0);
  const [away, setAway] = useState<AwaySummary | null>(null);
  const [viewer, setViewer] = useState<{ item: FeedItem; comments: boolean } | null>(null);
  const [image, setImage] = useState<FeedItem | null>(null);
  // Which slide of an album was actually tapped — an image viewer that always
  // opened on the first slide regardless of what was tapped read as broken.
  const [imageStartIndex, setImageStartIndex] = useState(0);
  // A feed "Comment" tap on an image/album should land straight in the
  // comments sheet, not just open the media.
  const [imageAutoComments, setImageAutoComments] = useState(false);
  // Lock the topbar visible while the feed is on screen: with it static, this
  // sticky tab bar sticks at ONE position — fixed once it touches the top,
  // never sliding around with scroll direction (owner spec).
  useEffect(() => lockTopbarVisible(), []);
  const [reel, setReel] = useState<{ startId: string; commentsId: string | null; startSlideIndex?: number } | null>(null);
  // Once an overlay has been opened we keep it mounted (it hides itself when its
  // item is null) so its close animation plays; before first use its chunk is
  // never loaded.
  const [viewerReady, setViewerReady] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  // Tracks whether the ImageViewer/PostViewer chunk has actually resolved
  // (not just "we asked for it") — drives the instant fallback preview below.
  const [viewerChunksReady, setViewerChunksReady] = useState(false);
  const viewerChunksReadyRef = useRef(false);
  viewerChunksReadyRef.current = viewerChunksReady;
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
      for_you: { items: balanceByKind(initialItems), nextOffset: initialNextOffset, seen: new Set(initialItems.map((i) => i.id)) },
    };
  }
  // Scroll position per tab, so switching back "continues from where it
  // stopped" instead of resetting to the top. `direction` drives which way
  // the slide/fade transition below plays (1 = forward/left, -1 = back/right).
  const scrollPosRef = useRef<Partial<Record<HomeFeedSort, number>>>({});
  const restoreScrollFor = useRef<HomeFeedSort | null>(null);
  const [direction, setDirection] = useState(0);

  // Snapshot the active tab + scroll position to localStorage, so leaving
  // `/home` and coming back — even after a real app restart — restores
  // "instantly resumed" rather than the plain SSR first page. Reads live refs
  // only (never a stale closure), safe to call from anywhere without adding
  // it to effect dependency arrays.
  const persistContinuity = useCallback((opts?: { sort?: HomeFeedSort; scrollY?: number }) => {
    if (typeof window === "undefined" || !cacheRef.current) return;
    saveFeedContinuity({
      sort: opts?.sort ?? sortRef.current,
      scrollY: opts?.scrollY ?? window.scrollY,
      tabs: cacheRef.current,
    });
  }, []);

  // Restore the last-visited tab, its loaded pages, and scroll position —
  // once, right after mount. Deliberately an effect (not a useState lazy
  // initializer): the very first render must match the server's SSR output
  // exactly (props-seeded `for_you` page 0) to avoid a hydration mismatch,
  // the same constraint `lib/social/story-seen.ts`'s unseen/seen rings
  // already follow. Runs before the "warm the Following tab" idle-prefetch
  // effect below (source order), so a restored Following cache is never
  // redundantly re-fetched.
  useEffect(() => {
    const snap = loadFeedContinuity();
    if (!snap) return;
    const restoredTabs: NonNullable<typeof cacheRef.current> = {};
    for (const [k, v] of Object.entries(snap.tabs) as [HomeFeedSort, { items: FeedItem[]; nextOffset: number | null }][]) {
      restoredTabs[k] = { items: v.items, nextOffset: v.nextOffset, seen: new Set(v.items.map((i) => i.id)) };
    }
    // Merge (not replace): keep the props-seeded fallback for any tab the
    // snapshot didn't happen to include.
    cacheRef.current = { ...cacheRef.current, ...restoredTabs };
    const activeTab = restoredTabs[snap.sort];
    if (!activeTab) return;
    setSort(snap.sort);
    setItems(activeTab.items);
    setNextOffset(activeTab.nextOffset);
    // Piggyback on the existing tab-switch scroll-restore effect below —
    // it's already keyed on `[sort, items]` and watches this exact ref pair.
    scrollPosRef.current[snap.sort] = snap.scrollY;
    restoreScrollFor.current = snap.sort;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Throttled scroll-position capture (min 1.5s between writes — cheap, but
  // no reason to hit localStorage on every scroll tick). Tab switches and
  // every real feed fetch also persist immediately (see `changeSegment` /
  // `fetchPage`), so this listener mainly covers "left mid-scroll, same tab."
  useEffect(() => {
    let lastAt = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - lastAt < 1500) return;
      lastAt = now;
      persistContinuity();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      persistContinuity(); // final save on unmount (e.g. navigating away)
    };
  }, [persistContinuity]);

  // Quiet Mode: no Spark/discovery cards interleaved into the stream at all.
  const deck = useMemo(() => (quietMode ? [] : buildSparkDeck({ friendCount })), [friendCount, quietMode]);
  // Every loaded video, in feed order — the reel playlist. Kept live so the open
  // deck keeps growing as the feed loads more (infinite, TikTok-style).
  const videos = useMemo(() => items.filter((i) => i.mediaKind === "video"), [items]);
  // Latest videos via a ref so openViewer stays a STABLE callback — memoized feed
  // cards then never re-render just because the list grew.
  const videosRef = useRef(videos);
  videosRef.current = videos;

  // Warm every full-screen viewer's chunk once the feed itself has settled —
  // whichever a viewer taps next (a video, an image, or Reels), its code is
  // already sitting in the browser's module cache, so opening never shows a
  // loading frame. Also prefetches the /reels ROUTE itself (not just its JS):
  // `onSegment` below falls back to a real navigation there when no video is
  // loaded yet, and that fallback should be just as instant as the in-place
  // deck. Deferred to idle time so none of this competes with the feed's own
  // first paint/hydration.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ric = window.requestIdleCallback ?? ((cb: IdleRequestCallback) => window.setTimeout(() => cb({} as IdleDeadline), 1500));
    const cic = window.cancelIdleCallback ?? window.clearTimeout;
    const id = ric(() => {
      preloadReelsFeed();
      void preloadPostViewers().then(() => setViewerChunksReady(true));
      router.prefetch("/reels");
    });
    return () => cic(id);
  }, [router]);

  // Videos open the full-screen reel INSTANTLY (client-side, no navigation/server
  // round-trip) seeded on the tapped clip; everything else opens the split viewer.
  // `startIndex` is which SLIDE of an album was actually tapped in the feed's
  // inline carousel — without it every album always opened on its first item.
  const openViewer = useCallback((it: FeedItem, comments = false, startIndex = 0) => {
    const isAlbum = (it.mediaItems?.length ?? 0) > 1;
    // The reel viewer's internal album logic only tracks VIDEO slides (it
    // filters mediaItems down to videos) — correct for an all-video album,
    // but index math would be wrong for a MIXED photo+video album (its cover
    // can still be a video). Mixed albums always go through the image
    // viewer's swipe stage instead, which renders every slide in order
    // regardless of kind.
    const allVideo = isAlbum && it.mediaItems!.every((m) => m.kind === "video");
    if (it.mediaKind === "video" && (!isAlbum || allVideo)) {
      setReel({ startId: it.id, commentsId: comments ? it.id : null, startSlideIndex: startIndex });
    } else if (isAlbum || it.mediaKind === "image") {
      // Photos (and photo/mixed albums) open full-screen + immersive
      // (closeable like X / Instagram). `comments` was previously dropped
      // here — a feed "Comment" tap on an image/album silently opened the
      // media without ever showing the comments sheet.
      setImageReady(true);
      setImage(it);
      setImageStartIndex(startIndex);
      setImageAutoComments(comments);
      // Belt-and-suspenders: kick the fetch again right at the moment of
      // open, in case this tap landed before the idle-preload above (or the
      // tap-time prefetch in FeedImage/MediaCarousel) had a chance to run —
      // a no-op if already in flight/resolved (dynamic imports are cached).
      if (!viewerChunksReadyRef.current) {
        void import("@/features/feed/image-viewer").then(() => setViewerChunksReady(true));
      }
    } else {
      setViewerReady(true);
      setViewer({ item: it, comments });
    }
  }, []);

  const fetchPage = useCallback(
    /**
     * `silent` — fetch and swap content in WITHOUT painting any loading state.
     *
     * Owner (2026-07-16): "recheck homepage so it never reloads on every
     * entry." The cross-page navigation back to Home was already instant (the
     * 6h `staleTimes.dynamic` serves it from the client Router Cache) — but
     * "alive on return" then immediately called this with `replace: true`,
     * which flipped `switching` and repainted the whole feed as loading ON TOP
     * of the already-restored content. So Home looked like it reloaded on every
     * entry, even though the navigation itself never did.
     *
     * Silent keeps the freshness and drops the flash: the restored content stays
     * on screen and is replaced only once the new data has actually arrived.
     * Deliberately NOT applied to a user-initiated refresh (pull-to-refresh /
     * the new-posts pill) — there the spinner is the acknowledgement that the
     * tap did something, and removing it would feel broken.
     */
    async (s: HomeFeedSort, offset: number, replace: boolean, silent = false) => {
      const isActiveTab = () => s === sortRef.current;
      // Only the tab actually on screen shows loading UI — a background
      // prefetch of the other tab (below) must stay invisible.
      if (isActiveTab() && !silent) {
        if (replace) setSwitching(true);
        else setLoading(true);
        setError(false);
      }
      try {
        // Through the shared SDK — same client/path (auth, dedupe, retry, timeout)
        // the native apps use.
        const data = await getApi().action<{ items: FeedItem[]; nextOffset: number | null }>("/api/home-feed", {
          method: "GET",
          query: { sort: s, offset, limit: PAGE, seed: seedRef.current },
        });
        const entry = cacheRef.current![s] ?? { items: [], nextOffset: null, seen: new Set<string>() };
        if (replace) {
          entry.seen = new Set(data.items.map((i) => i.id));
          entry.items = balanceByKind(data.items);
        } else {
          const fresh = data.items.filter((i) => !entry.seen.has(i.id));
          fresh.forEach((i) => entry.seen.add(i.id));
          // Balance only the new page, seeded with the last couple of already-
          // rendered items so the run-cap carries across the page boundary —
          // balancing the WHOLE accumulated list on every page load would
          // visibly reshuffle posts a viewer has already seen (see
          // buildSmartStream's `balance: false` below, which relies on pages
          // arriving pre-balanced instead of re-balancing the full stream).
          const context = entry.items.slice(-2);
          const balancedFresh = balanceByKind([...context, ...fresh]).slice(context.length);
          entry.items = [...entry.items, ...balancedFresh];
        }
        entry.nextOffset = data.nextOffset;
        cacheRef.current![s] = entry;
        if (isActiveTab()) {
          setItems(entry.items);
          setNextOffset(entry.nextOffset);
          if (replace) lastFeedFetchAt = Date.now();
        }
        persistContinuity();
      } catch {
        // A silent refresh must fail silently too: the viewer already has
        // perfectly good content on screen, and throwing them a full-width
        // error state because a BACKGROUND refetch blipped would be strictly
        // worse than showing them slightly older posts. The next return retries.
        if (isActiveTab() && !silent) setError(true);
      } finally {
        if (isActiveTab() && !silent) {
          setLoading(false);
          setSwitching(false);
        }
      }
    },
    [persistContinuity],
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
      // fetchPage persists on its own completion; a cache-hit switch doesn't
      // go through it, so persist here with the scroll position the new tab
      // is ABOUT to be restored to (`window.scrollY` hasn't updated yet).
      persistContinuity({ sort: s, scrollY: scrollPosRef.current[s] ?? 0 });
    } else {
      void fetchPage(s, 0, true);
    }
  };

  // Opens the full reels experience IN PLACE — instant, no route change or
  // loader — seeded on the first already-loaded video (its JS chunk + the
  // /reels route are both idle-preloaded on mount, see the effect above, so
  // this really is instant). Only if nothing is loaded yet do we fall back to
  // navigating to the /reels route. Shared by the "Reels" segmented tab AND
  // the "Continue in Reels" card at the bottom of an exhausted feed.
  const openReelsInPlace = useCallback(() => {
    const first = videosRef.current[0];
    if (first) setReel({ startId: first.id, commentsId: null });
    else router.push("/reels");
  }, [router]);

  // The third tab is "Reels" on every device — see openReelsInPlace above.
  const onSegment = (key: HomeFeedSort) => {
    if (key === "recent") {
      openReelsInPlace();
      return;
    }
    changeSegment(key);
  };

  // Lifts the For You/Following/Reels control into the shared top nav (owner
  // spec) — only re-set when `sort` itself changes (not on every feed
  // re-render), since that's the only thing the rendered tabs actually
  // reflect; `onSegment`/`preloadReelsFeed` are re-captured fresh each run,
  // which is fine — `changeSegment` reads the current `sort` via this same
  // closure, so it's never stale between sort changes. Cleared on unmount so
  // every other page's topbar search bar is untouched.
  useEffect(() => {
    setTopbarCenter(<FeedTopbarTabs sort={sort} onSegment={onSegment} onReelsPreload={preloadReelsFeed} />);
    return () => setTopbarCenter(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort]);

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
    // A new token here is what actually re-orders the feed (owner: "every
    // refresh should reshuffle the feed post arrangement like tiktok"). Only on
    // an EXPLICIT refresh — pull-to-refresh, or tapping the new-posts pill.
    // Deliberately NOT on the background auto-refresh (app-visible / reconnect
    // / re-nav, below): those fire while the viewer is mid-read, and reshuffling
    // under them would move the post they're looking at.
    seedRef.current = newFeedSeed();
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
      void supabase.removeChannel(channel);
    };
  }, []);

  /* ── Alive on return: auto-refresh on app-visible / reconnect / re-nav ─── */
  // Realtime lights the "new posts" pill while the tab is CONNECTED — this
  // covers the gap it can't see: posts made while the app was backgrounded
  // (installed-PWA switch-away) or the device was offline. Returning after
  // ≥2 min: at the top of the feed we refresh in place (feels instantly
  // alive); mid-scroll we never yank content — we quietly diff page 0 and
  // light the same pill instead.
  const lastHiddenAt = useRef<number | null>(null);
  useEffect(() => {
    const STALE_MS = 2 * 60_000;

    const checkQuietly = async () => {
      try {
        const data = await getApi().action<{ items: FeedItem[] }>("/api/home-feed", {
          method: "GET",
          query: { sort: sortRef.current, offset: 0, limit: PAGE },
        });
        const seen = cacheRef.current?.[sortRef.current]?.seen;
        const fresh = data.items.filter((i) => !seen?.has(i.id)).length;
        if (fresh > 0) setFreshCount((n) => Math.max(n, fresh));
      } catch {
        /* offline blip — the next return will retry */
      }
    };

    const revive = (idleFor: number) => {
      if (idleFor < STALE_MS) return;
      if (window.scrollY <= 8) {
        setFreshCount(0);
        // SILENT (owner: "homepage should never reload on every entry"). This
        // is not user-initiated — the viewer just navigated back to Home and
        // their content is already on screen from the Router Cache. Painting a
        // loading state over it was the entire "Home reloads every time"
        // symptom. Note this keeps the CURRENT seed, so nothing reshuffles
        // under them either: only genuinely new posts appear, and (since
        // rankForYou pins anything under 30min) they land at the top where
        // they're visible rather than silently mixed into the middle.
        void fetchPage(sortRef.current, 0, true, true);
      } else {
        void checkQuietly();
      }
    };

    // Covers returning to Home via cached CROSS-PAGE navigation (the very
    // long staleTimes.dynamic in next.config.ts is what makes that navigation
    // itself instant — this is the "stay fresh anyway" half of that trade).
    // visibilitychange below can't see this case: the tab was never actually
    // hidden, only the in-app route changed and came back. `lastFeedFetchAt`
    // is module-level, so it correctly reflects elapsed time regardless of
    // whether this exact component instance persisted the whole time or got a
    // fresh mount when the cached route was restored.
    if (lastFeedFetchAt === 0) lastFeedFetchAt = Date.now(); // true first mount — SSR data is already fresh
    else revive(Date.now() - lastFeedFetchAt);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        lastHiddenAt.current = Date.now();
      } else if (lastHiddenAt.current !== null) {
        revive(Date.now() - lastHiddenAt.current);
        lastHiddenAt.current = null;
      }
    };
    const onOnline = () => revive(Number.MAX_SAFE_INTEGER);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [fetchPage]);

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
    // Gestures that begin inside a horizontal scroller (album carousel, photo
    // rails) belong to that scroller — never read them as a tab swipe.
    const insideHScroll = !!(e.target as Element | null)?.closest?.("[data-hscroll]");
    swipeStart.current = t && !insideHScroll ? { x: t.clientX, y: t.clientY } : null;
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
      haptic("selection");
      await fetchPage(sort, 0, true);
      setRefreshing(false);
    }
    setPull(0);
  };

  const pullProgress = Math.min(1, pull / PULL_THRESHOLD);

  /* ── Build the smart stream from the loaded items ─────────────────────── */
  const stream = useMemo(
    () => buildSmartStream(items, { deck, sparkEvery: 6, balance: false }),
    [items, deck],
  );

  return (
    <section
      className="relative"
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
            className="pointer-events-none sticky top-[calc(4.5rem+env(safe-area-inset-top))] z-20 flex justify-center"
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

      {/* While you were away — suppressed in Quiet Mode (it's a catch-up/
          engagement nudge, exactly what Quiet Mode asks to reduce). */}
      <AnimatePresence>
        {away && !quietMode ? (
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
              <ZeroEmptyFeed sort={sort} deck={deck} />
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
            <div className="py-6">
              <ContinueInReels onOpen={openReelsInPlace} />
            </div>
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
      {imageReady && image && !viewerChunksReady ? <ImageOpenFallback item={image} startIndex={imageStartIndex} /> : null}
      {imageReady ? <ImageViewer item={image} startIndex={imageStartIndex} autoOpenComments={imageAutoComments} onClose={() => setImage(null)} /> : null}

      {/* Instant, in-place full reels experience (For You / Following tabs), nav
          visible, seeded on the tapped video — closes via state (no navigation). */}
      {reel && videos.length ? (
        <ReelsFeed
          initialItems={videos}
          initialOffset={nextOffset}
          startId={reel.startId}
          startSlideIndex={reel.startSlideIndex}
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
  deck,
}: {
  sort: HomeFeedSort;
  deck: ReturnType<typeof buildSparkDeck>;
}) {
  const heading =
    sort === "following" ? "Follow creators to fill this feed" : "Your feed is warming up";
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
