"use client";

import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue } from "framer-motion";
import {
  BadgeCheck,
  BellOff,
  Bookmark,
  Calendar,
  Check,
  ChevronDown,
  Compass,
  Download,
  EyeOff,
  Layers,
  Maximize2,
  Minimize2,
  OctagonAlert,
  PictureInPicture2,
  Flag,
  FolderPlus,
  Gauge,
  Heart,
  Info,
  Link2,
  Loader2,
  MessageCircle,
  MoreVertical,
  Music,
  Pause,
  Pencil,
  Play,
  Repeat2,
  Send as SendIcon,
  Share,
  User,
  UserPlus,
  Users,
  UserX,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { VerifiedTick } from "@/components/badges/identity-badges";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* ── Feature 15, Part 1 — the premium viewer layer ──────────────────────────
   The design language, the two adaptive systems and the reusable controls all
   live in `features/reels/viewer/`. Kept OUT of this file deliberately: this
   component was already 1,800 lines, and the brief asks for modular
   architecture and reusable components — putting a design system inside the
   consumer of that design system is how the next surface ends up with a
   copy of it. */
import { EDGE_ZONE_PX } from "@/features/app-shell/edge-swipe-back";
import { loadZoneAd } from "@/features/monetization/ad-cache";
import { ReelsAdSlide } from "@/features/monetization/reels-ad-slide";
import { useShowAds } from "@/features/monetization/use-show-ads";
import { insertAdSlots, REELS_AD_INTERVAL } from "@/lib/feed/ad-slots";
import { glass, layer, scrimForLuminance } from "@/features/reels/viewer/design";
import { GlassButton } from "@/features/reels/viewer/glass-button";
import { ReelProgress } from "@/features/reels/viewer/reel-progress";
import { LivingPlayback } from "@/features/reels/viewer/living-playback";
import { clampFeedRatio, isReelsShaped } from "@/lib/media/aspect";
import {
  applyRate,
  DEFAULT_RATE,
  formatRate,
  getPlaybackRate,
  nearestRate,
  nextRate,
  setPlaybackRate,
  type PlaybackRate,
} from "@/lib/media/engine/playback-rate";
import { currentPolicySync, recordClipCompleted } from "@/lib/media/engine/signals";
import { usePictureInPicture } from "@/features/reels/viewer/use-pip";
import { usePinchZoom } from "@/features/reels/viewer/use-pinch-zoom";
import type { PulseEvent } from "@/features/reels/viewer/social-pulse";
import { useAdaptiveRail, type RailLayout } from "@/features/reels/viewer/use-adaptive-rail";
import { useLivingInterface } from "@/features/reels/viewer/use-living-interface";

import { RichText } from "@/components/social/rich-text";
import { SmartVideo } from "@/features/media/smart-video";
import { useAdaptiveSource } from "@/features/media/use-adaptive-source";
import { GlassSheetShell } from "@/features/ui/glass-sheet-shell";
import { WowOutline, WowSolid } from "@/components/brand/wow-icon";
import { AnimatedCount } from "@/features/ui/animated-count";
import { floatReaction } from "@/features/ui/reaction-float";
/*
  🔴 The two sheets are DYNAMIC, and the reason is measured rather than stylistic.

  /home reaches this deck through its own `dynamic()` import, so the deck is
  already async — but a STATIC import of the sheet module got it hoisted into a
  chunk /home loads eagerly, taking `/(app)/home/page` from 337.2 kB to 341 kB
  and over `budget.test.ts`'s 340 kB ratchet. Nothing in the source looks wrong;
  only a build and a measurement show it.

  No `ssr: false` — `next/dynamic` with `ssr: false` has a standing history in
  this project of never resolving (see the ⌘K navigation-engine note in memory).
  Neither sheet renders anything until its `open` prop is true, so server-side
  rendering costs nothing and the default is the safe one.
*/
const ReelMoreSheet = dynamic(() => import("@/features/feed/reel-sheets").then((m) => m.ReelMoreSheet));

import { WhyThisChip } from "@/features/social/repost/why-this";
import { makeEmotionIcon, reactionGlyph, ReactionPicker, type ReactionEmotion } from "@/features/social/reaction-picker";
// Code-split, each gated behind its own "ready" flag (never mounted until
// the corresponding action is actually tapped) — reels are the main video
// feed, so static imports here put every one of these sheets' full weight
// into every route that renders it.
const ShareSheet = dynamic(() => import("@/features/social/share-sheet").then((m) => m.ShareSheet), { ssr: false });
const ShareQrSheet = dynamic(() => import("@/features/social/share-qr-sheet").then((m) => m.ShareQrSheet), { ssr: false });
const CollectionPicker = dynamic(() => import("@/features/social/collection-picker").then((m) => m.CollectionPicker), { ssr: false });
const ReportSheet = dynamic(() => import("@/features/social/report-sheet").then((m) => m.ReportSheet), { ssr: false });
const PostEditSheet = dynamic(() => import("@/features/social/post-edit-sheet").then((m) => m.PostEditSheet), { ssr: false });
// No `ssr: false` on the four below — same reasoning as ReelMoreSheet/
// ReelSendSheet above: none of them render anything until their own `open`
// prop is true, so SSR costs nothing, and `ssr: false` has a standing history
// of never resolving in this project (see the note above).
const Comments = dynamic(() => import("@/features/social/comments").then((m) => m.Comments));
const RepostComposer = dynamic(() => import("@/features/social/repost-composer").then((m) => m.RepostComposer));
const RepostSheet = dynamic(() => import("@/features/social/repost/repost-sheet").then((m) => m.RepostSheet));
const RepostersSheet = dynamic(() => import("@/features/social/reposters-sheet").then((m) => m.RepostersSheet));
import { useLongPress } from "@/lib/hooks/use-long-press";
import { PostPollInline } from "@/features/social/post-poll-inline";
import { RepostBurst } from "@/features/social/repost-burst";
import { claimPlayback, recordView, recordWatch, releasePlayback, suspendPlayback } from "@/lib/media/video-coordinator";
import { toast } from "@/features/ui/toast";
import { FrenzsaveError } from "@/lib/sdk";
import { muteInstant, unmuteWithFade } from "@/lib/media/audio-playback";
import { getQualityPreference, QUALITY_LABELS, setQualityPreference, type QualityPreference } from "@/lib/media/network-conditions";
import { getPlaybackPosition, savePlaybackPosition } from "@/lib/media/resume-positions";
import { suppressReel } from "@/lib/social/reels-session";
import { streamHlsUrl, streamThumbnailUrl } from "@/lib/media/stream";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { fireWowFeedback, WowBurst } from "@/features/ui/wow-burst";
import { springs } from "@/lib/motion/springs";
import { loadPostComments, prefetchPostComments } from "@/lib/social/comments-cache";
import { useEntitlements } from "@/features/auth/use-entitlements";
import { toggleFollow as toggleFollowShared, useFollowState } from "@/lib/social/follow-store";
import type { RepostAudience } from "@/lib/social/repost/audience";
import { toggleRepost, useRepostState } from "@/lib/social/repost-store";
import type { CommentNode } from "@/lib/social/engagement";
import type { FeedItem } from "@/lib/social/home-feed";
import type { CommentPreview } from "@/lib/social/reel-extras";
import { cn, formatCompactNumber, formatPostedOn } from "@/lib/utils";

interface CommentsData {
  comments: CommentNode[];
  canComment: boolean;
  loggedIn: boolean;
}

/**
 * ── 🔴 THE LETTERBOX HAS A BLURRED BACKDROP AGAIN (owner, 2026-08-17) ───────
 *
 * A full "premium edge-to-edge media viewer" spec makes "never crop any part
 * of the user's original media" priority #1 — see `features/reels/viewer/
 * fit.ts`'s header for the full history, including that this reverses an
 * explicit "long views should reach the safe area at all cost" instruction
 * for the standard 9:16 shape, confirmed with the owner before this rewrite.
 * `shouldFullBleed` is gone; nothing crops anymore, on any shape, on any
 * screen — the foreground is ALWAYS `object-contain`.
 *
 * The 2026-08-11 note directly below explains why a blurred backdrop was
 * removed once already — a SQUARE clip on a tall phone reportedly looked
 * "stretched". That blur sat behind a foreground that was ALSO sometimes
 * cropped by `cover` (route 2/3 in the old fit rule) — the two effects
 * compounding is what actually read as stretching, not the blur alone. This
 * time the foreground never crops, so the same failure mode shouldn't recur;
 * flagged here explicitly since it's the reason this exact pattern was tried
 * and reversed once before on this same product.
 *
 * ── 2026-08-11 note (superseded, kept for context) ──────────────────────────
 * "even square short videos in reels are also stretching, i said only long
 * videos." The FIT was already correct — `shouldFullBleed` refused a square
 * clip on every screen. What made it LOOK stretched was what filled the
 * bands around it: an overscanned, blurred copy of the same frame at 75%
 * opacity, so on a square clip on a 0.46 phone the bands were 54% of the
 * screen — mostly a giant zoomed copy of the video, and a foreground that
 * was ALSO being zoomed by `cover` on the shapes that qualified for it.
 */
const LETTERBOX = "bg-black";

/**
 * ── THE BOTTOM STACK ON /reels, in one place ────────────────────────────────
 *
 * Four things share the bottom of a reel and they were each carrying their own
 * hand-written `calc()`, which is how the progress bar ended up UNDER the app's
 * tab bar and hard against the sound row at the same time (owner, 2026-08-10:
 * "the progress bar is too close to the sound … push them upper so they can
 * give more space for the progress bar").
 *
 * 🔴 Corrected the other direction, THREE times now (owner, 2026-08-16 first:
 * "bring down this area… close to the bottom NAV just like tiktok"; then, same
 * day, again: "the details, caption, music and engagement tray should come
 * down more"; then 2026-08-17, a third time: "i want the text tray… to be
 * brought down more and more so the progress bar sits at the tip of the
 * bottom nav without giving more than 1 Y axis padding space between them").
 *
 * The scrubber's OWN floor (4.75rem) is NOT reduced further this pass, even
 * though the owner's wording points at it directly — see mobile-nav.tsx's own
 * comment on this exact pair of constants: the nav's gradient is
 * `from-black/95 via-black/90 to-black/75`, so even its lightest point (right
 * at 4.75rem, the bar's own top edge) is still 75%-opacity black. Moving the
 * scrubber BELOW that line doesn't bring it "closer to the nav" — it moves it
 * BEHIND the nav's own near-solid background (z-40 over this deck's z-30),
 * which would make it hard to see or tap rather than closer to anything. What
 * moved instead: the CONTENT tray's own gap ABOVE the scrubber, which was
 * genuinely loose (1.75rem) and had real room to close — down to 0.5rem, the
 * "1 Y axis padding space" the owner asked for, just measured against the
 * scrubber (the one part of this stack that's actually free to move) rather
 * than the nav itself.
 *
 * Measured from the true bottom edge, on mobile:
 *
 *   0            the nav's own floor (it owns `env(safe-area-inset-bottom)`)
 *   4.75rem      the top of the mobile tab bar — content cannot sit BELOW
 *                          this without the opaque bar (it paints at a
 *                          higher z-index, see below) visually clipping it.
 *   +2rem        the tab bar's feathered scrim above itself (mobile-nav.tsx)
 *   PROGRESS     4.75rem — the scrubber, flush against the bar's own top
 *                          edge — the closest it can sit without the bar
 *                          itself starting to cover it.
 *   CONTENT      5.25rem — caption, sound row and action rail, now just
 *                          0.5rem above the scrubber (was 1.75rem).
 *
 * Every one of them adds `env(safe-area-inset-bottom)` so nothing lands in the
 * home-indicator strip. The modal variant (no tab bar under it) keeps its own
 * tighter floor — these are the `page` values only.
 *
 * 🔴 These are paired with the nav scrim's height in `features/app-shell/
 * mobile-nav.tsx`: that scrim is painted at z-40 and this deck is z-30, so it
 * paints OVER anything here that shares its band. Move one, check the other.
 */
const REEL_PROGRESS_BOTTOM = "!bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:!bottom-4";
const REEL_CONTENT_BOTTOM = "bottom-[calc(5.25rem+env(safe-area-inset-bottom))] lg:bottom-6";
const REEL_CONTENT_PAD = "pb-[calc(5.25rem+env(safe-area-inset-bottom))] lg:pb-8";

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/*
  ── Social Pulse™ is code-split, and the budget test is why ─────────────────

  `lib/perf/budget.test.ts` failed this at 341 kB against a 340 kB global
  ceiling on /p/[id], which pulls the whole viewer in. Raising the ceiling was
  the wrong answer — the guard exists precisely to stop that reflex.

  The right one is that this component CANNOT RENDER ANYTHING TODAY. It draws
  friend-activity cards, the feed exposes no friend activity yet, so its event
  list is always empty. Shipping its code to every visitor of every post page to
  render nothing is pure cost.

  `ssr: false` because it is purely decorative chrome over a video and has no
  server markup worth streaming; it is mounted only once `pulseEvents` is
  non-empty, so the chunk is fetched the first time there is genuinely something
  to say. The moment the data source lands, this starts paying for itself
  without any further change here.
*/
const SocialPulse = dynamic(
  () => import("@/features/reels/viewer/social-pulse").then((m) => m.SocialPulse),
  { ssr: false },
);

/*
  The four levels the Part 2 brief asks for: "Auto / Data Saver / Balanced /
  Best Quality". Balanced is the one that was missing — a 720p ceiling for
  someone who wants HD without a 4K decode and a 4K data bill on a phone.

  QUALITY_LABELS now lives in network-conditions.ts, shared with the Account
  Settings selector (2026-08-26) — see that module for why. The cycle order
  walks from cheapest to most expensive so repeated taps read as one axis
  rather than a shuffle.
*/
const QUALITY_CYCLE: QualityPreference[] = ["auto", "data-saver", "balanced", "high"];

/*
  The four rungs the overflow sheet offers as one-tap segments.

  The full ladder is six (`PLAYBACK_RATES`), and it stays six — the row's label
  still cycles all of them. But six segments do not fit beside a label on a
  360px phone without shrinking to a tap target nobody can hit, and 0.75× and
  1.25× are the two nobody reaches for: the reason to change speed is "this is
  slow" or "I want to hear this properly", and those are 1.5×/2× and 0.5×.
*/
const QUICK_RATES = [0.5, 1, 1.5, 2] as const;

/**
 * The badge on the smart comment preview.
 *
 * One label per `reason`, and the mapping is exhaustive by type — so a new
 * selection rule in `reel-extras.ts` cannot ship without a word for it here,
 * which is how a badge ends up claiming the wrong thing.
 */
const COMMENT_REASON_LABEL: Record<CommentPreview["reason"], string> = {
  friend: "Friend",
  creator: "Creator",
  verified: "Verified",
  top: "Top",
  newest: "New",
};

/**
 * Fullscreen reel deck. Reels stack in a native, snap-scrolling column — so
 * flicking up/down is buttery on every device (the browser owns the scroll).
 * Only the reel in view plays; its immediate neighbours are kept mounted and
 * pre-buffered (`preload="auto"`) so the next clip starts the instant it snaps
 * into place — no black frame, no spinner, unless the network is genuinely slow.
 * A tap toggles the controls (they auto-hide after 2s), double-tap left/right
 * seeks ±10s, and a deliberate ~0.5s press pauses.
 */
export function ReelViewer({
  items,
  startIndex = 0,
  startSlideIndex,
  onClose,
}: {
  items: FeedItem[] | null;
  startIndex?: number;
  /** Which video of the seeded reel's own album to open on (not always slide 0). */
  startSlideIndex?: number;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {items && items.length ? (
        <ReelDeck key="reeldeck" items={items} startIndex={startIndex} startSlideIndex={startSlideIndex} onClose={onClose} />
      ) : null}
    </AnimatePresence>
  );
}

export function ReelDeck({
  items,
  startIndex,
  startSlideIndex,
  onClose,
  onEndReached,
  variant = "modal",
  autoOpenCommentsId,
  onSwipeTab,
  onActiveIndexChange,
}: {
  items: FeedItem[];
  startIndex: number;
  /** Which video of the SEEDED reel's own album to open on (a feed/post
   *  carousel tap on slide N of an album should land there, not slide 0). */
  startSlideIndex?: number;
  onClose: () => void;
  /** Called as the viewer nears the end — powers infinite loading on the page. */
  onEndReached?: () => void;
  /** "modal" (over the app) or "page" (a route; sits below the mobile nav). */
  variant?: "modal" | "page";
  /** Deep-link support: open this reel's comments sheet the moment it mounts. */
  autoOpenCommentsId?: string | null;
  /** A decisive horizontal swipe on any reel — switches For You/Following. */
  onSwipeTab?: (dir: "left" | "right") => void;
  /** Reports the active index as it changes — lets a parent remember scroll
   *  position per tab so returning to it resumes exactly where you left off. */
  onActiveIndexChange?: (index: number) => void;
}) {
  // "modal" opens ON TOP of the still-mounted feed (only covered, never
  // unmounted — see smart-feed.tsx); this immediately pauses whatever was
  // playing underneath and keeps it from resuming while the deck is open.
  // Harmless on the standalone "page" variant, where there's nothing
  // underneath to protect. Doesn't affect this deck's OWN active-reel
  // playback below, which never checks the suspend flag.
  //
  // A LAYOUT effect: layout effects for the whole tree complete before any
  // passive effect runs, so this always pauses the outgoing feed video before
  // a ReelCard child's own (passive) autoplay effect can claim playback for
  // the newly-active reel — a plain useEffect raced the two, since child
  // effects fire before a parent's, and could pause this deck's own
  // just-started video moments after it started.
  useLayoutEffect(() => suspendPlayback(), []);
  const scroller = useRef<HTMLDivElement | null>(null);
  const raf = useRef<number | null>(null);

  /*
    ── The ad slide, and the index model it forced ────────────────────────────
    (owner, 2026-08-30: an ExoClick slide after every 3 reels, as its own card)

    🔴 `active` is a SLIDE index from here on, not an item index. It always was
    both — scrollTop/clientHeight gives the position of a `<section>`, and every
    `<section>` was a reel — and inserting ad slides is exactly what separates
    the two. Everything that needs an ITEM index now goes through
    `itemIndexBySlide`, and everything the parent is told stays in ITEM terms so
    `markReelWatched`, the resume snapshot and `startIndex` are all unchanged.

    Getting this wrong has a known signature on this component: an `active` that
    can point at something not rendered is what produced "the reels get stuck
    after scrolling on 3 videos or 4" (see the clamp note in `onScroll`).
  */
  const { showAds, ready: adsReady } = useShowAds();
  /**
   * Whether the reels zone has a row at all. Null until answered.
   *
   * Probed ONCE at deck level rather than per slide, and composed against
   * before any ad slide exists — because a slide is a whole screen the viewer
   * must swipe past. An unseeded zone must therefore insert NO slide, not an
   * empty one, which is the difference between a deck that is unchanged for an
   * unconfigured site and one that shows a black screen every fourth reel.
   */
  const [adSeeded, setAdSeeded] = useState(false);
  useEffect(() => {
    if (!adsReady || !showAds) return;
    let alive = true;
    void loadZoneAd("reels_interstitial")
      .then((ad) => {
        if (alive) setAdSeeded(!!ad);
      })
      .catch(() => {
        /* No ad is the safe direction — leave the deck as pure content. */
      });
    return () => {
      alive = false;
    };
  }, [adsReady, showAds]);

  /**
   * The composed slide list, plus the two index maps that keep slide-space and
   * item-space translatable in O(1).
   *
   * Built from the FULL item list rather than the buffer-gated slice, so the
   * composition never changes under the viewer as the render window extends —
   * `insertAdSlots` suppresses a trailing slot, and against a growing prefix
   * that would mean the slide at a given index changing identity mid-scroll.
   */
  const { slides, itemIndexBySlide, slideIndexByItem } = useMemo(() => {
    const composed = insertAdSlots(items, {
      idOf: (item) => item.id,
      interval: REELS_AD_INTERVAL,
      enabled: adSeeded,
    });
    const bySlide: number[] = [];
    const byItem: number[] = [];
    let itemIndex = -1;
    composed.forEach((entry, slideIndex) => {
      if (entry.type === "post") {
        itemIndex += 1;
        byItem[itemIndex] = slideIndex;
      }
      // An ad slide reports the reel it follows: it is the last real content
      // the viewer saw, so "where am I" stays truthful and re-marking that
      // reel as watched is a no-op rather than a wrong answer.
      bySlide[slideIndex] = Math.max(0, itemIndex);
    });
    return { slides: composed, itemIndexBySlide: bySlide, slideIndexByItem: byItem };
  }, [items, adSeeded]);

  const start = slideIndexByItem[Math.min(Math.max(0, startIndex), items.length - 1)] ?? 0;
  const [active, setActive] = useState(start);
  /**
   * Which REEL the viewer is on, tracked independently of the slide index.
   *
   * 🔴 This exists for the re-anchor below, and it must be written from
   * `onScroll` rather than derived from `active` — at the moment the ad probe
   * resolves, `active` is a slide index in the OLD composition while the maps
   * have already been rebuilt for the new one, so deriving it on that render
   * reads the wrong reel. `onScroll` always used the maps that were current
   * when the viewer actually moved, so this is the one value that survives the
   * transition intact.
   */
  const activeItemRef = useRef(Math.min(Math.max(0, startIndex), Math.max(0, items.length - 1)));
  // While a comments sheet is open the deck must NOT snap-scroll to the next
  // reel — the sheet stays put and the reel behind it is frozen.
  const [locked, setLocked] = useState(false);
  /* Feature 15 — Adaptive Action Rail™. One reader for the whole deck; see the
     note where it is passed to ReelCard. */
  const rail = useAdaptiveRail();
  /*
    ── Pulse Buffer™: the preload window is a BUDGET, not a constant ──────────
    (Feature 15 Part 2 — docs/FEATURE_15_PART_2_PLAYBACK_ENGINE.md §3)

    This was `active - 1 … active + 3` mounted and `active … active + 2` fully
    buffered, hardcoded, for every viewer on every device. That is three clips of
    real segment bytes fetched speculatively on a 2G phone at 6% battery, which
    is the case where prefetching is most expensive and least likely to pay off.

    The governor answers it instead, from the connection, the battery, the device
    class, live decoder health and how much of the deck this viewer has actually
    watched. Re-read per render — `decidePolicy` is a pure function over a
    handful of numbers, so this costs nothing, and it means a battery reading or
    a stall that lands mid-session changes the budget for the NEXT clip rather
    than at the next page load.

    🔴 `preloadBehind` is never 0 in any policy, and there is a test for it: an
    unmounted previous clip means scrolling back shows a black frame while it
    re-fetches, and the few KB of metadata it costs is never the reason a device
    is struggling.
  */
  const [qualityPref, setQualityPrefForBudget] = useState<QualityPreference>("auto");
  useEffect(() => {
    setQualityPrefForBudget(getQualityPreference());
  }, []);
  const budget = currentPolicySync(qualityPref);

  // Reported in ITEM terms — the parent uses it for `markReelWatched`, the
  // resume snapshot and `startIndex`, all of which index `items`.
  const activeItemIndex = itemIndexBySlide[active] ?? 0;
  useEffect(() => {
    onActiveIndexChange?.(activeItemIndex);
  }, [activeItemIndex, onActiveIndexChange]);

  // Buffer-gated scrolling: reels are marked "ready" when their first frames are
  // buffered (or after a short fallback). We only render up to `ceiling` — the
  // next clip always, and the 2nd-next once the next is ready — so a fast fling
  // can never land on a cold, unbuffered video. There's simply nothing rendered
  // past the buffer to scroll into; the ceiling extends as clips become ready.
  const [readyIds, setReadyIds] = useState<Set<string>>(() => new Set());
  const markReady = useCallback((id: string) => {
    setReadyIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);
  // Render (and pre-buffer) the next TWO clips at all times, extending to the
  // third once the next is ready — so scrolling forward always lands on a warm,
  // already-loaded video instead of a spinner.
  //
  // Now measured in SLIDES. An ad slide counts as one, which is correct: it is a
  // full screen the viewer has to pass, so it consumes render window exactly
  // like a reel. It needs no buffering of its own, so a next-slide that is an ad
  // simply never extends the ceiling to three.
  const next1 = slides[active + 1];
  const next1Id = next1?.type === "post" ? next1.data.id : null;
  const ceiling = Math.min(slides.length - 1, active + (next1Id && readyIds.has(next1Id) ? 3 : 2));
  const visible = slides.slice(0, ceiling + 1);
  // Read by `onScroll` below, which can't put `ceiling` in its own deps
  // without being torn down/rebuilt on every index change — a ref lets the
  // stable callback always see the latest value instead.
  const ceilingRef = useRef(ceiling);
  useEffect(() => {
    ceilingRef.current = ceiling;
  }, [ceiling]);
  /*
    The same stable-callback trick as `ceilingRef`, for the three other values
    `onScroll` needs. Putting `slides` / `itemIndexBySlide` / `items.length` in
    its dependency array would tear down and rebuild the scroll handler every
    time a page of reels loads — on the one listener that runs on every frame of
    every swipe.
  */
  const slidesRef = useRef(slides);
  const itemIndexRef = useRef(itemIndexBySlide);
  const itemCountRef = useRef(items.length);
  useEffect(() => {
    slidesRef.current = slides;
    itemIndexRef.current = itemIndexBySlide;
    itemCountRef.current = items.length;
  }, [slides, itemIndexBySlide, items.length]);

  // Lock the page, jump to the opening reel, wire Escape. overflowY only — the
  // `overflow` shorthand also resets overflow-x, undoing the `overflow-x: clip`
  // on <body> that keeps the app sidebar sticky (it would otherwise scroll away
  // and leave empty space where it should stay visible).
  useEffect(() => {
    const prevOverflow = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    const el = scroller.current;
    if (el) el.scrollTop = start * el.clientHeight; // instant, no smooth-scroll flash
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflowY = prevOverflow;
      window.removeEventListener("keydown", onKey);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
    🔴 RE-ANCHOR when the ad probe resolves, or the viewer silently jumps reels.

    The deck mounts and sets `scrollTop = start * clientHeight` immediately, with
    `adSeeded` still false — so at that instant one slide equals one reel. The
    zone probe is a network round trip, so it lands a few hundred ms LATER, and
    the moment it does, ad slides appear at positions 3, 7, 11… Every reel after
    the first ad shifts down by one, while `scrollTop` and `active` still point
    at the old arrangement.

    Concretely: a feed tap deep-linking to reel 5 lands correctly, and then a
    beat later the viewer is looking at reel 4 with no idea why. That is the
    exact index-desync class that produced "the reels get stuck after scrolling
    on 3 videos or 4" — the same failure wearing different clothes.

    So on the one transition that reshuffles the composition, the scroller is
    re-pointed at the SLIDE that now holds the reel the viewer was on. Keyed on
    `adSeeded` alone, not on `slides`: pagination only ever APPENDS (a suppressed
    trailing slot becoming a real one is still beyond the render window), so the
    positions of everything already on screen are stable and re-anchoring on
    every page load would be a scroll jump for no reason.
  */
  const anchoredFor = useRef(adSeeded);
  useEffect(() => {
    if (anchoredFor.current === adSeeded) return;
    anchoredFor.current = adSeeded;
    const el = scroller.current;
    if (!el || !el.clientHeight) return;
    const target = slideIndexByItem[activeItemRef.current] ?? 0;
    // `scrollTop` is what the snap container actually reads, and setting it is
    // what keeps the CSS snap position and `active` in agreement — updating
    // state alone would leave the viewer scrolled to the wrong offset.
    el.scrollTop = target * el.clientHeight;
    setActive(target);
  }, [adSeeded, slideIndexByItem]);

  const onScroll = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      const el = scroller.current;
      if (!el || !el.clientHeight) return;
      /*
        🔴 CLAMP TO WHAT'S ACTUALLY RENDERED, not the full fetched list
        (owner, 2026-08-16: "the reels get stuck after scrolling on 3 videos
        or 4").

        Only `ceiling + 1` clips ever exist as `<section>`s at once (the
        buffer-gate above — "3 or 4" is that literal window). `scrollTop` is
        read off a live `scroll-snap-type: y` element with `overscroll-
        contain`, which stops scroll CHAINING to the page behind it but does
        not disable WebKit's own elastic/rubber-band overscroll on the
        element itself — a fling that hits the last rendered section's
        boundary can report a transient `scrollTop` past it. The only bound
        this used to apply was `i < items.length`, the whole unpaginated
        deck (often 24+), so a bounce there could set `active` to an index
        with no `<section>`/`<video>` ever mounted for it: the visibly
        on-screen clip gets paused (its `isActive` just flipped false) and
        nothing takes its place until the buffer-gate above eventually
        catches up — exactly the "stuck" symptom, and exactly at the edge of
        the render window every few clips.

        Clamping `i` to `ceilingRef.current` means `active` can never point
        past what is actually in the DOM, so this desync can't happen.
      */
      // Slide-space throughout: `ceilingRef` is a slide ceiling and `scrollTop`
      // measures rendered `<section>`s, so both sides of this clamp agree.
      const maxIndex = Math.min(slidesRef.current.length - 1, ceilingRef.current);
      const i = Math.min(Math.max(0, Math.round(el.scrollTop / el.clientHeight)), maxIndex);
      setActive((prev) => (i !== prev ? i : prev));
      /*
        Pagination is counted in REELS, never in slides. Counting slides would
        make every ad shown pull the "load more" trigger one position earlier
        and, over a long session, fetch pages the viewer had not reached — the
        same class of drift `countPosts` exists to prevent in the feed.
      */
      const reelsSoFar = itemIndexRef.current[i] ?? 0;
      activeItemRef.current = reelsSoFar;
      if (reelsSoFar >= itemCountRef.current - 3) onEndReached?.();
    });
  }, [onEndReached]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      /* Full-bleed media surface: the touch target is this deck, not the frame
         inside it, so iOS resolves its long-press callout from here. One
         inherited property covers the whole subtree — see the media-protection
         block in app/globals.css. Suppresses the callout only; every gesture
         this deck owns (swipe, hold-to-pause, double-tap) is untouched. */
      data-media-protected
      className={cn(
        // pointer-events-auto: reels-feed.tsx's tab-slide wrapper (variant
        // "page") is `pointer-events-none` so its full-viewport box never
        // swallows clicks over the sidebar column this deck deliberately
        // leaves empty (see `lg:left-64` below) — this explicit override is
        // what makes the deck itself clickable again inside that wrapper.
        "pointer-events-auto fixed inset-0 overflow-hidden overscroll-none bg-black",
        // On large screens reels sit BESIDE the app sidebar (which stays visible
        // + scrollable, same as every other page) instead of covering it —
        // whether opened as the /reels page or in-place from the feed.
        "lg:left-64",
        variant === "page" ? "z-30" : "z-[85]",
      )}
      style={{ touchAction: "pan-y" }}
      role="dialog"
      aria-modal="true"
      aria-label="Reels"
    >
      <div
        ref={scroller}
        onScroll={onScroll}
        className={cn(
          "h-full w-full overflow-x-hidden overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          locked ? "overflow-y-hidden" : "snap-y snap-mandatory overflow-y-scroll",
        )}
        // pan-y locks touch gestures to vertical scrolling only, so the deck can
        // never slide/swipe left-right (and horizontal swipes won't trigger
        // browser back/forward navigation).
        style={locked ? { touchAction: "none" } : { scrollSnapType: "y mandatory", touchAction: "pan-y", overscrollBehaviorX: "none" }}
      >
        {visible.map((entry, i) =>
          entry.type === "ad" ? (
            /*
              An ad slide. Same box as a reel — full viewport height, same snap
              behaviour — so the deck's scroll maths is unchanged and it is
              swiped past exactly like a reel.

              Keyed on `anchorId` (the id of the reel it follows), NOT on its
              ordinal: hiding or muting a reel above would renumber every slot
              below it, React would remount each one, and every ad on screen
              would reload. See the note on `anchorId` in lib/feed/ad-slots.ts.

              Deliberately NOT wrapped in the `lg:pr-[400px]` / 75vh column the
              reels use — that column exists to leave room for the action rail,
              and an ad has no rail.
            */
            <section
              key={`ad-${entry.anchorId}`}
              className="relative flex h-[100dvh] w-full snap-start snap-always justify-center bg-black"
            >
              <ReelsAdSlide variant={variant} />
            </section>
          ) : (
          <section key={entry.data.id} className="relative flex h-[100dvh] w-full snap-start snap-always justify-center bg-black lg:pr-[400px]">
            {/* On phones the reel fills the screen; on tablets/desktop it becomes a
                centered column (black to the sides) capped at 75% of the viewport
                height wide — true 9:16 clips are still bound by the full-height
                video itself (object-contain, unaffected by this ceiling), but
                anything less tall (4:5, 1:1) now renders noticeably bigger instead
                of being squeezed into an exact-9:16 box. On lg the column lets its
                overflow show so the action rail can sit OUTSIDE the video, in the
                right gutter (YouTube-Shorts-style). */}
            <div className="relative h-full w-full overflow-hidden bg-black lg:w-[min(100%,75vh)] lg:overflow-visible">
              <ReelCard
                item={entry.data}
                /*
                  Feature 15: ONE rail layout for the whole deck.

                  Measured once at the deck level and passed down, not a hook per
                  card. A per-card `useAdaptiveRail()` would mean N resize
                  listeners and N state updates for N mounted reels on every
                  rotation — the same per-subscriber pattern that had to be
                  coalesced out of the download manager (2026-08-10). The value
                  is a property of the DEVICE, so one reader is correct.
                */
                rail={rail}
                isActive={i === active}
                isNext={i === active + 1}
                // Pulse Buffer™ — the mounted window and the fully-buffered
                // window both come from the governor's budget (see the note on
                // `budget` above). `metadata` on the rest is what makes the NEXT
                // clip start instantly without paying for segments a fast scroll
                // would discard.
                nearby={i >= active - budget.preloadBehind && i <= active + budget.preloadAhead}
                preload={i >= active && i <= active + budget.fullyBufferAhead ? "auto" : "metadata"}
                onClose={onClose}
                onCommentsOpen={setLocked}
                autoOpenComments={entry.data.id === autoOpenCommentsId}
                variant={variant}
                onSwipeTab={onSwipeTab}
                onReady={markReady}
                initialSlide={i === start ? startSlideIndex : undefined}
              />
            </div>
          </section>
          ),
        )}
      </div>
    </motion.div>
  );
}

