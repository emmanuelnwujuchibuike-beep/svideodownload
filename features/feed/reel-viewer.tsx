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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* ── Feature 15, Part 1 — the premium viewer layer ──────────────────────────
   The design language, the two adaptive systems and the reusable controls all
   live in `features/reels/viewer/`. Kept OUT of this file deliberately: this
   component was already 1,800 lines, and the brief asks for modular
   architecture and reusable components — putting a design system inside the
   consumer of that design system is how the next surface ends up with a
   copy of it. */
import { glass, layer, scrimForLuminance } from "@/features/reels/viewer/design";
import { GlassButton } from "@/features/reels/viewer/glass-button";
import { ReelProgress } from "@/features/reels/viewer/reel-progress";
import { shouldFullBleed, viewportAspect } from "@/features/reels/viewer/fit";
import { LivingPlayback } from "@/features/reels/viewer/living-playback";
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
import { Comments } from "@/features/social/comments";
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
const ReelSendSheet = dynamic(() => import("@/features/feed/reel-sheets").then((m) => m.ReelSendSheet));

import { CollectionPicker } from "@/features/social/collection-picker";
import { RepostComposer } from "@/features/social/repost-composer";
import { RepostSheet } from "@/features/social/repost/repost-sheet";
import { WhyThisChip } from "@/features/social/repost/why-this";
import { makeEmotionIcon, reactionGlyph, ReactionPicker, type ReactionEmotion } from "@/features/social/reaction-picker";
import { ReportSheet } from "@/features/social/report-sheet";
import { RepostersSheet } from "@/features/social/reposters-sheet";
import { ShareSheet } from "@/features/social/share-sheet";
import { useLongPress } from "@/lib/hooks/use-long-press";
import { PostPollInline } from "@/features/social/post-poll-inline";
import { RepostBurst } from "@/features/social/repost-burst";
import { claimPlayback, recordView, releasePlayback } from "@/lib/media/video-coordinator";
import { PostEditSheet } from "@/features/social/post-edit-sheet";
import { toast } from "@/features/ui/toast";
import { FrenzsaveError } from "@/lib/sdk";
import { muteInstant, unmuteWithFade } from "@/lib/media/audio-playback";
import { downloadPost } from "@/lib/media/download-post";
import { getQualityPreference, setQualityPreference, type QualityPreference } from "@/lib/media/network-conditions";
import { getPlaybackPosition, savePlaybackPosition } from "@/lib/media/resume-positions";
import { suppressReel } from "@/lib/social/reels-session";
import { streamHlsUrl, streamThumbnailUrl } from "@/lib/media/stream";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { loadPostComments, prefetchPostComments } from "@/lib/social/comments-cache";
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
 * ── 🔴 THE LETTERBOX IS BLACK (owner, 2026-08-11) ──────────────────────────
 *
 * "even square short videos in reels are also stretching, i said only long
 * videos."
 *
 * The FIT was already correct — `shouldFullBleed` refuses a square clip on every
 * screen, and there is a test for it. What made square clips LOOK stretched was
 * what filled the bands around them: an overscanned, blurred copy of the same
 * frame at 75% opacity. On a 9:16 clip that band is a thin sliver and reads as
 * the picture's own colour bleeding past its edge, which is what it was added
 * for. On a SQUARE clip on a 0.46 phone the bands are 54% OF THE SCREEN — so
 * most of what you see is a giant zoomed copy of the video, and the clip reads
 * as filling the screen. Exactly the thing being reported.
 *
 * That filler also has no job left. It existed to make a 9:16 clip look like it
 * reached the safe area; 9:16 now genuinely DOES reach it, by covering. The only
 * clips that still letterbox are the ones the owner wants to "show their
 * respective size", and a magnified copy of the frame is the opposite of that.
 *
 * So the ground is plain black — the classic letterbox, and the only treatment
 * under which a square video reads as a square video.
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
 * 🔴 Corrected the other direction six days later (owner, 2026-08-16: "bring
 * down this area… close to the bottom NAV just like tiktok"). The 2026-08-10
 * fix solved the RIGHT problem — the scrubber and the caption were crowding
 * each other — but it over-corrected the distance to the nav bar as a side
 * effect, leaving a dead black band between the content and the tab bar that
 * neither TikTok nor Instagram has. The gap the caption and scrubber keep
 * BETWEEN THEMSELVES (1.75rem, the exact fix from the 10th) is preserved
 * untouched here; only their shared distance FROM THE NAV shrinks.
 *
 * Measured from the true bottom edge, on mobile:
 *
 *   0            the nav's own floor (it owns `env(safe-area-inset-bottom)`)
 *   4.75rem      the top of the mobile tab bar
 *   +2rem        the tab bar's feathered scrim above itself (mobile-nav.tsx)
 *   PROGRESS     5.25rem — the scrubber, 0.5rem clear of the bar itself but
 *                          well inside the feather — which is the point: that
 *                          feather exists so bottom content stays legible
 *                          OVER it, not so content stays entirely above it.
 *   CONTENT      7rem    — caption, sound row and action rail, the same
 *                          1.75rem above the scrubber as before.
 *
 * Every one of them adds `env(safe-area-inset-bottom)` so nothing lands in the
 * home-indicator strip. The modal variant (no tab bar under it) keeps its own
 * tighter floor — these are the `page` values only.
 *
 * 🔴 These are paired with the nav scrim's height in `features/app-shell/
 * mobile-nav.tsx`: that scrim is painted at z-40 and this deck is z-30, so it
 * paints OVER anything here that shares its band. Move one, check the other.
 */
const REEL_PROGRESS_BOTTOM = "!bottom-[calc(5.25rem+env(safe-area-inset-bottom))] lg:!bottom-4";
const REEL_CONTENT_BOTTOM = "bottom-[calc(7rem+env(safe-area-inset-bottom))] lg:bottom-6";
const REEL_CONTENT_PAD = "pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-8";

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

  Labelled by what they DO, not by a resolution: a rung number is only
  meaningful if you know the ladder, and the ceiling moves with the network
  anyway. The cycle order walks from cheapest to most expensive so repeated taps
  read as one axis rather than a shuffle.
*/
const QUALITY_LABELS: Record<QualityPreference, string> = {
  auto: "Auto (recommended)",
  "data-saver": "Data saver",
  balanced: "Balanced · HD",
  high: "Highest quality",
};
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
  const scroller = useRef<HTMLDivElement | null>(null);
  const raf = useRef<number | null>(null);
  const start = Math.min(Math.max(0, startIndex), items.length - 1);
  const [active, setActive] = useState(start);
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

  useEffect(() => {
    onActiveIndexChange?.(active);
  }, [active, onActiveIndexChange]);

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
  const next1 = items[active + 1];
  const ceiling = Math.min(items.length - 1, active + (next1 && readyIds.has(next1.id) ? 3 : 2));
  const visible = items.slice(0, ceiling + 1);

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

  const onScroll = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      const el = scroller.current;
      if (!el || !el.clientHeight) return;
      const i = Math.round(el.scrollTop / el.clientHeight);
      setActive((prev) => (i !== prev && i >= 0 && i < items.length ? i : prev));
      if (i >= items.length - 3) onEndReached?.();
    });
  }, [items.length, onEndReached]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
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
        {visible.map((item, i) => (
          <section key={item.id} className="relative flex h-[100dvh] w-full snap-start snap-always justify-center bg-black lg:pr-[400px]">
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
                item={item}
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
                autoOpenComments={item.id === autoOpenCommentsId}
                variant={variant}
                onSwipeTab={onSwipeTab}
                onReady={markReady}
                initialSlide={i === start ? startSlideIndex : undefined}
              />
            </div>
          </section>
        ))}
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
  // Whether this clip fills the screen. `shouldFullBleed` owns the rule and the
  // reasoning; this is just where the answer is remembered once metadata lands.
  const [fullBleed, setFullBleed] = useState(false);
  // The same question answered EARLIER, from the poster image's natural size, so
  // the cover under the video is already the right shape before metadata
  // arrives and there is no letterbox-to-full-bleed pop on entry.
  const [posterBleed, setPosterBleed] = useState(false);
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
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<"create" | "edit">("create");
  const [composerCaption, setComposerCaption] = useState<string | null>(null);
  // The audience picked in the destination sheet, carried into the quote composer.
  const [composerAudience, setComposerAudience] = useState<RepostAudience>("public");
  const [repostSheetOpen, setRepostSheetOpen] = useState(false);
  /** Send's two-option chooser — see the note on the rail's Send control. */
  const [sendChooserOpen, setSendChooserOpen] = useState(false);
  const [repostersOpen, setRepostersOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
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
  const repostPress = useLongPress(() => setRepostSheetOpen(true));
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

  const share = async () => {
    setMoreOpen(false);
    const url = `${window.location.origin}/p/${item.id}`;
    try {
      if (navigator.share) await navigator.share({ title: item.title, url });
      else await navigator.clipboard.writeText(url);
    } catch {
      /* cancelled */
    }
    fetch(`/api/posts/${item.id}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "share" }),
    }).catch(() => {});
  };

  const toggleFollow = async () => {
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
  const repost = () => setRepostSheetOpen(true);

  const openComposer = (mode: "create" | "edit", caption: string | null) => {
    setComposerMode(mode);
    setComposerCaption(caption);
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

  // Double-tap to like: a heart blooms at the tap point; never un-likes.
  const likeBurst = (x: number, y: number) => {
    setBursts((b) => [...b.slice(-4), { id: Date.now() + Math.random(), x, y }]);
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
      // in the modal).
      if (axisLock.current === "h" && startX !== undefined) {
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
      else likeBurst(e.clientX, e.clientY); // double-tap center to like
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
      {/* Cover — always painted underneath so a snapped-in reel never flashes black.
          The clip shows at its TRUE aspect (object-contain — nothing ever cropped);
          the blurred backdrop fills whatever the letterbox leaves. */}
      {slidePoster ? (
        /*
          The cover, painted underneath so a snapped-in reel never flashes black.

          🔴 ONE layer on a black ground — see LETTERBOX for why the blurred,
          overscanned second copy is gone.

          It also fits the SAME WAY the video will: `posterBleed` runs the poster
          image's own natural size through `shouldFullBleed`, the identical rule
          the <video> uses on its metadata. Without that the cover was always
          `contain` and a 9:16 clip showed letterboxed for a moment and then
          popped to full bleed the instant metadata arrived. The poster is a
          frame OF the clip, so its shape is the clip's shape and the guess is
          exact.

          The CONTROLS stay out of the safe areas either way: the tabs, the
          close/••• buttons, the rail and the progress bar all pad themselves by
          `--frenz-safe-top` / `env(safe-area-inset-bottom)`. Only the picture
          goes under the notch and the home indicator, which is the ask.
        */
        <div className={cn("absolute inset-0", LETTERBOX)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={slidePoster}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setPosterBleed(shouldFullBleed(img.naturalWidth / img.naturalHeight, viewportAspect()));
              }
            }}
            className={cn(
              "absolute inset-0 h-full w-full",
              (fullBleed || posterBleed) ? "object-cover" : "object-contain",
            )}
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
              // TikTok-style full bleed on phones: a clip shaped close to the
              // screen COVERS it edge-to-edge (video runs under the status bar
              // and home indicator — no letterbox slivers). Clearly different
              // shapes (landscape/square) stay object-contain over the blurred
              // backdrop so nothing meaningful is cut off. Desktop keeps the
              // centered true-aspect column.
              className={cn(
                "relative z-10 h-full w-full lg:h-auto lg:max-h-full lg:w-auto lg:max-w-full lg:!object-contain",
                fullBleed ? "object-cover" : "object-contain",
              )}
              onPlay={() => {
                video.current && claimPlayback(video.current);
                setBuffering(false);
                recordView(item.id);
              }}
              onPause={() => {
                const v = video.current;
                if (v) savePlaybackPosition(playbackKey, v.currentTime, v.duration);
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
                if (v.videoWidth && v.videoHeight) {
                  /*
                    The fit rule and its whole history live in
                    features/reels/viewer/fit.ts, next to the tests that pin
                    every shape three separate owner instructions have been
                    about — including the square clip that must NOT fill.
                  */
                  setFullBleed(shouldFullBleed(v.videoWidth / v.videoHeight, viewportAspect()));
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
          <SmartVideo streamUid={item.streamUid} src={item.mediaUrl} poster={item.thumbnailUrl} controls autoPlay={isActive} loop className="relative z-10 max-h-full" />
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

        {/*
          ── Double-tap-to-like, corrected to actually read as Instagram's
          (owner, 2026-08-16: "like should animate boldly above and disappears
          just like Instagram in a premium way") ──────────────────────────────

          This used to grow continuously (0.4→1.5 scale) while drifting 46px
          upward for its whole 0.9s — that's the OTHER burst on this screen
          (`floatReaction`, the rail's own "reaction rising into the air"
          effect) wearing the double-tap's clothes. They read as the same
          animation because they nearly were.

          Instagram's heart does the opposite of floating: it POPS — overshoots
          past full size with a spring-like bounce, settles, HOLDS in place with
          no drift at all, then fades where it appeared. `feed-image.tsx` and
          `media-carousel.tsx` already have this right (their bursts don't
          drift); this bump matches their size and pop, and fixes the motion
          curve to match their held-then-fade shape instead of the rail's
          float-away one.

          `top: b.y - 18` is a fixed offset, not an animated one — just enough
          that the heart isn't centered directly under the thumb that caused it.
        */}
        {bursts.map((b) => (
          <span
            key={b.id}
            aria-hidden
            style={{ position: "fixed", left: b.x, top: b.y - 18, zIndex: 45 }}
            className="pointer-events-none -translate-x-1/2 -translate-y-1/2"
          >
            <motion.span
              initial={{ opacity: 0, scale: 0.3 }}
              animate={{ opacity: [0, 1, 1, 1, 0], scale: [0.3, 1.3, 0.92, 1.06, 1] }}
              transition={{ duration: 0.95, ease: "easeOut", times: [0, 0.28, 0.45, 0.6, 1] }}
              onAnimationComplete={() => setBursts((x) => x.filter((i) => i.id !== b.id))}
              className="block drop-shadow-[0_4px_18px_rgba(0,0,0,0.45)]"
            >
              <WowSolid className="h-24 w-24 lg:h-28 lg:w-28" />
            </motion.span>
          </span>
        ))}
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
        {/* 40px, down from 44px — it heads a rail of 42px discs, so it tracks
            them (owner: "reduce the size of the engagement tray").

            🔴 THE STORY RING (Feature 15 Part 3, tranche 2) replaces the plain
            white ring when this creator has a story that is still live. It is a
            RING, not a badge: it costs no extra space on a rail that was
            deliberately shrunk, and it is the convention people already read.

            The liveness test runs in the DATABASE (`expires_at > now`), not in
            JS — a story that expires between the query and the render would
            otherwise draw a ring that opens nothing, which is the phantom-ring
            bug the story cache already documents. */}
        <Link href={`/u/${item.publisher.handle}`} onClick={onClose} className="relative mb-1">
          <span
            className={cn(
              "block rounded-full",
              item.publisherHasStory
                ? "bg-gradient-to-tr from-blue-500 via-violet-500 to-fuchsia-500 p-[2px]"
                : "p-0",
            )}
          >
            {item.publisher.avatarUrl ? (
              <Image
                src={item.publisher.avatarUrl}
                alt=""
                width={40}
                height={40}
                className={cn("h-10 w-10 rounded-full object-cover", item.publisherHasStory ? "ring-2 ring-black/70" : "ring-2 ring-white")}
              />
            ) : (
              <span className={cn("flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold text-white", item.publisherHasStory ? "ring-2 ring-black/70" : "ring-2 ring-white")}>
                {item.publisher.displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
          {!item.isOwner && !following ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                void toggleFollow();
              }}
              aria-label="Follow"
              className="absolute -bottom-2 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full bg-rose-500 text-white"
            >
              <UserPlus className="h-3 w-3" />
            </button>
          ) : null}
        </Link>

        {/* Refined action stack: Like · Comment · Repost · Save · More. Share and
            everything else live in the premium overflow sheet. */}
        <span className="relative inline-flex">
          <RailButton
            icon={myEmotion ? makeEmotionIcon(reactionGlyph(myEmotion)!) : liked ? WowSolid : WowOutline}
            active={liked}
            activeClass="text-violet-300"
            count={likes}
            label="Wow"
            onClick={(e) => {
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
        {/*
          ── 🔴 REPOST MOVED INSIDE SEND (owner, 2026-08-11) ───────────────────
          "put the reshare button inside the send button to avoid tray cluster,
          so when a user click the send button two options show."

          Repost and Send are the same intent — "put this in front of someone
          else" — separated only by audience: your own followers, or specific
          people. Two adjacent rail buttons for one intent is what made the tray
          read as a wall, and it is the pair a viewer is least likely to tell
          apart at a glance from two similar glyphs.

          Send now opens a two-option chooser first. The REPOST BADGE (the
          stacked avatars of people you follow who reposted this) stays on the
          rail as its own affordance, because it is not an action — it is social
          proof, and tapping it opens "who reposted", which has nothing to do
          with sending. The burst animation stays anchored here too so a repost
          still pops where the badge lives.

          The long-press-for-repost-options gesture moves onto the Send button,
          so nothing that existed is lost — it is reached from the control that
          now owns reposting.
        */}
        <div className="relative flex flex-col items-center gap-1">
          <RepostBurst triggerKey={repostBurst} />
          {item.repostBadge && item.repostBadge.count > 0 ? (
            <button
              type="button"
              onClick={() => setRepostersOpen(true)}
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
          <RailButton
            icon={SendIcon}
            // The count on this control is the REPOST count, because that is the
            // only one of the two that produces a public, countable object. A
            // send is private by definition and counting it would be both
            // meaningless and a privacy leak.
            count={repostState.count}
            active={repostState.reposted}
            activeClass="text-emerald-400"
            label="Send or repost"
            onClick={() => setSendChooserOpen(true)}
            press={repostPress}
          />
        </div>
        <RailButton icon={Bookmark} active={saved} fill={saved} activeClass="text-amber-400" label="Save" onClick={() => react("save")} />

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

        The creator AVATAR and FOLLOW button stay on the action rail rather than
        being duplicated here. The brief lists them under both, but rendering two
        follow buttons on one screen is the "less cluster" failure, and the rail's
        is the one that is already in the thumb's reach.
      */}
      <div
        style={{ ["--reel-scrim" as string]: String(scrim) }}
        className={cn(
          "absolute inset-x-0 bottom-0 px-4 pt-16 transition-opacity duration-200",
          "bg-gradient-to-t from-[rgba(0,0,0,var(--reel-scrim,0.8))] via-black/30 to-transparent",
          layer.info,
          captionPad,
          ui ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <Link href={`/u/${item.publisher.handle}`} onClick={onClose} className="inline-flex items-center gap-1.5 text-white">
          <span className="font-bold">@{item.publisher.handle}</span>
          {item.publisher.isVerified ? <VerifiedTick className="h-4 w-4" /> : null}
        </Link>
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
          🔴 "Original sound · @handle" is TRUE BY CONSTRUCTION here, not a
          placeholder dressed up as data.

          `FeedItem` carries no music or attribution field, and this project has
          no licensing or track system at all — so every reel on Frenzsave plays
          the audio that arrived with its own video. For a post by @handle, "the
          original sound of @handle's post" is a factual description of what you
          are hearing, which is exactly what the label says.

          What it deliberately does NOT do is invent a track title, an artist, or
          a "trending sound" count — the fabrications this row invites, and the
          kind the Reality Ledger fails the build on.

          It is a LINK to the creator, because that is the only real destination
          the sound has today. When a music system exists, this becomes the sound
          page and the label becomes data — the row is already the right shape.
        */}
        <Link
          href={`/u/${item.publisher.handle}`}
          onClick={onClose}
          className={cn(
            "mt-2 inline-flex max-w-[min(70vw,20rem)] items-center gap-2 rounded-full px-2.5 py-1",
            glass.ambient,
          )}
        >
          <Music className="h-3 w-3 shrink-0 text-white/80" aria-hidden />
          <span className="truncate text-[11px] font-semibold text-white/85">
            Original sound · @{item.publisher.handle}
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

      {/* Comments sheet — fixed half-height panel, mobile/tablet only (large
          screens use the persistent sidebar below instead). The reel behind it
          is frozen (the deck is scroll-locked), so scrolling to the bottom of
          the comments never jumps to the next video. The video is paused; a
          toggle lets you keep watching while you type. */}
      {mounted ? createPortal(
      <AnimatePresence>
        {showComments ? (
          <div className="lg:hidden">
            {/* Portaled to <body> + fixed so it sits above the bottom nav. */}
            <button type="button" aria-label="Close comments" onClick={closeComments} className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-[2px]" />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
              className="fixed inset-x-0 bottom-0 z-[95] mx-auto flex h-[68vh] max-w-2xl flex-col rounded-t-3xl border-t border-white/10 bg-card/95 shadow-[0_-8px_40px_rgba(0,0,0,0.35)] backdrop-blur-2xl"
              onAnimationStart={loadComments}
            >
              {/* Grabber + controls */}
              <div className="shrink-0 px-5 pt-3">
                <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" />
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold">
                    Comments{item.commentsCount > 0 ? ` · ${formatCompactNumber(item.commentsCount)}` : ""}
                  </h3>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={toggleSheetVideo}
                      aria-label={sheetVideoPaused ? "Play video" : "Pause video"}
                      className="flex items-center gap-1 rounded-full bg-secondary/70 px-2.5 py-1 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
                    >
                      {sheetVideoPaused ? <Play className="h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5 fill-current" />}
                      {sheetVideoPaused ? "Play" : "Pause"}
                    </button>
                    <button type="button" onClick={closeComments} aria-label="Close comments" className="rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Scrollable list — contained so its scroll never chains out */}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-1">
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
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>,
      document.body,
    ) : null}

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
                <SidebarAct icon={SendIcon} label="Send" onClick={() => setShareOpen(true)} />
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
          setPickerOpen(true);
        }}
        onDownload={() => {
          setMoreOpen(false);
          void downloadPost({ id: item.id, mediaUrl: item.mediaUrl, title: title ?? undefined });
        }}
        onEditPost={() => {
          setMoreOpen(false);
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

      <ReelSendSheet
        open={sendChooserOpen}
        onClose={() => setSendChooserOpen(false)}
        reposted={repostState.reposted}
        onSendToFriends={() => {
          setSendChooserOpen(false);
          setShareOpen(true);
        }}
        onRepost={() => {
          setSendChooserOpen(false);
          repost();
        }}
      />

      {/* Save-to-collection picker */}
      <CollectionPicker postId={item.id} open={pickerOpen} onClose={() => setPickerOpen(false)} />

      {/* Repost composer — optional recommendation caption or instant Post Now */}
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

      {/*
        The repost destination sheet (Part 4). Reached from the Send chooser's
        Repost row AND from holding Send, so both paths land on the same
        surface — the audience, the quote composer, chat, collections and the
        link all live here rather than being scattered across two menus.

        It replaced `repost-options.tsx`, which offered three rows and no
        audience at all — that file is deleted rather than left orphaned, since
        both surfaces now open this one.
      */}
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
        onSendInChat={() => setShareOpen(true)}
        onSaveForLater={() => setPickerOpen(true)}
      />

      {/* Who reposted — behind the avatar cluster */}
      <RepostersSheet postId={item.id} open={repostersOpen} onClose={() => setRepostersOpen(false)} />

      <ReportSheet targetType="post" targetId={item.id} open={reportOpen} onClose={() => setReportOpen(false)} />

      {/* Send — the same Share sheet as the feed (DMs, copy link, OS share) */}
      <ShareSheet
        postId={item.id}
        title={title ?? undefined}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        onRepost={item.isOwner ? undefined : () => openComposer("create", null)}
      />

      {/* Inline editor — a creator edits caption/visibility (or deletes) without
          leaving the reel. */}
      {item.isOwner ? (
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
  // Fitted by the SAME rule as the active card, from the poster's own natural
  // size — a neighbour that letterboxes differently makes the ground behind the
  // video visibly change halfway through the drag.
  const [bleed, setBleed] = useState(false);
  if (!thumbnailUrl) return null;
  return (
    <motion.div className={cn("pointer-events-none absolute inset-0", LETTERBOX)} style={{ x }} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbnailUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth && img.naturalHeight) {
            setBleed(shouldFullBleed(img.naturalWidth / img.naturalHeight, viewportAspect()));
          }
        }}
        className={cn("absolute inset-0 h-full w-full", bleed ? "object-cover" : "object-contain")}
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
    ── Feature 15: every rail control is now a GlassButton ────────────────────

    This kept its own copy of the glass recipe, its own spring and its own press
    scale, which is exactly how a "design system" ends up being nine buttons that
    each look nearly right. Delegating means the rail inherits, for free and
    identically everywhere:

      • the ONE glass recipe from design.ts (blur + tint + ring together — blur
        alone does not guarantee contrast, because a blurred white shirt is
        still white);
      • the adaptive ACTIVE colour, tinted from `--reel-accent`, so a liked
        button is lit by the video instead of by a hardcoded violet;
      • the ripple, the soft glow, and haptics routed through the app's shared
        `haptic()` vocabulary rather than raw `navigator.vibrate`;
      • a visible focus ring, which this never had — the rail was reachable by
        keyboard and gave no indication of where focus was.

    Every call site is unchanged: this signature is kept exactly as it was, so
    the nine buttons below did not need touching and cannot drift from each other.

    `countNode` keeps `AnimatedCount` — a like should tick up, not jump — which is
    the one thing the generic button does not do on its own.

    🔴 42px, not 48px (owner, 2026-08-10: "reduce the size of the engagement
    tray"). Five 48px discs plus their counts plus the avatar made the rail about
    450px of a 851px screen — over half the height of the video, on the side of
    the frame where the subject usually is. 42px with a 21px glyph keeps it well
    clear of the 44px minimum touch target (WCAG 2.5.5 measures the TARGET, and
    the button's own tap area is the disc plus the count beneath it, ~56px tall)
    while giving roughly 60px back to the picture.
  */
  return (
    <GlassButton
      icon={Icon}
      size={42}
      glyphClassName="h-[21px] w-[21px]"
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
