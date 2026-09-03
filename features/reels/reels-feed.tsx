"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Clapperboard } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { BrandLoader } from "@/features/app-shell/brand-loader";
import { useEntitlements } from "@/features/auth/use-entitlements";
import { ReelDeck } from "@/features/feed/reel-viewer";
import { ReelTabs } from "@/features/reels/viewer/reel-tabs";
import { getApi } from "@/lib/sdk/browser";
import type { FeedItem } from "@/lib/social/home-feed";
import {
  clearWatchedReels,
  freshDeck,
  markReelWatched,
  newReelsSeed,
  suppressedReels,
  watchedForRequest,
  watchedReels,
} from "@/lib/social/reels-session";
import { cn } from "@/lib/utils";

type Tab = "for_you" | "following";

// Module-level (not component state) so it survives a fresh mount when the
// Router Cache restores a cached in-app navigation back to /reels — the exact
// same idiom features/feed/smart-feed.tsx uses for its own "Alive on return"
// clock. Resets only on a real page reload/new tab.
let lastReelsFetchAt = 0;

/*
  ── The seed this module has already used, and why it lives out here ────────

  Owner (2026-08-11): "make reels always refresh each opens … it should
  reshuffle every open."

  The page mints a seed per REQUEST, but opening /reels from the tab bar is a
  client navigation: Next serves the cached RSC payload and the server component
  never runs, so `initialSeed` arrives as the same token it arrived with last
  time. That is indistinguishable from a fresh render by looking at props alone
  — the only way to tell is to remember what was rendered before, and the
  component itself cannot, because it is freshly mounted every open.

  Hence module scope, like `lastReelsFetchAt` above: it survives remounts and
  resets on a real reload, which is exactly the lifetime of "this browsing
  session's opens".
*/
let lastRenderedSeed: string | null = null;

/**
 * The For You deck's resume snapshot — persists across a close/reopen within
 * this browsing session (owner, 2026-08-16: "the random video display is
 * supposed to be on first entry not everytime the reels button is click…
 * the reels page use same memory caching and instant open as other pages,
 * like the history page"). A GENERIC reopen — the Reels tab tapped directly,
 * no `startId` — resumes from here instead of reshuffling; a deep link on a
 * specific video (a feed tap) still seeds fresh on that video regardless,
 * since that's an explicit new request, not "take me back to where I was."
 * Resets only on a real page reload, same lifetime as `lastRenderedSeed`.
 */
let resumeDeck: { items: FeedItem[]; offset: number | null; activeIndex: number; seen: Set<string> } | null = null;

/**
 * Full-screen /reels with a For You / Following toggle. "For You" is the
 * personalized deck (seeded from the server); "Following" refetches to reels only
 * from people you follow. Each tab keeps its own infinite scroll.
 */