function ReelCard({
  item,
  rail,
  isActive,
  isNext,
  nearby,
  onClose,
  onCommentsOpen,
  autoOpenComments,
  variant = "modal",
  onReady,
  preload = "auto",
  onSwipeTab,
  initialSlide,
}: {
  item: FeedItem;
  /** Adaptive Action Rail™ geometry, measured once by the deck. */
  rail: RailLayout;
  isActive: boolean;
  isNext: boolean;
  nearby: boolean;
  onClose: () => void;
  onCommentsOpen: (open: boolean) => void;
  autoOpenComments?: boolean;
  variant?: "modal" | "page";
  /** Report this reel as buffered/ready so the deck can extend the scroll ceiling. */
  onReady?: (id: string) => void;
  /** How aggressively to buffer this clip — "auto" for the ones you'll reach next,
   *  "metadata" for the further neighbours (saves mobile battery/data). */
  preload?: "auto" | "metadata";
  /** Which video of THIS reel's album to open on — the exact slide the user
   *  tapped in a feed/post carousel, not always the first. Only meaningful
   *  when this reel is an album (ignored otherwise). */
  initialSlide?: number;
  /** A decisive horizontal swipe — switches For You/Following (page variant only). */
  onSwipeTab?: (dir: "left" | "right") => void;
}) {
  // Anchor the caption + action rail low. On the /reels route (page) they clear
  // the mobile bottom nav AND the scrubber above it — see REEL_CONTENT_BOTTOM for
  // the whole stack — and drop to the very bottom on large screens; in the modal
  // (no nav) they hug the bottom on every size, no empty gap.
  const railBottom = variant === "page" ? REEL_CONTENT_BOTTOM : "bottom-6";
  const captionPad = variant === "page" ? REEL_CONTENT_PAD : "pb-6 lg:pb-8";
  const video = useRef<HTMLVideoElement | null>(null);
  /*
    ── Feature 15: Living Interface™ + Smart UI ─────────────────────────────
    The sampler needs the ELEMENT, and `video` is a ref — assigning a ref never
    re-renders, so a hook depending on `video.current` would read null forever.
    Mirroring it into state when this card becomes mounted/active is what gives
    the hook something to depend on. Cheap: it settles once per card.
  */
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  useEffect(() => {
    setVideoEl(video.current);
  }, [nearby, isActive]);
  const palette = useLivingInterface(videoEl, isActive);
  /*
    Smart UI: ONE measured number drives the scrim, so "bright video → darker
    overlay" and "dark video → more contrast" can never disagree with each other.
    See `scrimForLuminance` for why the bright end is deliberately generous.
  */
  const scrim = scrimForLuminance(palette.luminance);
  /*
    ── Social Pulse™ events, from REAL data only ────────────────────────────
    🔴 Derived strictly from fields the feed item already carries. Nothing here
    invents a name, a count or a "trending" claim — fabricated social proof has
    been declined three times on this project and the Reality Ledger fails the
    build on invented scale claims.

    Today the feed item exposes no friend-activity, so this is an empty list and
    the Pulse renders nothing at all. That is the honest state, and it is the
    correct one: the component is wired, the data source is the piece that does
    not exist yet. When the feed starts returning "which of your friends
    engaged", it is populated here and only here.
  */
  const pulseEvents = useMemo<PulseEvent[]>(() => {
    /*
      🔴 REAL EVENTS AT LAST (Feature 15 Part 3, 2026-08-11).

      Part 1 shipped this as a hardcoded empty array with the note "the
      component is wired, the data source is the piece that does not exist yet".
      `friendActivity` IS that data source: rows from `post_reactions`,
      `reposts` and `post_comments`, filtered to people this viewer actually
      follows, resolved to real handles. See lib/social/pulse-activity.ts.

      Nothing is synthesised here. No event is emitted for a post with no friend
      activity — which is most posts, and is the correct empty state. The
      `trending` PulseKind stays unused: there is no measured trend signal
      behind it, and emitting one would be the invented social proof this
      project has declined three times.

      Keyed by handle + kind so React never reuses a card across two different
      people, which would cross-fade one name into another mid-animation.
    */
    const acts = item.friendActivity?.actors ?? [];
    return acts.map((a) => ({
      id: `${a.handle}:${a.kind}`,
      kind: a.kind,
      actor: a.displayName,
    }));
  }, [item.friendActivity]);

  /*
    ── Publishing the Living Interface™ accent ──────────────────────────────
    Written to the document root rather than to a wrapper on this card, for a
    structural reason: `ReelCard` renders a FRAGMENT of absolutely-positioned
    siblings into the deck's own positioned box. Adding a wrapper to carry the
    variable would introduce a new containing block between them and that box —
    the precise mistake that once broke every `position: fixed` control inside
    the deck (recorded in the reels-immersion notes, where a `motion.div`
    wrapper silently re-anchored the whole chrome).

    Only the ACTIVE card writes, and exactly one card is active, so there is no
    contention. Cleared on the way out so a closed viewer never leaves the rest
    of the app tinted by the last reel someone watched.
  */
  useEffect(() => {
    if (!isActive) return;
    const root = document.documentElement;
    if (palette.accent) root.style.setProperty("--reel-accent", palette.accent);
    else root.style.removeProperty("--reel-accent");
    return () => {
      root.style.removeProperty("--reel-accent");
    };
  }, [isActive, palette.accent]);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ t: number; x: number }>({ t: 0, x: 0 });
  const holding = useRef(false);
  const moved = useRef(false);
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const axisLock = useRef<"h" | "v" | null>(null);
  /**
   * True when this gesture STARTED inside the same left-edge strip
   * `EdgeSwipeBack` claims for its own back-navigation swipe (owner,
   * 2026-08-26: reported as a "backswipe goes back twice" incident, and
   * this was a real, independently found contributor on the Reels page — a
   * rightward swipe starting at the very edge was interpreted by BOTH
   * systems: EdgeSwipeBack as "go back", and this handler below as "switch
   * For You/Following". Excluding the shared strip here means only one
   * gesture ever claims a touch that starts there.
   */
  const startedInEdgeZone = useRef(false);
  // Live album-slide drag (owner spec: "as smooth as a top platform" — a real,
  // finger-tracked slide, not a wait-for-release flip). `dragX` drives the
  // current slide's transform directly; framer-motion updates it imperatively
  // (no React re-render per pointermove), so this stays smooth at 60fps+.
  const dragX = useMotionValue(0);
  const dragActive = useRef(false);
  const dragLastX = useRef(0);
  const dragLastT = useRef(0);
  const dragVelocity = useRef(0); // px/ms, signed
  const mediaStage = useRef<HTMLDivElement | null>(null);

  const [paused, setPaused] = useState(false);
  const [mutedAuto, setMutedAuto] = useState(false);
  const [progress, setProgress] = useState(0);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffering, setBuffering] = useState(false);
  /*
    🔴 REPLACES `fullBleed`/`posterBleed` (owner, 2026-08-17 — never crop).
    The clip's TRUE aspect ratio, measured from either the poster image's own
    natural size or the video's `videoWidth`/`videoHeight` once metadata
    arrives — whichever resolves first. Seeded from stored `mediaWidth`/
    `mediaHeight` when the server knows them (see `ratio` below, computed
    once `slide`/`albumVideos` are in scope), so the box is already the
    right shape on the FIRST paint instead of guessing and correcting later
    — the exact "wrong size then resize" flash the owner reported and fixed
    for Feed's own inline video/image this same day. Reset on every slide
    change (an album's items can each have their own shape).
  */
  const [measuredRatio, setMeasuredRatio] = useState<number | null>(null);
  // Latch so a LOOPING reel reports its completion once, not every pass.
  const completionCounted = useRef(false);
  /*
    ── Playback speed (Feature 15 Part 2, tranche 2) ─────────────────────────
    The REMEMBERED preference. The hold-to-skim rate is deliberately not stored —
    see lib/media/engine/playback-rate.ts for why persisting a momentary hold is
    the "why is everything fast now" bug.

    Seeded in an effect rather than at useState, because `getPlaybackRate` reads
    localStorage: doing that during render would differ between the server and
    the client and hydrate mismatched.
  */
  const [rate, setRate] = useState<number>(DEFAULT_RATE);
  useEffect(() => {
    setRate(getPlaybackRate());
  }, []);
  const pip = usePictureInPicture(videoEl);
  const previewAt = useMemo(() => {
    const uid = item.streamUid;
    if (!uid) return undefined;
    return (seconds: number) => streamThumbnailUrl(uid, { time: `${Math.max(0, seconds)}s` });
  }, [item.streamUid]);
  /*
    Pinch-to-zoom targets the <video> ELEMENT, not the media stage. The stage
    also holds the pause/buffering indicator and the seek flashes — zooming it
    would scale those with the picture, so a pinched clip would show a giant
    pause glyph. Only the picture moves.

    `onSecondPointer` is what makes this safe alongside the existing gestures: it
    fires the instant a second finger lands, BEFORE any move event, so a hold
    timer or an album drag started by the first finger is cancelled rather than
    racing the zoom.
  */
  const pinch = usePinchZoom(video, () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    holding.current = false;
    if (dragActive.current) {
      dragActive.current = false;
      void animate(dragX, 0, springs.bounce);
    }
  });
  const [seekFlash, setSeekFlash] = useState<{ side: "back" | "fwd"; key: number } | null>(null);
  const [ui, setUi] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubPct, setScrubPct] = useState(0);
  const [likeBurstKey, setLikeBurstKey] = useState(0);
  const seekBar = useRef<HTMLDivElement | null>(null);
  const pauseSignTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Press-and-hold pauses (existing gesture) AND now also opens the full options
  // sheet — one gesture reaches everything instead of hunting for the small
  // corner button. Tracks whether THIS hold caused the pause, so releasing after
  // the sheet has taken over doesn't fight the user by auto-resuming underneath
  // it, and closing the sheet (any of its many close paths) correctly resumes.
  const [pausedForMore, setPausedForMore] = useState(false);

  const [liked, setLiked] = useState(item.viewerLiked);
  const [saved, setSaved] = useState(item.viewerSaved);
  const following = useFollowState(item.publisher.id, item.isFollowing);
  /*
    🔴 GUEST INTERACTIONS ARE LOCAL-ONLY, NEVER A REDIRECT (owner, 2026-08-18:
    "interaction from guest in the feed and reels shouldn't lead to sign in
    page, rather it just interact and goes out"). This viewer never gated
    itself on identity — a guest's tap already optimistically flipped Wow/Save
    on, then silently reverted a beat later once the unauthenticated request
    404/401'd, which reads as the button "not working" rather than a deliberate
    choice. `viewerHandle` lets `react`/`reactWithEmotion` below skip the
    network call entirely for a guest, so the local flip is the whole story —
    no flicker, no navigation, nothing sent to the server that was never
    going to be accepted.
  */
  const { handle: viewerHandle } = useEntitlements();
  const [likes, setLikes] = useState(item.likesCount);
  const [showComments, setShowComments] = useState(false);
  const [sheetVideoPaused, setSheetVideoPaused] = useState(false);
  const [comments, setComments] = useState<CommentsData | null>(null);
  // Tapping below the caption reveals the full (unclamped) text plus post info
  // — currently the date posted — instead of navigating away.
  const [infoOpen, setInfoOpen] = useState(false);
  /*
    ── Feature 15: the panel collapses while you watch ──────────────────────
    "Everything should collapse automatically while watching. Tapping restores
    it smoothly."

    An expanded caption used to stay expanded for the rest of the reel: tap
    "More", keep watching, and a wall of text sat over the video indefinitely.
    Tying it to the chrome's own idle timer means the video reclaims the screen
    without the viewer having to undo anything, and the next tap — which brings
    the chrome back — restores exactly the state they left.

    Deliberately one-way. It collapses with the chrome but does NOT re-expand
    when the chrome returns: re-opening a long caption unasked, every time
    someone taps to pause, is the interruption this is meant to remove.
  */
  useEffect(() => {
    if (!ui && infoOpen) setInfoOpen(false);
  }, [ui, infoOpen]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [editOpen, setEditOpen] = useState(false);
  const [editReady, setEditReady] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReady, setReportReady] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerReady, setPickerReady] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerReady, setComposerReady] = useState(false);
  const [composerMode, setComposerMode] = useState<"create" | "edit">("create");
  const [composerCaption, setComposerCaption] = useState<string | null>(null);
  // The audience picked in the destination sheet, carried into the quote composer.
  const [composerAudience, setComposerAudience] = useState<RepostAudience>("public");
  const [repostSheetOpen, setRepostSheetOpen] = useState(false);
  const [repostSheetReady, setRepostSheetReady] = useState(false);
  const [repostersOpen, setRepostersOpen] = useState(false);
  const [repostersReady, setRepostersReady] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareReady, setShareReady] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  // Long-press Wow → the reaction picker; the picked glyph replaces the icon.
  // Two independent instances: the action rail (visible on every size) and the
  // desktop-only persistent comments sidebar render their OWN Wow button — both
  // can be on screen together on large screens, so each needs its own picker
  // state or opening one would pop both simultaneously.
  const [myEmotion, setMyEmotion] = useState<string | null>(item.viewerReactionEmotion ?? null);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const wowPress = useLongPress(() => setReactionsOpen(true));
  const [sidebarReactionsOpen, setSidebarReactionsOpen] = useState(false);
  const sidebarWowPress = useLongPress(() => setSidebarReactionsOpen(true));
  const repostState = useRepostState(item.id, item.viewerReposted ?? false, item.repostsCount ?? 0);
  // Holding the Repost button opens the advanced options sheet.
  const repostPress = useLongPress(() => {
    setRepostSheetReady(true);
    setRepostSheetOpen(true);
  });
  const [repostBurst, setRepostBurst] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [srcReady, setSrcReady] = useState(false);
  // Smooth motion between album slides (owner spec): a brief crossfade rather
  // than the video hard-cutting to the next source. Cleared once the new
  // slide is actually rendering frames (`onPlaying`), not a guessed timeout —
  // the video element itself stays mounted throughout (adaptive-source/HLS
  // attachment is imperative and must never remount mid-swap).
  const [slideFade, setSlideFade] = useState(false);
  /* Bumped on each pause so Living Playback replays its ripple — a second tap
     must feel acknowledged, and re-running an animation needs a new key. */
  const [pauseRipple, setPauseRipple] = useState(0);
  const [qualityPref, setQualityPref] = useState<QualityPreference>("auto");
  const fetched = useRef(false);

  // Album reels — one reel made of several videos. Gesture priority per the
  // spec: vertical swipe = next REEL (native deck scroll), horizontal swipe =
  // next VIDEO inside this reel (handled in onPointerUp; it takes the place of
  // the tab switch for album reels so the two never conflict).
  const albumVideos = useMemo(
    () => (item.mediaItems ?? []).filter((m) => m.kind === "video"),
    [item.mediaItems],
  );
  const isAlbum = albumVideos.length > 1;
  const [slide, setSlide] = useState(() =>
    initialSlide !== undefined ? Math.max(0, Math.min(albumVideos.length - 1, initialSlide)) : 0,
  );
  const goSlide = useCallback(
    (dir: "left" | "right") => {
      setSlide((s) => {
        const next = dir === "left" ? Math.min(albumVideos.length - 1, s + 1) : Math.max(0, s - 1);
        if (next !== s) {
          setSrcReady(false); // autoplay waits for the new source
          setSlideFade(true); // crossfade out; cleared once the new slide is actually playing
          setProgress(0);
          setCur(0);
          haptic("light");
        }
        return next;
      });
    },
    [albumVideos.length],
  );
  // What actually plays right now (slide 0 = the reel's own media, so
  // single-video reels are completely unaffected).
  const slideSrc = isAlbum ? (albumVideos[slide]?.url ?? item.mediaUrl) : item.mediaUrl;
  const slidePoster = isAlbum ? (albumVideos[slide]?.thumbnailUrl ?? item.thumbnailUrl) : item.thumbnailUrl;
  // Per-slide resume key (slide 0 keeps the plain post id).
  const playbackKey = isAlbum && slide > 0 ? `${item.id}#${slide}` : item.id;

  // Stored dims for the CURRENT slide, when the server knows them — album
  // items carry their own width/height, same as a single-media reel's
  // top-level mediaWidth/mediaHeight (see the FeedItem type). Seeds `ratio`
  // below so the box is already the right shape before a single byte of
  // poster/video has loaded.
  const seedRatio = clampFeedRatio(
    isAlbum ? albumVideos[slide]?.width : item.mediaWidth,
    isAlbum ? albumVideos[slide]?.height : item.mediaHeight,
  );
  // An album slide can be a totally different shape from the last one — the
  // measured ratio must not carry over when the slide changes.
  useEffect(() => setMeasuredRatio(null), [slide]);
  const ratio = measuredRatio ?? seedRatio;
  /*
    🔴 THE ONE EXCEPTION TO NEVER-CROP (owner, 2026-08-17, after seeing the
    never-crop rule ship): "reels should reach the safe area with videos
    from 16:9 upwards and below should stay fixed… 16:9 above can crop a
    little when necessary to reach but below 16:9 should stay their normal
    size." See `isReelsShaped`'s own note in lib/media/aspect.ts for the
    full reasoning — this narrows the never-crop rule to exactly the shape
    class every "reels/wallpaper full screen" surface in this app already
    assumes (9:16 and taller/narrower), matching `wallpaper-reels.tsx`'s own
    `object-cover` treatment. Everything else is completely unchanged from
    the never-crop rewrite earlier the same day.
  */
  const tall = isReelsShaped(ratio);
  const mediaFitClassName = tall
    ? "relative z-10 h-full w-full object-cover"
    : "relative z-10 h-auto max-h-full w-auto max-w-full object-contain";
  const mediaFitStyle = tall ? undefined : ratio ? { aspectRatio: ratio } : undefined;

  // Client-only read (localStorage) after mount — avoids an SSR/CSR mismatch.
  useEffect(() => {
    setMounted(true);
    setQualityPref(getQualityPreference());
  }, []);

  // Adaptive playback: a Cloudflare Stream video plays HLS (auto quality ladder,
  // instant start, edge-delivered) through our own <video>; anything without a
  // Stream uid keeps playing the plain MP4. Either way it's the controllable native
  // element (our gestures/scrubber), never the heavy iframe. A confirmed encode
  // failure (the Stream webhook) skips HLS entirely — no point retrying a manifest
  // that will never exist. A NOT-YET-ready encode (a just-uploaded reel) plays
  // the MP4 immediately instead of hanging on a manifest that doesn't exist yet.
  const hlsUrl =
    (!isAlbum || slide === 0) && item.streamUid && !item.streamFailed && (item.streamReady !== false || !item.mediaUrl)
      ? streamHlsUrl(item.streamUid)
      : null;
  const native = !!slideSrc || !!hlsUrl;
  const markSrcReady = useCallback(() => setSrcReady(true), []);
  // HLS (hls.js) buffers whatever is attached, so only wire the ACTIVE + NEXT reel
  // (predictive preload of exactly the next clip; decoders released for the rest).
  // Plain MP4 can attach across the nearby window — the `preload` attribute keeps
  // the far ones to metadata only, so it's cheap.
  const attachSource = hlsUrl ? isActive || isNext : nearby;
  useAdaptiveSource(video, { hlsUrl, src: slideSrc, poster: slidePoster, active: attachSource, onReady: markSrcReady, postId: item.id });

  // Report readiness so the deck can extend its scroll ceiling. Stream clips
  // buffer themselves; native clips report on canplay/error, with a fallback so a
  // slow/broken clip can never permanently block scrolling.
  useEffect(() => {
    if (!nearby) return;
    if (!native) {
      onReady?.(item.id);
      return;
    }
    const t = setTimeout(() => onReady?.(item.id), 3500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearby, native, item.id]);

  /*
    ── 🔴 THE TRAY NEVER AUTO-HIDES ANY MORE (owner, 2026-08-11) ─────────────
    "now only pause should keep the tray, when user is watching the tray should
    not disappear after 2sec, rather users should use the full screen button to
    open fullscreen."

    There WAS a 3-second idle timer. The first pass at this made it skip while
    paused, which was only half the instruction: while PLAYING the tray still
    vanished, so reaching Save or reading the sound row during normal watching
    meant tapping the screen first — and the tap that brought the chrome back
    also paused the video, so you could not both watch and interact.

    The timer is gone entirely. Chrome visibility is now one deliberate choice
    the viewer makes: the tray is up, or they have pressed Full screen. A control
    that disappears on a timer is a control you have to hunt for, and the whole
    argument for auto-hide — "let the video breathe" — is served better by a
    button that does it on purpose and stays undone until it is undone.

    `scheduleHide` survives as a no-op rather than being deleted at five call
    sites (the active-reel effect, the tap toggle, the seek end, the long-press
    release, the album slide change). Each of those is a legitimate "the viewer
    just did something" moment and a future timed behaviour would hang off
    exactly them; removing the calls would lose that map.
  */
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  /*
    Full screen = the overlay is hidden, nothing else. See the button near the
    action rail for why this is NOT `Element.requestFullscreen`. Reset whenever a
    different reel becomes active: it is a per-clip viewing choice, and inheriting
    it silently would mean scrolling into a reel with no visible controls.
  */
  const [immersive, setImmersive] = useState(false);
  useEffect(() => {
    if (!isActive) setImmersive(false);
  }, [isActive]);
  useEffect(() => {
    setUi(!immersive);
  }, [immersive]);
  // A single tap toggles play/pause; the pause sign fades in ~1s after pausing
  // (so a quick play/pause tap never flashes it). Shows the controls too.
  const togglePauseTap = useCallback(() => {
    const v = video.current;
    if (!v) return;
    setUi(true);
    scheduleHide();
    if (pauseSignTimer.current) clearTimeout(pauseSignTimer.current);
    if (v.paused) {
      setPaused(false);
      void v.play().catch(() => {});
    } else {
      v.pause();
      pauseSignTimer.current = setTimeout(() => {
        if (video.current?.paused) {
          setPaused(true);
          setPauseRipple((n) => n + 1);
        }
      }, 1000);
    }
  }, [scheduleHide]);

  // Play only the reel in view; pause + rewind the rest so re-entry is fresh.
  // Waits for `srcReady` so an async HLS attach (hls.js) still autoplays once the
  // stream is wired up.
  useEffect(() => {
    const v = video.current;
    if (!v || !native) return;
    if (isActive) {
      if (!srcReady) return;
      claimPlayback(v);
      setUi(true);
      scheduleHide();
      v.play().catch(() => {
        // Autoplay-with-sound blocked → play muted, offer a tap-to-unmute pill.
        v.muted = true;
        setMutedAuto(true);
        v.play().catch(() => {});
      });
    } else {
      v.pause();
      try {
        v.currentTime = 0;
      } catch {
        /* not ready */
      }
      setPaused(false);
      setProgress(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, native, srcReady]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (pauseSignTimer.current) clearTimeout(pauseSignTimer.current);
      if (video.current) {
        // Unmount mid-play (deck teardown, tab slide) → resume here next time.
        savePlaybackPosition(item.id, video.current.currentTime, video.current.duration);
        releasePlayback(video.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadComments = useCallback(async () => {
    if (fetched.current) return;
    fetched.current = true;
    setLoadingComments(true);
    try {
      // Served instantly from the prefetch cache when the reel was warmed.
      const data = await loadPostComments<CommentsData>(item.id);
      if (data) setComments(data);
    } finally {
      setLoadingComments(false);
    }
  }, [item.id]);

  // Predictively warm this reel's comments the moment it becomes the active
  // one, so tapping the comment button opens instantly — and actually load them
  // (cheap, reads the same warm cache) since the large-screen sidebar shows
  // comments persistently, with no tap required.
  useEffect(() => {
    if (isActive) {
      prefetchPostComments(item.id);
      void loadComments();
    }
  }, [isActive, item.id, loadComments]);

  // If the press-and-hold gesture paused playback to open the options sheet,
  // resume once it's dismissed — however it closes (backdrop tap, an action
  // that itself closes it, Cancel). Reacting to the state change (rather than
  // wrapping every close call site) keeps this correct regardless of which
  // path closed it.
  useEffect(() => {
    if (moreOpen || !pausedForMore) return;
    setPausedForMore(false);
    if (isActive) {
      void video.current?.play().catch(() => {});
      setPaused(false);
    }
  }, [moreOpen, pausedForMore, isActive]);

  // Opening comments freezes the reel (no snap to the next video) and pauses
  // playback so people can read/type calmly; closing resumes it.
  const openComments = useCallback(() => {
    setShowComments(true);
    onCommentsOpen(true);
    video.current?.pause();
    setSheetVideoPaused(true);
  }, [onCommentsOpen]);

  // Deep-link support: a "Comment" tap elsewhere in the app lands here with the
  // sheet already open (?comments=1), so it feels like one continuous action.
  useEffect(() => {
    if (autoOpenComments) openComments();
    // Only ever fires once, right when this specific reel is deep-linked to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const closeComments = useCallback(() => {
    setShowComments(false);
    onCommentsOpen(false);
    if (isActive) void video.current?.play().catch(() => {});
    setSheetVideoPaused(false);
  }, [onCommentsOpen, isActive]);
  const toggleSheetVideo = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      void v.play().catch(() => {});
      setSheetVideoPaused(false);
    } else {
      v.pause();
      setSheetVideoPaused(true);
    }
  }, []);

  const react = async (type: "like" | "save") => {
    const isLike = type === "like";
    const curState = isLike ? liked : saved;
    const next = !curState;
    if (isLike) {
      setLiked(next);
      setLikes((n) => n + (next ? 1 : -1));
      if (!next) setMyEmotion(null);
    } else setSaved(next);
    if (!viewerHandle) return; // guest — the local flip is the whole interaction
    try {
      const res = await fetch(`/api/posts/${item.id}/react`, {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) throw new Error();
    } catch {
      if (isLike) {
        setLiked(curState);
        setLikes((n) => n + (next ? -1 : 1));
      } else setSaved(curState);
    }
  };

  // Reaction picker: always ends in a Wow (liked=true) with a specific flavor.
  const reactWithEmotion = async (emotion: ReactionEmotion) => {
    const wasLiked = liked;
    const prevEmotion = myEmotion;
    setLiked(true);
    if (!wasLiked) setLikes((n) => n + 1);
    setMyEmotion(emotion);
    if (!viewerHandle) return; // guest — the local flip is the whole interaction
    try {
      const res = await fetch(`/api/posts/${item.id}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "like", emotion }),
      });
      if (!res.ok) throw new Error();
    } catch {
      if (!wasLiked) {
        setLiked(false);
        setLikes((n) => n - 1);
      }
      setMyEmotion(prevEmotion);
    }
  };

  // Gates the code-split ShareSheet/ShareQrSheet mount — never fetched until
  // one of the Send/Share entry points below is actually tapped.
  const openShare = () => {
    setShareReady(true);
    setShareOpen(true);
  };
  const share = () => {
    setMoreOpen(false);
    openShare();
  };

  const toggleFollow = async () => {
    // Following persists a real relationship — unlike Wow/Save there's no
    // honest local-only version of it, so a guest gets a toast instead
    // (never a redirect — same rule as everywhere else in this viewer).
    if (!viewerHandle) {
      toast("Sign in to follow creators.", "info", { duration: 2500 });
      return;
    }
    // Shared store keeps this in sync with the feed card + every other reel.
    await toggleFollowShared(item.publisher.id, !following);
  };

  const unmute = () => {
    const v = video.current;
    if (!v) return;
    unmuteWithFade(v); // smooth fade-in on the user's explicit tap
    setMutedAuto(false);
  };

  const toggleMute = () => {
    const v = video.current;
    if (!v) return;
    if (mutedAuto) unmute();
    else {
      muteInstant(v);
      setMutedAuto(true);
    }
  };

  /*
    Repost is a recommendation, never a one-tap accident (Part 4): it opens the
    destination sheet, where the audience is chosen and every other destination
    lives. Tapping when already reposted still goes through the sheet — removing
    a repost is a deliberate act and the sheet is where the Remove row lives.

    The old behaviour opened the caption composer straight away, which made
    "recommend this" and "write about this" the same action and left no room for
    the audience at all.
  */
  const repost = () => {
    setRepostSheetReady(true);
    setRepostSheetOpen(true);
  };

  const openComposer = (mode: "create" | "edit", caption: string | null) => {
    setComposerMode(mode);
    setComposerCaption(caption);
    setComposerReady(true);
    setComposerOpen(true);
  };

  const onReposted = () => {
    setRepostBurst(Date.now()); // OS-style bubble pops on repost (not on undo)
    haptic("selection");
  };

  // ── Overflow (•••) actions ────────────────────────────────────────────────
  const postUrl = () => `${window.location.origin}/p/${item.id}`;
  const copyLink = async () => {
    setMoreOpen(false);
    try {
      await navigator.clipboard.writeText(postUrl());
      toast("Link copied.", "success");
    } catch {
      toast("Couldn't copy the link.", "error");
    }
  };
  const openInBrowser = () => {
    setMoreOpen(false);
    window.open(postUrl(), "_blank", "noopener");
  };
  const viewDetails = () => {
    setMoreOpen(false);
    window.location.assign(`/p/${item.id}`);
  };
  const openReport = () => {
    setMoreOpen(false);
    setReportReady(true);
    setReportOpen(true);
  };
  const blockUser = async () => {
    setMoreOpen(false);
    try {
      const r = await fetch(`/api/block/${item.publisher.id}`, { method: "POST" });
      if (!r.ok) throw new Error();
      toast(`Blocked @${item.publisher.handle}.`, "success");
      onClose();
    } catch {
      toast("Couldn't block.", "error");
    }
  };
  // Softer than a block: their posts stop appearing in YOUR feed going
  // forward, silently — nothing severed, they're never notified, and (unlike
  // a block) this reel stays open since you're already watching it.
  const muteCreator = async () => {
    setMoreOpen(false);
    try {
      const r = await fetch(`/api/mute/${item.publisher.id}`, { method: "POST" });
      if (!r.ok) throw new Error();
      toast(`Muted @${item.publisher.handle} — you won't see their posts in your feed.`, "success");
    } catch {
      toast("Couldn't mute.", "error");
    }
  };
  /*
    ── Hide / Not interested, which used to be the same button twice ──────────

    Both rows called this one handler, and this one handler showed a toast and
    closed the deck. Nothing was recorded anywhere, so "we'll show less like
    this" was not true in any sense — the identical reel was back in the deck on
    the next open, which is precisely the repetition the reshuffle work above is
    about.

    They now write to the reels suppression ledger, which every fetch path
    filters against (`acceptPage` in reels-feed). Client-side and per-device on
    purpose: it has to be readable synchronously while building a deck, and a
    round trip to say "not this one" would either block the deck or be
    unreliable exactly when the network is bad.

    The two rows stay distinct because they mean different things to the person
    tapping them, and the reference sheet gives them different weight — one is
    neutral, one is red.
  */
  const suppress = (message: string) => {
    setMoreOpen(false);
    suppressReel(item.id);
    toast(message, "info");
    onClose();
  };
  const hidePost = () => suppress("Hidden. You won't see this again.");
  const notInterested = () => suppress("Got it — we'll show you less like this.");

  // Manual quality override (spec: automatic selection is the default, but let
  // the viewer force it). A cycle rather than a per-rendition picker — the
  // ladder is produced by the encoder and changes per clip, so a list of rungs
  // would be a different list every video. Takes effect from the next video that
  // attaches: hls.js takes its buffer geometry at construction, so applying it
  // to the CURRENT clip would mean tearing down the decoder mid-watch.
  /*
    🔴 The rate is re-applied on EVERY source attach, not set once.

    `playbackRate` is a property of the ELEMENT and resets to 1 whenever a new
    source is loaded — which in this deck happens on every card mount, every
    album slide change, and every HLS-to-MP4 fallback. Setting it once at
    selection time would mean the choice silently evaporated on the next reel,
    which is exactly the kind of "it forgot" bug that reads as the setting not
    working at all.
  */
  useEffect(() => {
    if (!videoEl) return;
    applyRate(videoEl, rate);
  }, [videoEl, rate, srcReady, slide]);

  /*
    Applying a rate, without the sheet vanishing.

    The old row cycled AND closed AND toasted, which made "try 1.5×, decide it
    is too fast, go back" a six-tap round trip through a sheet that kept
    dismissing itself. Picking a speed is a setting, and the native pattern for
    a setting is that the control updates in place and stays where you can reach
    it — the segmented thumb sliding to the new rung IS the confirmation, so the
    toast would be telling you what you can already see.
  */
  const applySpeed = (next: PlaybackRate) => {
    setRate(next);
    setPlaybackRate(next);
    applyRate(video.current, next);
  };
  /** A segment tap — direct selection, sheet stays open, no toast. */
  const pickSpeed = (next: number) => applySpeed(nearestRate(next));
  /** Is the current rate one of the four the sheet shows as segments? */
  const onQuickLadder = (QUICK_RATES as readonly number[]).includes(rate);
  /** The label — still walks the FULL six-rung ladder, including the two rungs
   *  that have no segment of their own. */
  const cycleSpeed = () => applySpeed(nextRate(rate));

  const cycleQuality = () => {
    const order = QUALITY_CYCLE;
    const next = order[(order.indexOf(qualityPref) + 1) % order.length] ?? "auto";
    setQualityPref(next);
    setQualityPreference(next);
    setMoreOpen(false);
    toast(`Video quality: ${QUALITY_LABELS[next]} — applies from your next video`, "info");
  };

  const seekBy = (delta: number) => {
    const v = video.current;
    if (!v || !v.duration) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
    setSeekFlash({ side: delta < 0 ? "back" : "fwd", key: Date.now() });
    setTimeout(() => setSeekFlash((s) => (s && Date.now() - s.key >= 480 ? null : s)), 500);
  };

  // Drag-to-seek scrubber (only when we own the <video> and know its duration).
  const pctAt = (clientX: number) => {
    const el = seekBar.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  const scrubStart = (e: React.PointerEvent) => {
    if (!native || !dur) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setScrubbing(true);
    setUi(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setScrubPct(pctAt(e.clientX));
  };
  const scrubMove = (e: React.PointerEvent) => {
    if (!scrubbing) return;
    e.stopPropagation();
    setScrubPct(pctAt(e.clientX));
  };
  const scrubEnd = (e: React.PointerEvent) => {
    if (!scrubbing) return;
    e.stopPropagation();
    const v = video.current;
    const p = pctAt(e.clientX);
    if (v && v.duration) {
      v.currentTime = p * v.duration;
      setProgress(p * 100);
      setCur(p * v.duration);
    }
    setScrubbing(false);
    scheduleHide();
  };

  // Double-tap to like: fires the shared Wow burst, centered over the media; never un-likes.
  const likeBurst = () => {
    fireWowFeedback();
    setLikeBurstKey((k) => k + 1);
    if (!liked) void react("like");
  };

  // Gesture model (vertical scrolling is native, so movement is never a tap):
  //  • single tap → pause / play (pause sign fades in ~1s after pausing).
  //  • double-tap left/right → seek −10s / +10s; double-tap centre → like.
  //  • press-and-HOLD (~0.5s) → pauses AND opens the full options sheet, so one
  //    gesture reaches every action; release resumes UNLESS the sheet took over.
  //  • horizontal swipe (page variant only) → switch For You/Following instantly.
  const onPointerDown = (e: React.PointerEvent) => {
    startPt.current = { x: e.clientX, y: e.clientY };
    startedInEdgeZone.current = e.clientX <= EDGE_ZONE_PX;
    moved.current = false;
    axisLock.current = null;
    if (!native) return;
    holding.current = false;
    holdTimer.current = setTimeout(() => {
      if (moved.current) return;
      holding.current = true;
      video.current?.pause();
      setPaused(true);
      setPausedForMore(true);
      setMoreOpen(true);
    }, 500);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!startPt.current) return;
    if (!moved.current) {
      const dx = Math.abs(e.clientX - startPt.current.x);
      const dy = Math.abs(e.clientY - startPt.current.y);
      if (dx > 10 || dy > 10) {
        moved.current = true;
        // Lock the gesture to whichever axis was dominant the moment it crossed
        // the threshold — avoids a diagonal drag being ambiguous later.
        axisLock.current = dx > dy ? "h" : "v";
        if (holdTimer.current) clearTimeout(holdTimer.current);
        // ALBUM + horizontal → a live, finger-tracked slide starts here (see
        // the drag-tracking block below); everything else (native vertical
        // scroll, non-album horizontal tab-swipe) stays release-only, unchanged.
        if (axisLock.current === "h" && isAlbum) {
          dragActive.current = true;
          dragLastX.current = e.clientX;
          dragLastT.current = e.timeStamp;
          dragVelocity.current = 0;
        }
      }
      return;
    }
    if (dragActive.current) {
      const dt = e.timeStamp - dragLastT.current;
      if (dt > 0) dragVelocity.current = (e.clientX - dragLastX.current) / dt;
      dragLastX.current = e.clientX;
      dragLastT.current = e.timeStamp;

      const rawDx = e.clientX - (startPt.current?.x ?? e.clientX);
      const atStart = slide === 0;
      const atEnd = slide === albumVideos.length - 1;
      // Rubber-band: dragging PAST the first/last video resists instead of
      // moving freely — the same "soft wall" every native carousel gives at
      // its edges, so it never feels like it's just doing nothing.
      const resisted = (rawDx > 0 && atStart) || (rawDx < 0 && atEnd) ? rawDx * 0.35 : rawDx;
      dragX.set(resisted);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const startX = startPt.current?.x;
    startPt.current = null;
    if (native && holdTimer.current) clearTimeout(holdTimer.current);
    if (native && holding.current) {
      holding.current = false;
      // The options sheet is now open and has the user's attention — don't
      // fight it by resuming playback underneath; the sheet-close effect below
      // resumes once it's dismissed.
      if (!moreOpen) {
        void video.current?.play();
        setPaused(false);
      }
      return;
    }
    if (dragActive.current) {
      dragActive.current = false;
      const w = typeof window !== "undefined" ? window.innerWidth : 1;
      const rawDx = startX !== undefined ? e.clientX - startX : 0;
      const dir: "left" | "right" = rawDx < 0 ? "left" : "right";
      const canAdvance = dir === "left" ? slide < albumVideos.length - 1 : slide > 0;
      // Advance on a decisive drag (past a fifth of the screen) OR a quick
      // flick (fast enough even over a short distance) — the same dual
      // threshold a native carousel/story deck uses, not a single hard cutoff.
      const shouldAdvance = canAdvance && (Math.abs(rawDx) > w * 0.22 || Math.abs(dragVelocity.current) > 0.5);
      if (shouldAdvance) {
        void animate(dragX, dir === "left" ? -w : w, springs.press).then(() => {
          goSlide(dir); // swaps the real video source — happens fully off-screen
          dragX.set(0);
        });
      } else {
        void animate(dragX, 0, springs.bounce); // rubber-band snap back
      }
      return;
    }
    if (moved.current) {
      // A decisive horizontal drag on a NON-album reel (album drags are fully
      // handled live above): switches For You/Following (page variant; no-op
      // in the modal). Excludes the left-edge strip EdgeSwipeBack claims for
      // its own back-navigation swipe — see `startedInEdgeZone`.
      if (axisLock.current === "h" && startX !== undefined && !startedInEdgeZone.current) {
        const dx = e.clientX - startX;
        if (Math.abs(dx) > 64) onSwipeTab?.(dx < 0 ? "left" : "right");
      }
      return; // a scroll — leave vertical movement to the native scroller
    }

    if (mutedAuto) {
      unmute();
      return;
    }

    const now = Date.now();
    const x = e.clientX;
    const w = typeof window !== "undefined" ? window.innerWidth : 1;
    if (now - lastTap.current.t < 300) {
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      lastTap.current = { t: 0, x: 0 };
      if (x < w * 0.4) seekBy(-10);
      else if (x > w * 0.6) seekBy(10);
      else likeBurst(); // double-tap center to like
      return;
    }
    lastTap.current = { t: now, x };
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    singleTapTimer.current = setTimeout(() => togglePauseTap(), 280);
  };

  // `touch-action: pan-y` on the media stage only tells the browser vertical
  // panning is ALLOWED for touches starting here — it doesn't stop the browser
  // from eagerly claiming a still-ambiguous touch for the deck's native
  // vertical scroll before our own onPointerMove has classified the gesture as
  // horizontal. Pointer events can't cancel that (preventDefault on a pointer
  // event never suppresses native touch scrolling); only a real, non-passive
  // `touchmove` listener can — same gotcha the album carousel's wheel handler
  // already documents for the same reason. Once a horizontal album drag is
  // actually underway (`dragActive`), suppress native scrolling so it can
  // never steal the gesture mid-swipe; every other gesture (vertical
  // reel-to-reel scroll, non-album swipes) is untouched since this only ever
  // calls preventDefault while dragActive is true.
  useEffect(() => {
    const el = mediaStage.current;
    if (!el || !isAlbum) return;
    const onTouchMoveNative = (e: TouchEvent) => {
      if (dragActive.current) e.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMoveNative, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMoveNative);
  }, [isAlbum]);

  return (
    <>
      {/* Cover — always painted underneath so a snapped-in reel never flashes black. */}
      {slidePoster ? (
        /*
          The cover, painted underneath so a snapped-in reel never flashes black.

          🔴 TWO layers now (owner, 2026-08-17 — never crop): a blurred,
          scaled `object-cover` backdrop fills the WHOLE section regardless of
          the picture's own shape, and the real, uncropped picture sits on top
          of it at its TRUE aspect ratio (`object-contain`, seeded from
          `ratio` above so it's already the right shape on the first paint —
          no letterbox-then-pop). See LETTERBOX's own note for why a blurred
          backdrop was removed once before and why this version shouldn't
          repeat that problem (the foreground here never crops, unlike then).

          Opacity 70%, not the Feed's own 30% — measured against the owner's
          screenshot: the container itself IS genuinely edge-to-edge (deck,
          section and card all measured exactly equal to the viewport, no
          safe-area padding anywhere on the media), so what read as "black
          space above/below" was this backdrop at too LOW an opacity on dark
          footage (a tree canopy), not a structural gap. 70% roughly matches
          the ORIGINAL, pre-2026-08-11 backdrop's own 75% — reads clearly as
          a blurred continuation of the frame instead of flat black, on a
          full-screen surface where it's far more prominent than the Feed's
          small inline preview.

          The CONTROLS stay out of the safe areas either way: the tabs, the
          close/••• buttons, the rail and the progress bar all pad themselves by
          `--frenz-safe-top` / `env(safe-area-inset-bottom)`. Only the picture
          goes under the notch and the home indicator, which is the ask.
        */
        <div className={cn("absolute inset-0 overflow-hidden", !tall && "flex items-center justify-center", LETTERBOX)}>
          {/* Blurred backdrop only makes sense when there's letterbox space
              LEFT to fill — a reels-shaped poster below fills the section
              completely on its own via `object-cover`, so the backdrop would
              just be an invisible, wasted layer underneath it. */}
          {!tall ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={slidePoster}
              alt=""
              aria-hidden
              className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-2xl"
            />
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={slidePoster}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            style={mediaFitStyle}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (measuredRatio === null && img.naturalWidth && img.naturalHeight) {
                setMeasuredRatio(clampFeedRatio(img.naturalWidth, img.naturalHeight));
              }
            }}
            className={mediaFitClassName}
          />
        </div>
      ) : null}

      {/*
        Top legibility scrim — now SMART UI (Feature 15).

        The opacity is derived from the sampled luminance of the actual frame
        rather than fixed at 50%. A fixed scrim is a compromise between a black
        night shot and a white ski slope, and it is wrong for both: too heavy on
        the first, too light on the second. `scrimForLuminance` moves it, with a
        floor (even a black frame needs some separation, because the NEXT frame
        may not be black) and a generous bright end (a slightly-too-dark scrim
        costs a little of the picture; a slightly-too-light one costs the
        controls entirely).

        Transitions over a second so the change is never perceived as flicker —
        this is the one value in the viewer that tracks the content, and it has
        to move slower than the content does.
      */}
      <div
        style={{ ["--reel-scrim" as string]: String(scrim) }}
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[rgba(0,0,0,var(--reel-scrim,0.5))] to-transparent transition-opacity duration-700",
          layer.scrim,
          ui ? "opacity-100" : "opacity-0",
        )}
      />

      {/*
        ── 🔴 THE TOP STACK IS ONE FLOW COLUMN (owner, 2026-08-11) ────────────
        "the time count, and tap for sound is only being covered in the pwa that
        goes to the safe area and not in the browser" … "arrange them
        professionally … never collide or sit on top of each other on both
        browser and pwa."

        The bug was mixed anchoring. The tabs, the close button and the •••
        button all began at `max(0.75rem, var(--frenz-safe-top))`, so they move
        DOWN by the notch inset in an installed PWA. The time readout (`top-14`)
        and the tap-for-sound pill (`top-16`) were pinned to fixed offsets that
        knew nothing about the safe area — so in a browser, where the inset is 0,
        they cleared the tabs by a few pixels, and in the PWA the tabs slid down
        ~59px on top of them. Two coordinate systems for one column.

        Every centred element is now a CHILD of one absolutely-positioned column
        that starts below the chrome row. Collisions are impossible by
        construction rather than by arithmetic: the browser lays them out in
        flow, the gap is uniform, and a row that is absent (no album, no
        duration, already unmuted) simply collapses instead of leaving a hole.
        There is one magic number left — where the column starts — and it is
        derived from the SAME base the chrome row uses, so the two can never
        drift apart again.

        `pointer-events-none` on the column with `pointer-events-auto` on the
        one interactive child: a full-width transparent strip across the top of a
        video would otherwise swallow taps meant for the picture.
      */}
      <div
        className="pointer-events-none absolute inset-x-0 z-30 flex flex-col items-center gap-2 px-4"
        style={{ top: "calc(max(0.75rem, var(--frenz-safe-top)) + 3.25rem)" }}
      >
        {/* Album position dots — this reel has several videos; swipe sideways */}
        {isAlbum ? (
          <div className="flex items-center gap-1.5">
            {albumVideos.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 rounded-full shadow-sm transition-all duration-300",
                  i === slide ? "w-5 bg-white" : "w-1.5 bg-white/45",
                )}
              />
            ))}
          </div>
        ) : null}

        {/* Elapsed / total — auto-hides with the rest of the chrome. */}
        {native && dur > 0 ? (
          <div
            className={cn(
              "rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white backdrop-blur transition-opacity duration-200",
              ui ? "opacity-100" : "opacity-0",
            )}
          >
            {fmt(cur)} / {fmt(dur)}
          </div>
        ) : null}

        {/* Tap-to-unmute — the one child that takes a tap. */}
        {native && mutedAuto && isActive ? (
          <button
            type="button"
            onClick={unmute}
            className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur-md"
          >
            <VolumeX className="h-4 w-4" /> Tap for sound
          </button>
        ) : null}
      </div>

      {/*
        ── Feature 15: the premium progress indicator ──────────────────────────
        Replaces the hand-rolled bar that used to live here. Three things it adds,
        all from the brief: BUFFERED progress (the old bar showed played-vs-nothing,
        so a stalled clip and a downloaded one looked the same), rounded ends on
        BOTH ends, and a 20px touch target around the 3px visual — a 3px drag
        target fails WCAG 2.5.8 and is genuinely hard to hit one-handed.

        It also stops re-rendering this card ~4x/second: the component subscribes
        to the element's own `timeupdate` and writes the fill through a ref, so
        playback costs one style mutation and no React render. The old bar drove
        `progress` state on this component, which re-rendered the rail, the
        caption and everything else on every tick.

        It is a real `slider` with arrow-key seeking too — the old one was a bare
        div with pointer handlers, so seeking was pointer-only.
      */}
      <ReelProgress
        video={native ? videoEl : null}
        visible={ui}
        seekable={native}
        /*
          FRAME PREVIEW while scrubbing (Feature 15 Part 2, tranche 2).

          Only for Stream-backed clips: Cloudflare generates a thumbnail at any
          timestamp on demand, so there is nothing to precompute or store. A clip
          with no `streamUid` (a plain MP4) returns null and simply has no
          preview — better than a broken image or a frame from the wrong video.

          Memoised on the uid so the callback identity is stable; the component
          keys its cache on the rounded second and would otherwise re-derive the
          URL on every render of this card.
        */
        previewAt={previewAt}
        /* Clear the app's bottom nav on the /reels PAGE; the modal has no nav
           under it, so it keeps the component's own safe-area floor.

           🔴 It used to sit at 4.25rem — BELOW the 4.75rem nav floor, so the
           scrubber was partly under the tab bar while simultaneously touching
           the sound row above it. Both ends of that are fixed by the one stack
           in REEL_PROGRESS_BOTTOM. */
        className={variant === "page" ? REEL_PROGRESS_BOTTOM : undefined}
        /* Hold the chrome up for the whole drag, then restart the idle timer —
           otherwise the bar you are dragging fades out from under your finger. */
        onSeekStart={() => {
          setUi(true);
          if (hideTimer.current) clearTimeout(hideTimer.current);
        }}
        onSeekEnd={scheduleHide}
      />

      {/*
        ── Feature 15: Social Pulse™ ──────────────────────────────────────────
        🔴 Fed ONLY real events. `pulseEvents` is empty until the reel actually
        carries friend-activity data, and an empty list renders nothing — which
        is the correct state for most reels and is what most will show today.

        This is deliberate and it is a standing rule in this codebase, not
        caution: fabricated social proof has been declined three times and the
        Reality Ledger fails the build on invented scale claims. A convincing
        "Emma liked this" for an Emma who does not exist is exactly that.

        Bottom-left, clear of the rail and the caption — see the component for
        why it never accepts a tap and never interrupts a screen reader.
      */}
      {pulseEvents.length > 0 ? (
        <SocialPulse events={pulseEvents} active={isActive && !paused} className={cn("left-3", railBottom)} />
      ) : null}

      {/* The elapsed/total readout MOVED into the top stack above — it was
          pinned to a fixed `top-14` that knew nothing about the safe area, which
          is exactly why the tabs sat on top of it in the PWA. */}

      {/* Close — top-left, and Options (•••) — top-right. Both fade with the
          rest of the chrome (tap to bring back, or ~3s idle) instead of
          sitting permanently on screen — a clean, distraction-free view like
          native TikTok/Instagram, which only show these on a deliberate tap. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close reels"
        className={cn(
          "absolute left-4 top-[max(1rem,var(--frenz-safe-top))] z-40 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-opacity duration-200 hover:bg-black/60 active:scale-95",
          ui ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <X className="h-5 w-5" />
      </button>
      {/* Also opens on press-and-hold (see onPointerDown below) — one gesture
          reaches every action, not just the small corner button. On large
          screens it escapes past the video column's edge into the same right
          gutter the action rail already uses (`lg:overflow-visible` on the
          column ancestor) instead of sitting cramped on top of the video. */}
      <button
        type="button"
        onClick={() => setMoreOpen(true)}
        aria-label="More options"
        className={cn(
          "absolute right-4 top-[max(1rem,var(--frenz-safe-top))] z-40 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-opacity duration-200 hover:bg-black/60 active:scale-95 lg:-right-[4.5rem]",
          ui ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <MoreVertical className="h-5 w-5" />
      </button>

      {/* The incoming neighbor's poster — sits behind the current slide, always
          mounted (cheap: just images) but off-screen at rest (dragX === 0), so
          there's zero mount delay the instant a drag actually starts. */}
      {isAlbum ? (
        <>
          {slide > 0 ? (
            <AlbumNeighborPreview dragX={dragX} direction={-1} thumbnailUrl={albumVideos[slide - 1]?.thumbnailUrl ?? null} />
          ) : null}
          {slide < albumVideos.length - 1 ? (
            <AlbumNeighborPreview dragX={dragX} direction={1} thumbnailUrl={albumVideos[slide + 1]?.thumbnailUrl ?? null} />
          ) : null}
        </>
      ) : null}

      {/* Media — pan-y explicit here too (not just on the deck scroller above):
          gesture priority is JS-computed (axisLock), not native horizontal
          scrolling, so this doesn't change the album-swipe math, but it makes
          the "vertical always reaches the deck" contract explicit rather than
          relying on inheriting the ancestor's touch-action. `x: dragX` is what
          makes an album drag genuinely slide with the finger instead of only
          reacting on release — 0 (identity) for every non-album/non-dragging
          reel, so this never affects anything else. */}
      <motion.div
        ref={mediaStage}
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-opacity duration-200 ease-out",
          slideFade ? "opacity-0" : "opacity-100",
        )}
        /*
          ── Pinch-to-zoom composes IN FRONT of the four existing gestures ─────
          (Feature 15 Part 2, tranche 2)

          Order is the whole design. `pinch.onPointerDown` runs FIRST and returns
          true once a second finger is down, at which point the card's own
          handler is skipped — so a pinch never also starts a hold timer, an
          album drag or a double-tap. `pinch.isPinching()` is a ref read, not the
          `active` state, because state does not update inside the handler that
          set it and the second finger's pointerdown would otherwise slip
          through. See use-pinch-zoom.ts.

          One finger is untouched: the hook returns false, nothing is suppressed,
          and scroll/drag/tap/hold behave exactly as they did.
        */
        /* 🔴 `none` while pinching: `pan-y` lets the browser reinterpret a live
           two-finger gesture as a scroll, which cancels our pointers mid-zoom —
           the cause of the stuck transform reported on a phone. */
        style={{ touchAction: pinch.touchAction ?? "pan-y", x: dragX }}
        onPointerDown={(e) => {
          if (pinch.onPointerDown(e)) return;
          onPointerDown(e);
        }}
        onPointerMove={(e) => {
          pinch.onPointerMove(e);
          if (pinch.isPinching()) return;
          onPointerMove(e);
        }}
        onPointerUp={(e) => {
          pinch.onPointerUp(e);
          if (pinch.isPinching()) return;
          onPointerUp(e);
        }}
        onPointerCancel={(e) => {
          // 🔴 The pinch MUST see this. A touchscreen browser ends a multi-touch
          // gesture with `pointercancel` far more often than with `pointerup`,
          // and without this the zoom never reverted.
          pinch.onPointerCancel(e);
          if (holdTimer.current) clearTimeout(holdTimer.current);
          if (holding.current) {
            holding.current = false;
            void video.current?.play();
            setPaused(false);
          }
          if (dragActive.current) {
            dragActive.current = false;
            void animate(dragX, 0, springs.bounce);
          }
        }}
      >
        {native ? (
          nearby ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              ref={video}
              // Source (HLS or MP4) is attached imperatively by useAdaptiveSource.
              poster={slidePoster ?? undefined}
              // Every reel repeats continuously while it's the one in view —
              // advancing only ever happens by the viewer's own scroll, never
              // automatically. Preloading of the upcoming clips is entirely
              // scroll/active-index driven (see `nearby`/`preload` above), so it
              // keeps happening in the background regardless of the current
              // clip looping.
              loop
              playsInline
              preload={preload}
              // Never crops UNLESS this clip is reels-shaped (9:16 and
              // taller/narrower — see `tall`/`isReelsShaped` above), in which
              // case it fills edge to edge via `object-cover`, same as
              // `wallpaper-reels.tsx`. Everything less tall keeps the
              // original never-crop `object-contain` + `aspectRatio` sizing
              // (2026-08-17) unchanged — there's no letterbox-then-pop once
              // metadata loads, and the poster block's own blurred backdrop
              // underneath fills whatever space that leaves.
              style={mediaFitStyle}
              className={mediaFitClassName}
              onPlay={() => {
                video.current && claimPlayback(video.current);
                setBuffering(false);
                recordView(item.id);
              }}
              onPause={() => {
                const v = video.current;
                if (v) {
                  savePlaybackPosition(playbackKey, v.currentTime, v.duration);
                  // Watch-depth signal (Feature 15 Part 8) — feeds momentum_score
                  // and completion_rate (migration 0133) and FrenzDNA's interest
                  // weights. Reels is a `loop`ing player, so a pause is the
                  // natural checkpoint (same moment savePlaybackPosition already
                  // uses), not onTimeUpdate, which would spam an event every frame.
                  if (Number.isFinite(v.duration) && v.duration > 0) {
                    recordWatch(item.id, v.currentTime * 1000, v.duration * 1000, "reels");
                  }
                }
                /*
                  Pausing leaves Full screen. Someone who hid the overlay to
                  watch and then paused is asking to look at something — the
                  caption, the sound row, Save — and every one of those is in the
                  overlay they just hid.
                */
                if (isActive) setImmersive(false);
              }}
              onWaiting={() => setBuffering(true)}
              onPlaying={() => setBuffering(false)}
              // Clears the crossfade once the new slide has enough data to show
              // (fires regardless of whether autoplay actually starts — unlike
              // `onPlaying`, which wouldn't fire at all if autoplay is blocked,
              // leaving the media stuck invisible).
              onCanPlay={() => {
                onReady?.(item.id);
                setSlideFade(false);
              }}
              onError={() => {
                onReady?.(item.id);
                setSlideFade(false);
              }}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                setDur(v.duration || 0);
                // The element is the authority on the clip's real shape — a
                // stored/poster-derived seed can be stale or slightly off,
                // and by now we have the true thing.
                if (measuredRatio === null && v.videoWidth && v.videoHeight) {
                  setMeasuredRatio(clampFeedRatio(v.videoWidth, v.videoHeight));
                }
                // Resume where this reel last stopped (tab switch / reopen) —
                // switching For You/Following continues, never restarts.
                const resumeAt = getPlaybackPosition(playbackKey);
                if (resumeAt !== null && Math.abs(v.currentTime - resumeAt) > 1) v.currentTime = resumeAt;
              }}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                setCur(v.currentTime);
                if (v.duration) setProgress((v.currentTime / v.duration) * 100);
                /*
                  Pulse Buffer™ engagement signal. A clip watched past 90% is the
                  evidence that this viewer is WATCHING rather than flicking, and
                  a deeper preload window is only worth its bandwidth for the
                  former. Counted once per clip (`completionCounted`) — reels
                  `loop`, so without the latch a single reel left playing would
                  report a completion every few seconds and talk the budget up on
                  its own.
                */
                if (
                  !completionCounted.current &&
                  v.duration &&
                  Number.isFinite(v.duration) &&
                  v.currentTime / v.duration >= 0.9
                ) {
                  completionCounted.current = true;
                  recordClipCompleted();
                }
              }}
            />
          ) : null
        ) : (
          // 🔴 Same true-aspect sizing as the native path above (owner,
          // 2026-08-17 — never crop). For the Stream-iframe branch this
          // shapes the FRAME correctly so Cloudflare's own player (which we
          // can't reach inside a cross-origin iframe) has a correctly-shaped
          // box to contain-fit within, rather than a generic full-bleed one.
          <SmartVideo
            streamUid={item.streamUid}
            src={item.mediaUrl}
            poster={item.thumbnailUrl}
            controls
            autoPlay={isActive}
            loop
            className={mediaFitClassName}
            style={mediaFitStyle}
          />
        )}

        {/*
          ── LIVING PLAYBACK™ (Feature 15 Part 2, tranche 3) ──────────────────
          One indicator, chosen by state, replacing two overlapping ones.

          🔴 The pause glyph and the buffering spinner used to be independent
          conditionals drawn at the same point on screen. `buffering && !paused`
          was the only thing keeping them apart, and it did not hold: a clip that
          stalls WHILE paused sets both, so the spinner rendered on top of the
          pause glyph. They are one state machine and are modelled as one now.

          `phase` also fixes a subtler ordering bug — `buffering` outranks
          `paused` here. A stall that begins while paused is still a stall, and
          showing the pause glyph for it would tell the viewer the app is idle
          when it is actually working.
        */}
        {native && nearby ? (
          <LivingPlayback
            phase={buffering ? "buffering" : paused ? "paused" : "playing"}
            pauseKey={pauseRipple}
          />
        ) : null}

        {/* Double-tap seek flashes */}
        <AnimatePresence>
          {seekFlash ? (
            <motion.span
              key={seekFlash.key}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className={cn(
                "pointer-events-none absolute top-1/2 z-20 flex -translate-y-1/2 items-center gap-1 rounded-full bg-black/45 px-4 py-2 text-sm font-bold text-white backdrop-blur",
                seekFlash.side === "back" ? "left-[12%]" : "right-[12%]",
              )}
            >
              {seekFlash.side === "back" ? "« 10s" : "10s »"}
            </motion.span>
          ) : null}
        </AnimatePresence>

        {/* Double-tap-to-like — shared across every media surface now (owner,
            2026-08-18: "reels, feed, multi post, single post, video post
            should use one wow animation and haptic sound"). Used to be its
            own tap-position-tracked, pop-and-hold animation (a deliberate
            2026-08-16 design distinct from the rest); centering it on
            `mediaStage` instead is what "one animation" actually requires,
            and matches how Instagram's own double-tap heart reads in
            practice — centered, not pinned under the finger. */}
        <WowBurst burstKey={likeBurstKey} anchorRef={mediaStage} />
      </motion.div>

      {/* Action rail — auto-hides over the video on mobile; on lg it lives OUTSIDE
          the video in the right gutter and stays put. */}
      {/* `ui` auto-hides the rail on mobile (fades AND stops intercepting taps);
          on large screens it stays visible (`lg:!opacity-100`) AND must also stay
          clickable (`lg:!pointer-events-auto`) — without that second override the
          rail LOOKED fine but silently went dead once the 4s auto-hide timer fired
          (e.g. while reading comments), so re-opening Comment needed a fresh reel
          mount (scroll away and back, or refresh) to get a fresh `ui = true`. */}
      {/*
        ── Feature 15: ADAPTIVE ACTION RAIL™ ──────────────────────────────────
        `right` and the button gap now come from the measured device class
        instead of a fixed `right-3`/`gap-5`. The reason is reach, not style: on a
        6.7" phone held one-handed the TOP of a flush-right rail (avatar, follow)
        sits outside the comfortable thumb arc, which is the two-handed regrip
        everybody does without noticing. See `use-adaptive-rail.ts` for why the
        inset GROWS with the screen and why landscape tightens vertically instead.

        `lg:` keeps the desktop behaviour exactly as it was — the rail moves out
        into the right gutter beside the video, where reach is irrelevant because
        there is a pointer. The inline `right` is overridden there by the class,
        so this changes nothing on desktop.

        Transitioned on `railShift`, the softest spring in the system: this is the
        one movement the user did not ask for, so it should read as the interface
        settling rather than as something being yanked.
      */}
      <div
        style={{ right: rail.inset, rowGap: rail.gap }}
        className={cn(
          // `pb-11` clears the Full screen button, which sits at this same bottom
          // anchor OUTSIDE this container (it has to survive the rail being
          // hidden). Padding rather than a different `bottom` so both stay on one
          // anchor and can never drift apart.
          "absolute flex flex-col items-center pb-11 transition-[right,row-gap,opacity] duration-300 lg:!right-[-4.5rem] lg:!pointer-events-auto lg:!opacity-100",
          layer.rail,
          railBottom,
          ui ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {/*
          🔴 RAIL MATCHES THE REFERENCE IMAGE EXACTLY (owner, 2026-08-18: "make
          the reels interface, positioning, structure and design everything
          exactly from this image" — an Instagram Reels screenshot). Two real
          structural reversals from what was here before, both confirmed
          before making them:

          1. AVATAR + FOLLOW MOVED OFF THE RAIL, onto the bottom info panel
             next to the username instead (see that panel below) — the
             reference has no avatar on the rail at all. The 2026-08-16 "no
             duplicate follow button" reasoning doesn't apply here since this
             is a RELOCATION, not a second copy.

          2. REPOST SPLIT BACK OUT OF SEND (owner, confirmed via
             AskUserQuestion — this reverses a 2026-08-11 "put the reshare
             button inside the send button to avoid tray cluster" decision).
             The reference shows Repost with its own count and Send as a bare
             paper-plane with none, as two separate icons — exactly what the
             desktop comments-panel's `SidebarAct` row already did for this
             same pair (`repost`/`openShare`, a few hundred lines down); the
             mobile rail was the one place still combining them.

          The sound-thumbnail square is new too — a small square audio
          thumbnail, matching the reference. The reference's rail also had a
          hamburger (≡) "more" icon; that one was tried and reverted (owner:
          "there is already a menu at the top") since this app's existing
          top-right ••• already opens the exact same sheet, and the rail copy
          was pure duplication rather than filling a real gap. Save/Bookmark
          is gone from THIS rail to match — "Add to collection" in the •••
          sheet covers the same intent.
        */}
        <span className="relative inline-flex">
          <RailButton
            icon={myEmotion ? makeEmotionIcon(reactionGlyph(myEmotion)!) : liked ? WowSolid : WowOutline}
            active={liked}
            activeClass="text-violet-300"
            count={likes}
            label="Wow"
            onClick={(e) => {
              // 🔴 Haptic+sound on a DIRECT tap too, not just double-tap-on-
              // video (owner, 2026-08-18: "clicking the wow button directly
              // should make haptic sound too"). GlassButton (under RailButton)
              // already fires a generic "light" haptic on every click; this
              // supersedes it with the real "wow" pattern+chime double-tap
              // already gets — navigator.vibrate() calling a new pattern
              // replaces the pending one, so the two calls don't double-buzz.
              fireWowFeedback();
              if (!liked) floatReaction(e.clientX, e.clientY);
              void react("like");
            }}
            press={wowPress}
          />
          <ReactionPicker
            open={reactionsOpen}
            onClose={() => setReactionsOpen(false)}
            align="left"
            onPick={(emotion, _glyph, e) => {
              floatReaction(e.clientX, e.clientY);
              void reactWithEmotion(emotion);
            }}
          />
        </span>
        <RailButton icon={MessageCircle} count={item.commentsCount} label="Comment" onClick={openComments} />
        {/* The stacked-avatars badge (who-you-follow reposted this) is purely
            conditional social proof — it simply doesn't render when a reel has
            none, which is why the reference screenshot shows no trace of it. */}
        <div className="relative flex flex-col items-center gap-1">
          <RepostBurst triggerKey={repostBurst} />
          {item.repostBadge && item.repostBadge.count > 0 ? (
            <button
              type="button"
              onClick={() => {
                setRepostersReady(true);
                setRepostersOpen(true);
              }}
              className="flex items-center transition active:scale-95"
              aria-label={`${item.repostBadge.count} people you follow reposted this — see who`}
            >
              <span className="flex -space-x-2">
                {item.repostBadge.avatars.slice(0, 3).map((a, i) =>
                  a ? (
                    <Image key={i} src={a} alt="" width={20} height={20} className="h-5 w-5 rounded-full object-cover shadow ring-2 ring-white" />
                  ) : (
                    <span key={i} className="h-5 w-5 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 shadow ring-2 ring-white" />
                  ),
                )}
              </span>
              {item.repostBadge.count > 3 ? <span className="ml-1 text-[10px] font-bold text-white drop-shadow">+{item.repostBadge.count - 3}</span> : null}
            </button>
          ) : null}
          <RailButton icon={Repeat2} count={repostState.count} active={repostState.reposted} activeClass="text-emerald-400" label="Repost" onClick={repost} press={repostPress} />
        </div>
        {/* Plain Send, no count — a send is private by definition, counting it
            would be both meaningless and a privacy leak (unchanged reasoning
            from before the split). */}
        <RailButton icon={SendIcon} label="Send" onClick={openShare} />
        {/*
          🔴 MENU RAIL BUTTON REMOVED (owner, 2026-08-18: "remove the reels
          menu from the engagement tray, there is already a menu at the
          top"). The reference image's rail had one, but this app already has
          the top-right ••• for the same destination — a second one on the
          rail was pure duplication, not matching a real gap.
        */}
        {/*
          The sound thumbnail — a small square rather than the rail's round
          discs, matching the reference. Links to the sound's own page when
          this post carries one (Feature 15 Part 7); falls back to the
          creator's profile for the vast majority of posts that don't, same
          honesty rule the caption's own sound row already follows.

          🔴 NO `onClick={onClose}` (owner: "the sound button doesn't open the
          sound page, it just go back to feed"). The avatar Link above this
          one carries the same handler, and it raced exactly like this: a
          synchronous `onClose()` (unmounting this whole overlay, since it's
          plain React state in the parent) fired in the SAME click as the
          Link's own client-side navigation, and the unmount won — the
          overlay vanished back to the feed before `/sound/:id` ever finished
          navigating to. Removing it fixes the race; the overlay unmounts on
          its own once the route actually changes, since it lives inside the
          page it's routing away from.
        */}
        <Link
          href={item.sound ? `/sound/${item.sound.id}` : `/u/${item.publisher.handle}`}
          aria-label={item.sound ? `Sound: ${item.sound.title}` : "View profile"}
          className="mt-1 block h-8 w-8 shrink-0 overflow-hidden rounded-md ring-1 ring-white/50"
        >
          {item.thumbnailUrl ? (
            <Image src={item.thumbnailUrl} alt="" width={32} height={32} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-500 to-violet-600">
              <Music className="h-4 w-4 text-white" />
            </span>
          )}
        </Link>
      </div>

      {/*
        ── 🔴 FULL SCREEN IS AN IN-APP MODE, NOT THE FULLSCREEN API ────────────
        (owner, 2026-08-11: "the fullscreen shouldnt be a system fullscreen, it
        should be like tiktok fullscreen where users can still scroll on full
        screen, the full screen will just remove the tray but not the bottom
        nav.")

        The first version called `Element.requestFullscreen`, and that was the
        wrong tool for what was asked. The platform API takes the element out of
        the document flow into the browser's own fullscreen presentation: the
        deck's snap-scroller stops receiving the page's scroll on several
        engines, the app's bottom nav goes with it because it is OUTSIDE the
        fullscreened element, and on iOS it surrenders the clip to the native
        player entirely. Every one of those contradicts the instruction.

        "Full screen" here means what it means in a short-video app: the video
        keeps the whole screen to itself by REMOVING THE OVERLAY. Nothing about
        the document changes, so scrolling to the next reel works exactly as it
        did, and the bottom nav stays exactly where it was.

        The control lives OUTSIDE the rail because it has to survive the rail
        being hidden — it is the only way back. It sits at the rail's own bottom
        anchor and right inset so it reads as the foot of that column rather than
        as a sixth floating thing, and it is 32px against the rail's 42px: a
        viewing preference, not an engagement action.
      */}
      <button
        type="button"
        onClick={() => {
          haptic("light");
          setImmersive((v) => !v);
        }}
        aria-label={immersive ? "Show video details" : "Full screen"}
        aria-pressed={immersive}
        style={{ right: rail.inset }}
        className={cn(
          "absolute z-40 flex h-8 w-8 items-center justify-center rounded-full text-white transition active:scale-90 lg:!right-[-4.5rem]",
          // Fades but never disappears in immersive mode — a viewer who has hidden
          // the overlay still needs the one control that brings it back, and a
          // hidden exit is how someone gets stuck.
          immersive ? "bg-black/30 opacity-60 backdrop-blur-sm hover:opacity-100" : glass.primary,
          railBottom,
        )}
      >
        {immersive ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>

      {/*
        ── Feature 15: THE BOTTOM INFORMATION PANEL ───────────────────────────
        "Creator name, caption, music, sound, view more. Everything should
        collapse automatically while watching. Tapping restores it smoothly."

        Three real changes from the block this replaces.

        1. IT SITS ON AN ADAPTIVE SCRIM, not a fixed `from-black/80` gradient.
           That constant was a compromise between a night shot and a ski slope
           and was wrong for both. It now uses the same measured-luminance value
           as the top scrim, so the darkening tracks the actual frame. One
           number drives both ends of the screen — see `scrimForLuminance`.

        2. IT COLLAPSES WHEN THE CHROME HIDES. Previously an expanded caption
           stayed expanded forever: tap "More", keep watching, and a wall of text
           sat over the video for the rest of the reel. The brief asks for the
           panel to collapse automatically while watching, and the effect below
           ties `infoOpen` to `ui`, so the video wins back the screen on its own
           and a tap restores exactly what was there.

        3. THE SOUND ROW. Honest by construction — see the note on it below.

        🔴 CREATOR AVATAR + FOLLOW MOVED HERE FROM THE RAIL (2026-08-18,
        matching the reference image) — this note used to say the opposite
        ("stay on the rail... rendering two follow buttons is the less
        cluster failure"), which is now stale; see the AskUserQuestion-backed
        reasoning on that block below.

        🔴 RIGHT PADDING RESERVES THE RAIL'S OWN COLUMN (owner, 2026-08-18:
        "the caption at the bottom in reels shouldn't reach or touch the
        engagement tray on every device screen size, it should go beneath").
        This panel used to be `px-4` on both sides with no right-side
        awareness of the rail at all — the rail is a separate, absolutely
        positioned sibling, so nothing here ever measured it. `pr-20`
        (80px) comfortably clears the rail's own ~46px button width plus its
        largest adaptive inset (26px, tablet) on every tier `useAdaptiveRail`
        produces, so caption text wraps before ever reaching the rail's
        column instead of running underneath it.
      */}
      <div
        style={{ ["--reel-scrim" as string]: String(scrim) }}
        className={cn(
          "absolute inset-x-0 bottom-0 pl-4 pr-20 pt-16 transition-opacity duration-200",
          "bg-gradient-to-t from-[rgba(0,0,0,var(--reel-scrim,0.8))] via-black/30 to-transparent",
          layer.info,
          captionPad,
          ui ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {/*
          🔴 AVATAR + FOLLOW MOVED HERE FROM THE RAIL (owner, 2026-08-18,
          matching the reference image exactly). The story ring is the same
          logic the rail's copy used to carry, just smaller (32px, matching
          the reference's own proportions relative to the username line).
        */}
        <div className="flex items-center gap-2">
          <Link href={`/u/${item.publisher.handle}`} onClick={onClose} className="shrink-0">
            <span
              className={cn(
                "block rounded-full",
                item.publisherHasStory ? "bg-gradient-to-tr from-blue-500 via-violet-500 to-fuchsia-500 p-[2px]" : "p-0",
              )}
            >
              {item.publisher.avatarUrl ? (
                <Image
                  src={item.publisher.avatarUrl}
                  alt=""
                  width={32}
                  height={32}
                  className={cn("h-8 w-8 rounded-full object-cover", item.publisherHasStory ? "ring-2 ring-black/70" : "ring-2 ring-white")}
                />
              ) : (
                <span className={cn("flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-xs font-bold text-white", item.publisherHasStory ? "ring-2 ring-black/70" : "ring-2 ring-white")}>
                  {item.publisher.displayName.charAt(0).toUpperCase()}
                </span>
              )}
            </span>
          </Link>
          <Link href={`/u/${item.publisher.handle}`} onClick={onClose} className="inline-flex items-center gap-1.5 text-white">
            <span className="font-bold">@{item.publisher.handle}</span>
            {item.publisher.isVerified ? <VerifiedTick className="h-4 w-4" /> : null}
          </Link>
          {!item.isOwner ? (
            <button
              type="button"
              onClick={() => void toggleFollow()}
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition",
                following ? "border-white/30 text-white/70" : "border-white text-white",
              )}
            >
              {following ? "Following" : "Follow"}
            </button>
          ) : null}
        </div>
        {title ? (
          <p className={cn("mt-1.5 max-w-md text-sm text-white/90", !infoOpen && "line-clamp-2")}>
            <RichText text={title} linkClassName="font-semibold text-white hover:underline" />
          </p>
        ) : null}
        {/* Tapping below the caption reveals the full text + post info (date
            posted) instead of leaving the reel. */}
        <button
          type="button"
          onClick={() => setInfoOpen((v) => !v)}
          aria-expanded={infoOpen}
          className="mt-1 flex items-center gap-1 text-xs font-semibold text-white/60 transition hover:text-white/90"
        >
          {infoOpen ? "Show less" : "More"}
          <ChevronDown className={cn("h-3 w-3 transition-transform", infoOpen && "rotate-180")} />
        </button>
        {infoOpen ? (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-white/50">
            <Calendar className="h-3 w-3" /> Posted {formatPostedOn(item.createdAt)}
          </p>
        ) : null}

        {/*
          ── The sound row ─────────────────────────────────────────────────────
          Feature 15 Part 7: this is the music system the row below was always
          waiting for (see its history — a "Reality Ledger" comment used to sit
          here explaining why the label was a link to the creator rather than
          invented track data). `item.sound` is real, attached data when a post
          carries one — the row links to its own page and shows its real title
          and attribution. It is ABSENT on the vast majority of posts (attaching
          a sound is opt-in, never retroactive), so the original fallback is
          unchanged for those: "Original sound · @handle", linking to the
          creator, exactly as it always has — still true by construction, still
          never inventing a title or an artist for audio that has neither.
        */}
        <Link
          href={item.sound ? `/sound/${item.sound.id}` : `/u/${item.publisher.handle}`}
          onClick={onClose}
          className={cn(
            "mt-2 inline-flex max-w-[min(70vw,20rem)] items-center gap-2 rounded-full px-2.5 py-1",
            glass.ambient,
          )}
        >
          <Music className="h-3 w-3 shrink-0 text-white/80" aria-hidden />
          <span className="truncate text-[11px] font-semibold text-white/85">
            {item.sound ? `${item.sound.title} · ${item.sound.artistLabel}` : `Original sound · @${item.publisher.handle}`}
          </span>
        </Link>
        {/*
          ── FRIEND ENERGY™ (Feature 15 Part 3) ────────────────────────────────
          The same dataset as Social Pulse™, in the shape that costs nothing.

          Pulse is a card that fades in over the video and spends a few seconds
          of attention, so it names INDIVIDUALS and only a few of them. This line
          is static, sits in the caption, and carries the AGGREGATE — which is
          the part that stops being worth a card once there are more people than
          Pulse will name.

          🔴 So it renders only when the count EXCEEDS what Pulse already said.
          With two engaged friends Pulse names both and this would be repetition;
          with six it is the only place the six appears. `total` counts each
          person once however many ways they engaged, so "4 friends" is four
          people — see `groupFriendActivity`.

          It is plain text in document order, so a screen reader gets it with the
          caption rather than as an interruption.
        */}
        {/*
          ── SMART COMMENT PREVIEW (Feature 15 Part 3, tranche 2) ──────────────
          "Instead of always showing the latest comment, the system intelligently
          displays: friend comment, verified comment, trending comment, creator
          reply…"

          It sits in the CAPTION, not on the rail. The rail was deliberately
          shrunk two commits ago and a line of text there would undo that; the
          caption is also where a reader is already looking for words.

          🔴 The badge states WHY this comment was chosen, and it can only say
          things that are true — `reason` is produced by the same branch that
          made the pick (lib/social/reel-extras.ts), never decided here. "Top
          comment" in particular requires at least two likes, because badging a
          single like as "top" is the kind of small inflation that makes every
          other badge less believable.

          One line, clamped, and it opens the comments sheet — the preview is an
          invitation to the conversation, not a replacement for it.
        */}
        {item.commentPreview ? (
          <button
            type="button"
            onClick={openComments}
            className="mt-2 flex w-full max-w-md items-center gap-2 rounded-xl px-2 py-1.5 text-left transition active:scale-[0.99] hover:bg-white/10"
          >
            <span className="shrink-0 rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/90">
              {COMMENT_REASON_LABEL[item.commentPreview.reason]}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-white/85">
              <span className="font-semibold text-white">@{item.commentPreview.authorHandle}</span>{" "}
              {item.commentPreview.body}
            </span>
          </button>
        ) : null}

        {item.friendActivity && item.friendActivity.total > item.friendActivity.actors.length ? (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-white/70">
            <Users className="h-3 w-3 shrink-0" aria-hidden />
            {item.friendActivity.total} people you follow engaged with this
          </p>
        ) : null}

        {/*
          "Why am I seeing this?" (Part 4). Present ONLY on a reel that was
          surfaced as someone's recommendation — a reel here on its own merits
          did not need explaining, and attaching a reason to it would imply a
          recommendation that never happened.

          It sits in the caption block rather than the rail for the reason Part 3
          established: the rail was deliberately shrunk, and a line of text there
          would undo that.
        */}
        {item.repostReason ? (
          <div className="mt-2">
            <WhyThisChip reason={item.repostReason} tone="dark" />
          </div>
        ) : null}

        {item.hasPoll ? (
          <div className="mt-2 max-w-md text-white">
            <PostPollInline postId={item.id} compact />
          </div>
        ) : null}
      </div>

      {/* Comments sheet — fixed, gesture-resizable panel, mobile/tablet only
          (large screens use the persistent sidebar below instead). The reel
          behind it is frozen (the deck is scroll-locked), so scrolling to the
          bottom of the comments never jumps to the next video. The video is
          paused; a toggle lets you keep watching while you type. */}
      <div className="lg:hidden">
        <GlassSheetShell
          open={showComments}
          onClose={closeComments}
          onOpen={loadComments}
          title={`Comments${item.commentsCount > 0 ? ` · ${formatCompactNumber(item.commentsCount)}` : ""}`}
          headerExtra={
            <button
              type="button"
              onClick={toggleSheetVideo}
              aria-label={sheetVideoPaused ? "Play video" : "Pause video"}
              className="flex items-center gap-1 rounded-full bg-secondary/70 px-2.5 py-1 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
            >
              {sheetVideoPaused ? <Play className="h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5 fill-current" />}
              {sheetVideoPaused ? "Play" : "Pause"}
            </button>
          }
        >
          {loadingComments ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : comments ? (
            <>
              {item.hasPoll ? (
                <div className="mb-4">
                  <PostPollInline postId={item.id} loggedIn={comments.loggedIn} />
                </div>
              ) : null}
              <Comments
                postId={item.id}
                comments={comments.comments}
                loggedIn={comments.loggedIn}
                canComment={comments.canComment}
                disabledReason={comments.canComment ? null : "Comments are unavailable."}
                count={item.commentsCount}
                variant="sheet"
              />
            </>
          ) : null}
        </GlassSheetShell>
      </div>

      {/* Persistent comments sidebar — large screens only, active reel only (so
          mounted-but-buffering neighbours never stack a duplicate fixed panel).
          Same split-pane pattern as the image/post viewers: publisher + follow,
          caption, quick actions, then the always-visible comments list — no tap
          required. Portaled to <body>, same as the mobile sheet above. */}
      {mounted && isActive
        ? createPortal(
            <aside className="fixed inset-y-0 right-0 z-30 hidden w-[400px] flex-col overflow-y-auto border-l border-white/10 bg-card p-5 lg:flex">
              <div className="flex items-center gap-3">
                <Link href={`/u/${item.publisher.handle}`} onClick={onClose} className="shrink-0">
                  {item.publisher.avatarUrl ? (
                    <Image src={item.publisher.avatarUrl} alt="" width={44} height={44} className="h-11 w-11 rounded-full object-cover ring-1 ring-border" />
                  ) : (
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-base font-bold text-white">
                      {item.publisher.displayName.charAt(0).toUpperCase()}
                    </span>
                  )}
                </Link>
                <Link href={`/u/${item.publisher.handle}`} onClick={onClose} className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 font-semibold leading-tight">
                    <span className="truncate">{item.publisher.displayName}</span>
                    {item.publisher.isVerified ? <VerifiedTick className="h-4 w-4 shrink-0" /> : null}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">@{item.publisher.handle}</span>
                </Link>
                {!item.isOwner ? (
                  <button
                    type="button"
                    onClick={() => void toggleFollow()}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                      following ? "bg-secondary text-foreground" : "bg-gradient-to-r from-blue-600 to-violet-600 text-white",
                    )}
                  >
                    {following ? <Check className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                    {following ? "Following" : "Follow"}
                  </button>
                ) : null}
              </div>

              {title ? (
                <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed">
                  <RichText text={title} />
                </p>
              ) : null}
              <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" /> Posted {formatPostedOn(item.createdAt)}
              </p>

              <div className="mt-4 flex items-center gap-1 border-y border-border/50 py-1.5">
                <span className="relative inline-flex">
                  <SidebarAct
                    icon={myEmotion ? makeEmotionIcon(reactionGlyph(myEmotion)!) : liked ? WowSolid : WowOutline}
                    label="Wow"
                    active={liked}
                    activeClass="text-violet-500"
                    count={likes}
                    onClick={(e) => {
                      // Same direct-tap haptic+sound as the mobile rail's Wow
                      // above — SidebarAct (unlike RailButton/GlassButton) had
                      // no haptic wrapper of its own at all.
                      fireWowFeedback();
                      if (!liked) floatReaction(e.clientX, e.clientY);
                      void react("like");
                    }}
                    press={sidebarWowPress}
                  />
                  <ReactionPicker
                    open={sidebarReactionsOpen}
                    onClose={() => setSidebarReactionsOpen(false)}
                    onPick={(emotion, _glyph, e) => {
                      floatReaction(e.clientX, e.clientY);
                      void reactWithEmotion(emotion);
                    }}
                  />
                </span>
                <SidebarAct icon={Repeat2} label="Repost" active={repostState.reposted} activeClass="text-emerald-500" count={repostState.count} onClick={repost} press={repostPress} />
                <SidebarAct icon={SendIcon} label="Send" onClick={openShare} />
                <SidebarAct icon={Bookmark} label="Save" active={saved} fill={saved} activeClass="text-amber-400" onClick={() => react("save")} />
              </div>

              <h3 className="mt-4 text-sm font-bold">
                Comments{item.commentsCount > 0 ? ` · ${formatCompactNumber(item.commentsCount)}` : ""}
              </h3>
              <div className="mt-2 min-h-0 flex-1">
                {loadingComments ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : comments ? (
                  <>
                    {item.hasPoll ? (
                      <div className="mb-4">
                        <PostPollInline postId={item.id} loggedIn={comments.loggedIn} />
                      </div>
                    ) : null}
                    <Comments
                      postId={item.id}
                      comments={comments.comments}
                      loggedIn={comments.loggedIn}
                      canComment={comments.canComment}
                      disabledReason={comments.canComment ? null : "Comments are unavailable."}
                      count={item.commentsCount}
                    />
                  </>
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
                )}
              </div>
            </aside>,
            document.body,
          )
        : null}

      {/* Both sheets are DYNAMIC — see reel-sheets.tsx for the measured
          reason (they took /home 3.8 kB over its first-load budget while only
          ever appearing on a tap). */}
      <ReelMoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        isOwner={!!item.isOwner}
        publisherHandle={item.publisher.handle}
        onShare={share}
        onCopyLink={copyLink}
        onOpenInBrowser={openInBrowser}
        onViewDetails={viewDetails}
        onAddToCollection={() => {
          setMoreOpen(false);
          setPickerReady(true);
          setPickerOpen(true);
        }}
        onDownload={() => {
          setMoreOpen(false);
          // `downloadPost` is a function, not a component, so `dynamic()`
          // doesn't apply — a plain deferred import() is what keeps its
          // download-manager/analytics-event code (a few kB) out of every
          // reel's first-load JS for a tap that happens on a minority of
          // views.
          void import("@/lib/media/download-post").then((m) =>
            m.downloadPost({ id: item.id, mediaUrl: item.mediaUrl, title: title ?? undefined }),
          );
        }}
        onEditPost={() => {
          setMoreOpen(false);
          setEditReady(true);
          setEditOpen(true);
        }}
        following={following}
        onToggleFollow={() => void toggleFollow()}
        onMuteCreator={muteCreator}
        native={native}
        muted={mutedAuto}
        onToggleMute={() => {
          toggleMute();
          setMoreOpen(false);
        }}
        rate={rate}
        quickRates={QUICK_RATES}
        formatRate={formatRate}
        onPickRate={pickSpeed}
        onCycleRate={cycleSpeed}
        pipSupported={pip.supported}
        pipActive={pip.active}
        onTogglePip={() => {
          setMoreOpen(false);
          pip.toggle();
        }}
        qualityLabel={hlsUrl ? QUALITY_LABELS[qualityPref] : null}
        onCycleQuality={cycleQuality}
        onHidePost={hidePost}
        onNotInterested={notInterested}
        onReport={openReport}
        onBlock={blockUser}
      />

      {/* Save-to-collection picker */}
      {pickerReady ? <CollectionPicker postId={item.id} open={pickerOpen} onClose={() => setPickerOpen(false)} /> : null}

      {/* Repost composer — optional recommendation caption or instant Post Now */}
      {composerReady ? (
        <RepostComposer
          post={{ id: item.id, title: title ?? "", thumbnailUrl: item.thumbnailUrl, publisher: item.publisher }}
          currentCount={repostState.count}
          open={composerOpen}
          onClose={() => setComposerOpen(false)}
          onReposted={onReposted}
          mode={composerMode}
          initialCaption={composerCaption}
          audience={composerAudience}
          sourceRepostId={item.viaRepostId ?? null}
        />
      ) : null}

      {/*
        The repost destination sheet (Part 4). Reached from the Send chooser's
        Repost row AND from holding Send, so both paths land on the same
        surface — the audience, the quote composer, chat, collections and the
        link all live here rather than being scattered across two menus.

        It replaced `repost-options.tsx`, which offered three rows and no
        audience at all — that file is deleted rather than left orphaned, since
        both surfaces now open this one.
      */}
      {repostSheetReady ? (
        <RepostSheet
          postId={item.id}
          post={{ title, thumbnailUrl: item.thumbnailUrl, handle: item.publisher.handle }}
          currentCount={repostState.count}
          open={repostSheetOpen}
          onClose={() => setRepostSheetOpen(false)}
          alreadyReposted={repostState.reposted}
          sourceRepostId={item.viaRepostId ?? null}
          onReposted={onReposted}
          onQuote={(audience) => {
            setComposerAudience(audience);
            openComposer("create", null);
          }}
          onSendInChat={openShare}
          onSaveForLater={() => {
            setPickerReady(true);
            setPickerOpen(true);
          }}
        />
      ) : null}

      {/* Who reposted — behind the avatar cluster */}
      {repostersReady ? <RepostersSheet postId={item.id} open={repostersOpen} onClose={() => setRepostersOpen(false)} /> : null}

      {reportReady ? <ReportSheet targetType="post" targetId={item.id} open={reportOpen} onClose={() => setReportOpen(false)} /> : null}

      {/* Send — the same Share sheet as the feed (DMs, copy link, OS share) */}
      {shareReady ? (
        <>
          <ShareSheet
            postId={item.id}
            title={title ?? undefined}
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            onRepost={item.isOwner ? undefined : () => openComposer("create", null)}
            onQrCode={() => setQrOpen(true)}
          />
          <ShareQrSheet postId={item.id} url={`${typeof window !== "undefined" ? window.location.origin : ""}/p/${item.id}`} open={qrOpen} onClose={() => setQrOpen(false)} />
        </>
      ) : null}

      {/* Inline editor — a creator edits caption/visibility (or deletes) without
          leaving the reel. */}
      {item.isOwner && editReady ? (
        <PostEditSheet
          item={{ id: item.id, title: title ?? "" }}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={(p) => setTitle(p.title)}
          onDeleted={onClose}
        />
      ) : null}
    </>
  );
}

/**
 * The neighbor slide's poster, positioned exactly one viewport-width to the
 * side and re-derived from the SAME `dragX` the current slide's video uses —
 * so as the current video slides away under the finger, this slides into the
 * space it vacates in perfect lockstep, exactly like a real native carousel.
 * Purely a poster (no video element): swapping the real, adaptively-streamed
 * `<video>` source only happens once a slide change actually commits (see
 * `goSlide`), never mid-drag — this is what makes the live drag possible at
 * all without juggling N buffered HLS sources per reel.
 */
function AlbumNeighborPreview({
  dragX,
  direction,
  thumbnailUrl,
}: {
  dragX: MotionValue<number>;
  direction: 1 | -1;
  thumbnailUrl: string | null;
}) {
  const x = useTransform(dragX, (v) => v + direction * (typeof window !== "undefined" ? window.innerWidth : 0));
  // Same true-aspect (or, once reels-shaped, edge-to-edge crop) treatment as
  // the active card — see `isReelsShaped` above — fitted by the SAME
  // mechanism so the ground behind it doesn't visibly change shape halfway
  // through the drag.
  const [ratio, setRatio] = useState<number | null>(null);
  const tall = isReelsShaped(ratio);
  const mediaFitClassName = tall
    ? "relative z-10 h-full w-full object-cover"
    : "relative z-10 h-auto max-h-full w-auto max-w-full object-contain";
  const mediaFitStyle = tall ? undefined : ratio ? { aspectRatio: ratio } : undefined;
  if (!thumbnailUrl) return null;
  return (
    <motion.div
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", !tall && "flex items-center justify-center", LETTERBOX)}
      style={{ x }}
      aria-hidden
    >
      {!tall ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbnailUrl} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-2xl" />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbnailUrl}
        alt=""
        loading="lazy"
        decoding="async"
        style={mediaFitStyle}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth && img.naturalHeight) {
            setRatio(clampFeedRatio(img.naturalWidth, img.naturalHeight));
          }
        }}
        className={mediaFitClassName}
      />
    </motion.div>
  );
}