export function ReelsFeed({
  initialItems,
  initialOffset,
  initialSeed,
  startId,
  startSlideIndex,
  commentsId,
  onClose,
}: {
  initialItems: FeedItem[];
  initialOffset: number | null;
  /** This open's reshuffle token, minted server-side per request. Reused for
   *  every page of the open so the whole scroll agrees on ONE arrangement; a
   *  new one is minted here when the Router Cache replayed a stale payload. */
  initialSeed?: string;
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
  const { handle: viewerHandle } = useEntitlements();
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
  /*
    🔴 A GENERIC REOPEN RESUMES; ONLY A DEEP LINK PINS (owner, 2026-08-16,
    two asks together: "when i click on a video on feed, it opens a random
    reels video, while it suppose to open that same video in reels" AND
    "the random video display is supposed to be on first entry not everytime
    the reels button is click… the reels page use same memory caching and
    instant open as other pages, like the history page").

    Three cases, decided once, synchronously, before the first paint (a pure
    function of props + the module-level `resumeDeck` snapshot — no
    localStorage read, so no SSR/hydration mismatch risk):

      1. `startId` set (a feed video was tapped) → pin it to index 0 of
         `initialItems`. Always wins, even over a resumable snapshot: this
         is an explicit "open THIS one" request.
      2. No `startId`, but a PRIOR open this session left a snapshot →
         resume it verbatim (same items, same scroll position) instead of
         starting over from `initialItems` — this is the "memory caching,
         instant open" half of the ask.
      3. No `startId`, no snapshot yet (the true first entry) → plain
         `initialItems`, server-ranked, untouched — this is "the random
         video display… on first entry."

    Why the pin has to happen HERE and not only in the effect below:
    `ReelDeck` (features/feed/reel-viewer.tsx) reads `startIndex` into a
    plain `useState` on its own first render and never resyncs it if the
    prop changes later. The effect below still reorders `items` post-mount
    (for the freshDeck watched/suppressed pass), and moving the tapped video
    to the front AFTER `ReelDeck` already locked onto its ORIGINAL numeric
    position meant that position, read again against the NOW-reordered
    array, pointed at a different (effectively random) item — the reported
    bug. Pinning here means the tapped video's position is 0 on the true
    first render, the effect's later pin-to-front is a no-op for its
    identity (only what comes AFTER it gets reshuffled/filtered), and the
    index `ReelDeck` locks onto is the right one from the start.
  */
  const resumingFromCache = !startId && !!resumeDeck;
  const [items, setItems] = useState<FeedItem[]>(() => {
    if (resumingFromCache) return resumeDeck!.items;
    if (!startId) return initialItems;
    const idx = initialItems.findIndex((i) => i.id === startId);
    if (idx <= 0) return initialItems; // already first, or not present — nothing to move
    const pinned = initialItems[idx]!;
    return [pinned, ...initialItems.slice(0, idx), ...initialItems.slice(idx + 1)];
  });
  const [offset, setOffset] = useState<number | null>(resumingFromCache ? resumeDeck!.offset : initialOffset);
  const [switching, setSwitching] = useState(false);
  /*
    This open's reshuffle token. A ref, not state: changing it must never
    re-render on its own — it only decides what the NEXT request asks for.
  */
  const seedRef = useRef<string>(initialSeed ?? newReelsSeed());
  // Slide direction for the tab transition (For You ↔ Following).
  const [direction, setDirection] = useState(1);
  const seen = useRef<Set<string>>(resumingFromCache ? new Set(resumeDeck!.seen) : new Set(initialItems.map((i) => i.id)));
  const loading = useRef(false);

  // Per-tab cache so switching is instant and never reloads/flashes a loader
  // once a tab has been visited — snapshotted the moment you swipe away, and
  // restored verbatim (items, pagination cursor, dedup set) on return.
  const cacheRef = useRef<Record<Tab, { items: FeedItem[]; offset: number | null; seen: Set<string> } | null> | null>(null);
  if (!cacheRef.current) {
    cacheRef.current = { for_you: { items, offset, seen: seen.current }, following: null };
  }
  // Remembers the last reel index viewed per tab, so returning to a tab lands
  // on the same reel instead of jumping back to the first one ("the top").
  const lastIndexRef = useRef<Record<Tab, number>>({ for_you: resumingFromCache ? resumeDeck!.activeIndex : 0, following: 0 });
  // True once For You has reported an active index at least once — after that,
  // a return visit resumes from `lastIndexRef` instead of re-seeking `startId`.
  const forYouSeeded = useRef(false);

  const fetchPage = useCallback(async (sort: Tab, off: number) => {
    try {
      // Reels has its OWN API (format='reel' posts only) — a separate product
      // from the feed, through the shared SDK like everything else.
      //
      // `seed` rides on EVERY page, not just the first: the feed is offset
      // paginated and the seed decides the order, so a page fetched under a
      // different seed slices a different arrangement and the deck starts
      // skipping and repeating clips mid-scroll.
      //
      // `exclude` only rides on page 0. Deeper pages are offsets INTO the
      // already-filtered list the server built for this open, so re-sending the
      // list would filter twice and shift every offset out from under us.
      const res = await getApi().action<{ items: FeedItem[]; nextOffset: number | null }>("/api/reels", {
        method: "GET",
        query: {
          sort,
          offset: off,
          limit: 24,
          seed: seedRef.current,
          ...(off === 0 ? { exclude: watchedForRequest().join(",") } : {}),
        },
      });
      if (off === 0) lastReelsFetchAt = Date.now();
      return res;
    } catch {
      return { items: [] as FeedItem[], nextOffset: null as number | null };
    }
  }, []);

  /*
    The one place a server page becomes deck material.

    Every fetch path used to repeat this filter inline and they had drifted: the
    suppression list ("not interested") was honoured at mount and nowhere else,
    so a clip you had just dismissed could arrive again on the very next page.
    Read fresh from storage per call rather than captured once, because
    suppression happens DURING the session — from the sheet, while this deck is
    on screen.
  */
  const acceptPage = useCallback((list: FeedItem[] | undefined) => {
    const blocked = new Set(suppressedReels());
    return (list ?? []).filter(
      (i) => i.mediaKind === "video" && !seen.current.has(i.id) && !blocked.has(i.id),
    );
  }, []);

  const loadMore = useCallback(async () => {
    if (loading.current || offset === null) return;
    loading.current = true;
    try {
      const d = await fetchPage(tab, offset);
      const fresh = acceptPage(d.items);
      for (const i of fresh) seen.current.add(i.id);
      if (fresh.length) setItems((prev) => [...prev, ...fresh]);
      setOffset(d.nextOffset);
    } finally {
      loading.current = false;
    }
  }, [offset, tab, fetchPage, acceptPage]);

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
      const fresh = acceptPage(d.items);
      for (const i of fresh) seen.current.add(i.id);
      setItems(fresh);
      setOffset(d.nextOffset);
      setSwitching(false);
    },
    [tab, switching, items, offset, fetchPage, acceptPage],
  );

  /*
    ═══════════════════════════════════════════════════════════════════════════
     REVERSED (owner, 2026-08-16) — A RESUMED OPEN IS SKIPPED ENTIRELY
    ═══════════════════════════════════════════════════════════════════════════

    This effect used to run unconditionally on every mount, per an EARLIER,
    now-superseded ask (2026-08-11): "make reels always refresh each opens…
    it should reshuffle every open." The owner has reversed that: "the random
    video display is supposed to be on first entry not everytime the reels
    button is click… the reels page use same memory caching and instant open
    as other pages, like the history page."

    `resumingFromCache` (computed above, alongside the `items`/`offset`/`seen`
    state it already seeded) means this exact open is a resume, not a fresh
    or replayed one — the state initializers already restored the snapshot
    verbatim, so there is nothing left for this effect to compute. Running it
    anyway would immediately reshuffle/re-filter what was just resumed,
    which is precisely the "everytime" behavior being undone. It still runs
    normally for a deep-linked video (a real new request) and for the true
    first-ever entry (no snapshot exists yet).

    Runs once, after hydration, and — when it does run — takes one of two
    paths depending on how this open actually reached us:

    ── FRESH SERVER RENDER (a reload, a cold entry, a deep link) ──────────────
    `initialSeed` is a token this module has never seen, so the server already
    ranked with a brand-new seed and the arrangement on screen IS this open's
    arrangement. Re-ordering it here would only replace a good shuffle with a
    different one, visibly, a frame after paint. So this path does the one thing
    the server could not: drop anything already watched or suppressed on THIS
    DEVICE, which the server cannot know about.

    ── ROUTER-CACHE REPLAY (the tab bar — by far the common case) ─────────────
    `initialSeed` is the token from a previous open, because Next replayed the
    cached RSC payload instead of re-running the page. Nothing about this deck is
    new. So: mint a seed, reshuffle locally for an instant result with no network
    wait, and separately ask the server for a page that excludes what has been
    watched. The local reshuffle is what the viewer sees immediately; the fetch
    quietly extends it with genuinely unseen clips underneath.

    ── Why the fetch APPENDS rather than replaces ─────────────────────────────
    A replace would swap the deck a beat after it painted, under a finger that
    may already be swiping. Appending means the reshuffle is instant and the
    fresh material is simply what comes next — and since the local pass has
    already moved unwatched clips to the front, "what comes next" arrives long
    before anyone reaches it.
  */
  useEffect(() => {
    // Resumed verbatim by the state initializers above — nothing to compute.
    // (Still updates `lastRenderedSeed` so the NEXT mount's replay detection,
    // if this session goes on to open a deep-linked video instead, stays
    // accurate rather than comparing against a stale token from before.)
    if (resumingFromCache) {
      lastRenderedSeed = initialSeed ?? null;
      return;
    }

    const replayed = initialSeed != null && initialSeed === lastRenderedSeed;
    lastRenderedSeed = initialSeed ?? null;

    if (replayed) seedRef.current = newReelsSeed();

    const watched = watchedReels();
    const suppressed = suppressedReels();

    // A deep link is an explicit request for ONE clip and outranks both the
    // shuffle and the watched ledger — "open this reel" must open that reel even
    // if it was watched a minute ago.
    const pinned = startId ? initialItems.find((i) => i.id === startId) ?? null : null;
    const pool = pinned ? initialItems.filter((i) => i.id !== pinned.id) : initialItems;

    const { items: ordered, exhausted } = freshDeck(pool, {
      seed: seedRef.current,
      watched,
      suppressed,
      // A fresh server render is already arranged by the ranker; re-sorting it
      // by a hash here would trade a real ranking for an arbitrary one.
      shuffle: replayed,
    });
    const next = pinned ? [pinned, ...ordered] : ordered;

    // Watched history that can no longer be honoured is history worth dropping —
    // otherwise every subsequent open pays to compute the same fallback.
    if (exhausted) clearWatchedReels();

    if (next.length !== initialItems.length || next.some((it, i) => it.id !== initialItems[i]?.id)) {
      seen.current = new Set(next.map((i) => i.id));
      setItems(next);
    }

    // Only the replay path needs new material; a fresh render just fetched some.
    if (!replayed) return;
    let cancelled = false;
    void (async () => {
      const d = await fetchPage("for_you", 0);
      if (cancelled) return;
      const fresh = acceptPage(d.items);
      if (!fresh.length) return;
      for (const i of fresh) seen.current.add(i.id);
      setItems((prev) => [...prev, ...fresh]);
      setOffset(d.nextOffset);
    })();
    return () => {
      cancelled = true;
    };
    // Once per mount. `initialItems`/`startId` are props of this open and do not
    // change within it; re-running on them would reshuffle mid-watch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Silently warm the Following tab in the background the moment the deck
  // mounts, so even the FIRST swipe/tap to it is instant instead of showing
  // the full-screen loader.
  useEffect(() => {
    if (cacheRef.current!.following) return;
    let cancelled = false;
    void (async () => {
      const d = await fetchPage("following", 0);
      if (cancelled) return;
      const blocked = new Set(suppressedReels());
      const freshSeen = new Set<string>();
      const fresh = (d.items ?? []).filter(
        (i) => i.mediaKind === "video" && !freshSeen.has(i.id) && !blocked.has(i.id),
      );
      fresh.forEach((i) => freshSeen.add(i.id));
      cacheRef.current!.following = { items: fresh, offset: d.nextOffset, seen: freshSeen };
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPage, acceptPage]);

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
      const fresh = acceptPage(d.items);
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
  }, [fetchPage, acceptPage]);

  return (
    <>
      {/* For You / Following toggle — minimal text, no pill/border, just a thin
          sliding underline to identify the active tab (small enough to always
          fit, even on the narrowest phones). Sits near the very top on every
          size — on lg it's re-centered over the actual video-viewing area:
          the app sidebar (16rem) on the left AND the persistent comments panel
          (400px) reserved on the right, so it never compresses against the
          top-right options (•••) button. */}
      {/*
        ── Feature 15: the tab bar is a shared component now ──────────────────
        It was bare white text on video — legible on some frames, invisible on
        others, and it is the one control that is always on screen. It now sits
        on glass with a travelling pill, and its layout survives a language where
        "Communities" is "Gemeinschaften".

        `available` is what keeps it honest: the full five-tab set is DECLARED in
        the component, and only the ids passed here are rendered. For You and
        Following are the two `/api/reels` actually serves; Friends, Communities
        and Nearby stay dark until they have a query behind them, because a tab
        that opens an empty deck reads as broken rather than unbuilt.
      */}
      <ReelTabs
        active={tab}
        onChange={(id) => switchTab(id as Tab)}
        available={["for_you", "following"]}
        className="lg:left-[calc(50%-4.5rem)]"
        feedHref="/feed"
      />

      {switching ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black" aria-hidden>
          <BrandLoader size={60} delayMs={0} overlay={false} />
        </div>
      ) : items.length === 0 ? (
        /*
          🔴 Following, signed OUT (owner, 2026-08-18: "the follow in guess is
          supposed to show you don't follow any creator, sign to follow
          creator page"). A guest's Following tab is empty for a different
          reason than a signed-in viewer's — there is no account to have
          followed anyone with — so it gets its own copy and a sign-in CTA
          instead of "Discover creators", which would only lead to the same
          dead end (following someone still needs an account).
        */
        tab === "following" && !viewerHandle ? (
          <div className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center">
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-3xl bg-secondary text-muted-foreground">
              <Clapperboard className="h-6 w-6" />
            </span>
            <p className="font-semibold">You don’t follow any creators</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">Sign in to follow creators and see their reels here.</p>
            <Link
              href={`/login?next=${encodeURIComponent("/reels")}`}
              className="mt-4 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white shadow-md brand-glow"
            >
              Sign in to follow creators
            </Link>
          </div>
        ) : (
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
        )
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
           all the way to the true top again.

           `pointer-events-none` here (re-enabled on ReelDeck's own root,
           which explicitly sets `pointer-events-auto`) is load-bearing: this
           wrapper shares the app sidebar's exact z-30, and being LATER in DOM
           order (it's rendered inside the page content, after the persistent
           shell's sidebar) it would otherwise win every same-z-index paint/
           hit-test tie across the ENTIRE viewport — including the sidebar's
           own 16rem column, which ReelDeck deliberately leaves empty
           (`lg:left-64`) specifically so the sidebar stays usable while a
           reel plays. Without this, that column was still invisibly "there"
           on this outer div and silently swallowed every sidebar click,
           which is exactly why nav buttons stopped responding until the
           reel's own X (unmounting this wrapper) was tapped. */
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={tab}
            custom={direction}
            initial={{ x: direction >= 0 ? "18%" : "-18%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: direction >= 0 ? "-18%" : "18%", opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
            className="pointer-events-none fixed inset-0 z-30"
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
                if (tab === "for_you") {
                  forYouSeeded.current = true;
                  // Keep the resume snapshot current so the NEXT open (a
                  // plain Reels-tab tap, no startId) picks up right here
                  // instead of the position this open itself started at.
                  resumeDeck = { items, offset, activeIndex: i, seen: seen.current };
                }
                /*
                  The ledger that makes "never show one video twice" true across
                  opens. Recorded on BECOMING ACTIVE rather than on completion:
                  the promise the owner made is about not being shown the same
                  clip again, and a clip you swiped past after half a second was
                  still shown to you — re-serving it next open is exactly the
                  repetition being complained about.
                */
                const shown = items[i];
                if (shown) markReelWatched(shown.id);
              }}
            />
          </motion.div>
        </AnimatePresence>
      )}
    </>
  );
}