function RailButton({
  icon: Icon,
  count,
  active,
  fill,
  activeClass,
  label,
  onClick,
  press,
}: {
  icon: typeof Heart;
  count?: number;
  active?: boolean;
  fill?: boolean;
  activeClass?: string;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  /** Long-press handlers (from useLongPress) for buttons with a hold action. */
  press?: ReturnType<typeof useLongPress>;
}) {
  /*
    ── Feature 15: every rail control is a GlassButton, now bare ─────────────

    Delegating to one shared button means the whole rail changes together and
    cannot drift button-to-button — most recently proven when the glass disc
    itself was removed (owner, 2026-08-18, matching a reference screenshot):
    one edit to `glass-button.tsx` and all seven rail controls below went bare
    at once, rather than needing seven separate edits that could disagree.
    What every button still gets for free from that one place:

      • the adaptive ACTIVE colour, tinted from `--reel-accent`, so a liked
        button is lit by the video instead of by a hardcoded violet;
      • haptics routed through the app's shared `haptic()` vocabulary rather
        than raw `navigator.vibrate`;
      • a visible focus ring, which this never had — the rail was reachable by
        keyboard and gave no indication of where focus was.

    `countNode` keeps `AnimatedCount` — a like should tick up, not jump — which is
    the one thing the generic button does not do on its own.

    🔴 26px glyph, up from 21px (owner, 2026-08-18, once the glass disc was
    gone: "make the icon in the engagement tray to be a bit more bigger,
    bolder and more visible" — a bare icon on a busy video frame needs more
    visual weight than the same glyph used to need sitting inside a glass
    disc, which supplied its own contrast/definition. `size` (the touch
    target) grows to match rather than leaving a bigger glyph inside the
    same-diameter target it would otherwise crowd; still comfortably WCAG
    2.5.5-sized either way. `strokeWidth` bumped 2.1 -> 2.6 at the call
    below is the other half of "bolder" — a thicker line reads as more
    confident at this size than a bigger glyph with a thin stroke would.
  */
  return (
    <GlassButton
      icon={Icon}
      size={46}
      glyphClassName="h-[26px] w-[26px]"
      strokeWidth={2.6}
      label={label}
      onClick={onClick}
      active={active}
      fill={fill}
      activeClassName={activeClass}
      press={press}
      countNode={
        count !== undefined && count > 0 ? (
          <AnimatedCount
            value={count}
            className="text-[11px] font-bold tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
          />
        ) : undefined
      }
    />
  );
}

/** A light, in-panel action button for the desktop comments sidebar (RailButton's
 *  floating-glass-pill style doesn't suit a plain card background). */
function SidebarAct({
  icon: Icon,
  label,
  count,
  active,
  fill,
  activeClass,
  onClick,
  press,
}: {
  icon: typeof Heart;
  label: string;
  count?: number;
  active?: boolean;
  fill?: boolean;
  activeClass?: string;
  onClick: (e: React.MouseEvent) => void;
  /** Long-press handlers (from useLongPress) for buttons with a hold action. */
  press?: ReturnType<typeof useLongPress>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-muted-foreground transition hover:bg-secondary", active && activeClass)}
      {...press}
    >
      <Icon className={cn("h-[18px] w-[18px]", fill && "fill-current")} />
      {count !== undefined && count > 0 ? <AnimatedCount value={count} className="text-xs font-medium tabular-nums" /> : null}
    </button>
  );
}
