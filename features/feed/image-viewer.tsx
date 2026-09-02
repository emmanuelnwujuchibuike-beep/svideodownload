"use client";

import {
  AnimatePresence,
  motion } from "framer-motion";
import {
  BadgeCheck,
  Ban,
  BellOff,
  Bookmark,
  Calendar,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  EyeOff,
  Flag,
  FolderPlus,
  Heart,
  Info,
  Link2,
  MessageCircle,
  MoreVertical,
  Pencil,
  Share2,
  UserPlus,
  UserX,
  X,
} from "lucide-react";
import { VerifiedTick } from "@/components/badges/identity-badges";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { WowOutline, WowSolid } from "@/components/brand/wow-icon";
import { RichText } from "@/components/social/rich-text";
import { AnimatedCount } from "@/features/ui/animated-count";
import { floatReaction } from "@/features/ui/reaction-float";
import { Comments } from "@/features/social/comments";
import { GlassSheetShell } from "@/features/ui/glass-sheet-shell";
import { toast } from "@/features/ui/toast";

// Code-split, each gated behind its own "ready" flag below (never mounted
// until the corresponding action is actually tapped) — static imports here
// put every one of these sheets' full weight into every route that renders
// this viewer, including /(app)/home via smart-feed. CollectionPicker and
// PostEditSheet already had ready-gated CONDITIONAL RENDERING (pickerReady/
// editReady below) — that only controls when the JSX mounts, not when the
// module is bundled, so a static import still shipped the code regardless.
const ShareSheet = dynamic(() => import("@/features/social/share-sheet").then((m) => m.ShareSheet), { ssr: false });
const ShareQrSheet = dynamic(() => import("@/features/social/share-qr-sheet").then((m) => m.ShareQrSheet), { ssr: false });
const CollectionPicker = dynamic(() => import("@/features/social/collection-picker").then((m) => m.CollectionPicker), { ssr: false });
const PostEditSheet = dynamic(() => import("@/features/social/post-edit-sheet").then((m) => m.PostEditSheet), { ssr: false });
const ReportSheet = dynamic(() => import("@/features/social/report-sheet").then((m) => m.ReportSheet), { ssr: false });
import { downloadPost } from "@/lib/media/download-post";
import { clampFeedRatio, isReelsShaped } from "@/lib/media/aspect";
import { claimPlayback, releasePlayback, suspendPlayback } from "@/lib/media/video-coordinator";
import { toggleFollow as toggleFollowShared, useFollowState } from "@/lib/social/follow-store";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { loadPostComments, prefetchPostComments } from "@/lib/social/comments-cache";
import type { CommentNode } from "@/lib/social/engagement";
import type { FeedItem } from "@/lib/social/home-feed";
import { cn, formatCompactNumber, formatPostedOn } from "@/lib/utils";
import { allowWindowOpen } from "@/lib/monetization/popunder-guard";

interface CommentsData {
  comments: CommentNode[];
  canComment: boolean;
  loggedIn: boolean;
}

/**
 * Full-screen, immersive image viewer — opens when a photo post is tapped and
 * closes like X / Instagram (tap the backdrop, the X, Escape, or swipe down).
 * Double-tap to like. Actions + caption overlay the image and auto-hide; a
 * comments sheet slides up on demand. Portaled to <body> so it sits above nav.
 */
export function ImageViewer({
  item,
  startIndex = 0,
  autoOpenComments,
  onClose,
}: {
  item: FeedItem | null;
  /** Which slide of an album was actually tapped — not always the first. */
  startIndex?: number;
  /** Open straight into the comments sheet — a feed "Comment" tap should land
   *  in the conversation, not just on the media. */
  autoOpenComments?: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {item ? (
        <ImageStage
          key={item.id}
          item={item}
          startIndex={startIndex}
          autoOpenComments={autoOpenComments}
          onClose={onClose}
        />
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function ImageStage({
  item,
  startIndex = 0,
  autoOpenComments,
  onClose,
}: {
  item: FeedItem;
  startIndex?: number;
  autoOpenComments?: boolean;
  onClose: () => void;
}) {
  const src = item.mediaUrl || item.thumbnailUrl || "";
  // This viewer mounts ON TOP of the still-mounted feed (which is only
  // covered, never unmounted, behind it) — its own IntersectionObserver still
  // geometrically sees itself "in view" and would otherwise stay eligible to
  // resume. Suspending the whole session immediately pauses whatever was
  // playing underneath and keeps the feed quiet for as long as this is open.
  //
  // A LAYOUT effect, not a passive one: layout effects for the whole tree
  // complete before ANY passive effect runs, so this is guaranteed to pause
  // the outgoing feed video before AlbumSwipe's own (passive) autoplay effect
  // below gets a chance to claim playback for the newly-opened slide — a
  // plain useEffect here raced the two and could pause this viewer's own
  // video moments after it started, since child effects run before a
  // parent's.
  useLayoutEffect(() => suspendPlayback(), []);
  // An album (>1 item) swipes through every photo/video right here in
  // fullscreen, opening on the EXACT slide that was tapped.
  const albumItems = item.mediaItems && item.mediaItems.length > 1 ? item.mediaItems : null;
  const [slide, setSlide] = useState(() => Math.max(0, Math.min((albumItems?.length ?? 1) - 1, startIndex)));
  const [ui, setUi] = useState(true);
  const [liked, setLiked] = useState(item.viewerLiked);
  const [saved, setSaved] = useState(item.viewerSaved);
  const [likes, setLikes] = useState(item.likesCount);
  const following = useFollowState(item.publisher.id, item.isFollowing);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<CommentsData | null>(null);
  // Tapping below the caption reveals the full (unclamped) text plus post info
  // — currently the date posted — instead of opening the comments sheet.
  const [infoOpen, setInfoOpen] = useState(false);
  const [burst, setBurst] = useState<{ x: number; y: number; key: number } | null>(null);
  const [title, setTitle] = useState(item.title);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReady, setReportReady] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerReady, setPickerReady] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editReady, setEditReady] = useState(false);
  const lastTap = useRef(0);
  /*
    ── DRAG-DOWN-TO-DISMISS, THE WALLPAPER-REELS WAY (owner, 2026-08-17: "the
    drag down also doesnt work… i just want the drag down and view should be
    like wallpaper reels… make the drag down and image fixed of the
    wallpaper reel to be in the image viewer and multiple post") ───────────

    The PREVIOUS version had two independent, differently-written dismiss
    systems — one here (Pointer Events, `startY`/`onImgPointerUp`) for a
    single photo, a completely separate one in `AlbumSwipe` (Pointer Events,
    `startPt`/`maybeDismiss`) for an album — plus this component's own X-axis
    horizontal scroll underneath the album's version. Two systems for one
    gesture is exactly the kind of thing that silently fights itself, which
    is the most likely reading of "the drag down also doesnt work."

    `wallpaper-reels.tsx` has exactly ONE implementation of this gesture and
    it demonstrably works, so it's reused verbatim rather than reinvented a
    third time: real `touchstart`/`touchmove`/`touchend` (not Pointer
    Events), a damped `dragY` that tracks the finger 1:1 at first and eases
    off (`dy * 0.6`, capped at 260px) so it reads as resistance rather than a
    free fall, applied as a `transform: translateY(...) scale(...)` on the
    WHOLE viewer (not just the media) so the caption/rail move with it too —
    that's the "image fixed" part of the ask: everything drags together as
    one rigid sheet, nothing lags or drifts independently.

    Lives at THIS level (not inside AlbumSwipe) so there is exactly one
    source of truth regardless of whether the open item is a single photo or
    an album — `AlbumSwipe` below no longer has any dismiss logic of its own
    at all, only its native horizontal scroll and tap/double-tap.

    Armed by axis, not by scroll position (wallpaper-reels arms only at
    `scrollTop === 0` because ITS conflict is with vertical native scroll;
    this viewer's conflict is with AlbumSwipe's HORIZONTAL native scroll
    instead) — the first ~10px of movement is left unclassified, then a
    clearly-vertical, clearly-downward drag commits to `dragY`; anything
    more horizontal, or upward, is released back to the album's own native
    pan-x scroll and never revisited for the rest of that touch.
  */
  const DISMISS_PX = 110;
  const [dragY, setDragY] = useState(0);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const dragCommitted = useRef(false);
  const onViewerTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      dragFrom.current = null;
      return;
    }
    const t = e.touches[0]!;
    dragFrom.current = { x: t.clientX, y: t.clientY };
    dragCommitted.current = false;
  };
  const onViewerTouchMove = (e: React.TouchEvent) => {
    const from = dragFrom.current;
    if (!from) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - from.x;
    const dy = t.clientY - from.y;
    if (!dragCommitted.current) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (dy <= 0 || Math.abs(dy) <= Math.abs(dx)) {
        dragFrom.current = null; // horizontal, or upward — not a dismiss drag
        return;
      }
      dragCommitted.current = true;
    }
    setDragY(Math.min(dy * 0.6, 260));
  };
  const onViewerTouchEnd = () => {
    dragFrom.current = null;
    if (!dragCommitted.current) return;
    dragCommitted.current = false;
    setDragY((y) => {
      if (y > DISMISS_PX) {
        haptic("light");
        onClose();
      }
      return 0;
    });
  };
  // The photo's true aspect ratio — seeded from the server's stored
  // dimensions (so the box is already the right shape before a single byte
  // of the full-res image has loaded) and refined once the actual `<img>`
  // reports its natural size. Every OTHER media surface in this codebase
  // (feed-image, feed-video, reel-viewer) already does this; this single-
  // photo branch never did, which is the concrete gap behind the owner's
  // 2026-08-17 report that a fullscreen photo "is not full screen" — without
  // an explicit box shape, the `<img>` had nothing to size itself against
  // until it finished decoding, and no `object-contain`/backdrop treatment
  // to fall back on in the meantime.
  const [measuredRatio, setMeasuredRatio] = useState<number | null>(null);
  const seedRatio = clampFeedRatio(item.mediaWidth, item.mediaHeight);
  const ratio = measuredRatio ?? seedRatio;
  /*
    🔴 THE ONE EXCEPTION TO NEVER-CROP (owner, 2026-08-17): "16:9 should
    reach full edge to edge, it can crop a little if necessary to reach
    there but image size below 16:9 shouldnt crop… should stay full screen
    with bottom nav." See `isReelsShaped` in lib/media/aspect.ts for the full
    reasoning — only media at or beyond standard reels tallness (9:16 and
    taller/narrower) gets the `wallpaper-reels.tsx`-style `object-cover`
    treatment; everything else keeps the never-crop `object-contain` +
    blurred backdrop exactly as shipped earlier the same day.
  */
  const tall = isReelsShaped(ratio);
  const mediaFitClassName = tall
    ? "h-full w-full select-none object-cover"
    : "h-auto max-h-full w-auto max-w-full select-none object-contain";
  const mediaFitStyle = tall ? undefined : ratio ? { aspectRatio: ratio } : undefined;

  useEffect(() => {
    // overflowY only (not the `overflow` shorthand) — the shorthand also resets
    // overflow-x, undoing the `overflow-x: clip` on <body> that keeps the app
    // sidebar sticky (it would otherwise scroll away and leave empty space).
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    prefetchPostComments(item.id);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflowY = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [item.id, onClose]);

  const react = async (type: "like" | "save") => {
    const isLike = type === "like";
    const cur = isLike ? liked : saved;
    const next = !cur;
    if (isLike) {
      setLiked(next);
      setLikes((n) => n + (next ? 1 : -1));
    } else setSaved(next);
    try {
      const r = await fetch(`/api/posts/${item.id}/react`, {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!r.ok) throw new Error();
    } catch {
      if (isLike) {
        setLiked(cur);
        setLikes((n) => n + (next ? -1 : 1));
      } else setSaved(cur);
    }
  };

  const likeBurst = (x: number, y: number) => {
    setBurst({ x, y, key: Date.now() });
    if (!liked) void react("like");
  };

  const onImgPointerUp = (e: React.PointerEvent) => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      likeBurst(e.clientX, e.clientY);
    } else {
      lastTap.current = now;
      setTimeout(() => {
        if (lastTap.current && Date.now() - lastTap.current >= 280) setUi((v) => !v);
      }, 290);
    }
  };

  // Part 6: the real Share sheet (DMs/groups + copy link + OS share + QR),
  // replacing a bare navigator.share()/clipboard-copy fork that never
  // recorded WHO a post was shared with (only a raw counter bump). No repost
  // affordance exists in this viewer today (confirmed — grepped for any
  // repost/reshare mechanism here, none), so `onRepost` is simply omitted.
  const [shareOpen, setShareOpen] = useState(false);
  const [shareReady, setShareReady] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const share = () => {
    setShareReady(true);
    setShareOpen(true);
  };

  // ── Overflow (•••) actions — same set reels/the app already offer. ──────────
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
    allowWindowOpen();
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
  // a block) this viewer stays open since you're already looking at it.
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
  const hidePost = () => {
    setMoreOpen(false);
    toast("We'll show less like this.", "info");
    onClose();
  };

  const openComments = useCallback(async () => {
    setShowComments(true);
    if (!comments) {
      const data = await loadPostComments<CommentsData>(item.id);
      if (data) setComments(data);
    }
  }, [comments, item.id]);

  // A feed "Comment" tap lands straight in the conversation, not just on the
  // media — only ever fires once, right when this specific image is opened.
  useEffect(() => {
    if (autoOpenComments) void openComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On large screens comments live in a persistent side panel (see below), not
  // the tap-to-open sheet — so load them eagerly. Cheap: `prefetchPostComments`
  // above already warmed the cache, this just reads it.
  useEffect(() => {
    void loadPostComments<CommentsData>(item.id).then((data) => {
      if (data) setComments(data);
    });
  }, [item.id]);

  const toggleFollow = () => void toggleFollowShared(item.publisher.id, !following);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // Snappier than the original 0.2s — since the fallback preview above
      // already paints the same photo instantly, this fade is really just
      // covering the handoff to the interactive chrome, not "revealing" the
      // image itself, so it can be much shorter without feeling abrupt.
      transition={{ duration: 0.1 }}
      // On large screens this sits BESIDE the app sidebar (which stays fixed,
      // same as every other page) and splits into media + a persistent comments
      // sidebar — same split-pane pattern as PostViewer.
      data-media-protected
      className="fixed inset-0 z-[85] flex bg-black lg:left-64"
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      onTouchStart={onViewerTouchStart}
      onTouchMove={onViewerTouchMove}
      onTouchEnd={onViewerTouchEnd}
      style={{
        transform: dragY ? `translateY(${dragY}px) scale(${1 - Math.min(dragY / 2200, 0.06)})` : undefined,
        // No transition WHILE dragging (must track the finger exactly), one
        // on release so it springs back instead of snapping — same recipe as
        // wallpaper-reels.tsx.
        transition: dragY ? "none" : "transform 220ms var(--ease-out)",
        borderRadius: dragY ? "1.5rem" : undefined,
        overflow: dragY ? "hidden" : undefined,
      }}
    >
      {/* `lg:pr-24` reserves a real gutter on large screens so the action rail
          (below) never overlaps the comments sidebar — mirrors the reel
          viewer's column-vs-gutter split, just via padding since a single
          image (unlike the reel's height-capped column) has no natural gap of
          its own. Absolute children position relative to this padding box, so
          the image/caption also recenter within the narrower space. */}
      <div className="relative h-full flex-1 lg:pr-24">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute left-4 top-[max(1rem,var(--frenz-safe-top))] z-[60] flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition hover:bg-black/60 active:scale-95">
          <X className="h-5 w-5" />
        </button>

        {/* Options — top-right, mirroring the close (X) button at top-left,
            same as reels. Always visible (not gated by `ui`). */}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="More options"
          className="absolute right-4 top-[max(1rem,var(--frenz-safe-top))] z-[60] flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition hover:bg-black/60 active:scale-95"
        >
          <MoreVertical className="h-5 w-5" />
        </button>

        {/* Media — swipe down to dismiss (X/IG style); an album also swipes
            sideways through every photo/video, opening on the exact slide
            that was tapped in the feed's carousel, never always the first. */}
        {albumItems ? (
          <AlbumSwipe
            items={albumItems}
            startIndex={slide}
            onIndexChange={setSlide}
            onTap={() => setUi((v) => !v)}
            onDoubleTap={likeBurst}
          />
        ) : (
          <div
            className={cn("absolute inset-0", !tall && "flex items-center justify-center")}
            // Drag-to-dismiss lives on the OUTER wrapper now (see the note
            // there) — this element only ever needs to recognise a tap /
            // double-tap, never its own gesture-vs-scroll disambiguation.
            onPointerUp={onImgPointerUp}
          >
            {/* Below reels-tallness: always object-contain — the WHOLE
                picture, never cropped. At or beyond reels-tallness: fills
                edge to edge via object-cover, same as wallpaper-reels.tsx —
                see `tall`/`isReelsShaped` above. `aspectRatio` (seeded from
                stored dims, refined on load) gives the contained case a
                definite shape from the first paint instead of waiting on
                decode. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={title}
              style={mediaFitStyle}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (measuredRatio === null && img.naturalWidth && img.naturalHeight) {
                  setMeasuredRatio(clampFeedRatio(img.naturalWidth, img.naturalHeight));
                }
              }}
              className={mediaFitClassName}
              draggable={false}
            />
            {/* Blurred fill behind the letterbox — only meaningful when
                there's letterbox space left to fill; a reels-shaped photo
                above already covers the box completely on its own. 70%, not
                30% (owner, 2026-08-17, with a screenshot: the letterbox
                still read as flat black rather than an obvious blur). */}
            {!tall ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" aria-hidden className="pointer-events-none absolute inset-0 -z-10 h-full w-full scale-110 object-cover opacity-70 blur-2xl" />
            ) : null}
          </div>
        )}

        {/* Double-tap heart */}
        <AnimatePresence>
          {burst ? (
            <motion.span
              key={burst.key}
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.3, 1.1, 1.5] }}
              transition={{ duration: 0.9, ease: "easeOut", times: [0, 0.2, 0.6, 1] }}
              onAnimationComplete={() => setBurst(null)}
              style={{ position: "fixed", left: burst.x, top: burst.y, zIndex: 50 }}
              className="pointer-events-none -translate-x-1/2 -translate-y-1/2"
            >
              <WowSolid className="h-16 w-16" />
            </motion.span>
          ) : null}
        </AnimatePresence>

        {/* Caption + author (auto-hides) — the sidebar repeats this statically on
            lg, so it's redundant there but harmless (mask lets it fade the same). */}
        <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-16 transition-opacity duration-200", ui ? "opacity-100" : "opacity-0")}>
          <Link href={`/u/${item.publisher.handle}`} onClick={onClose} className="pointer-events-auto inline-flex items-center gap-1.5 font-bold text-white">
            @{item.publisher.handle}
          </Link>
          {title ? (
            <p className={cn("mt-1.5 max-w-xl text-sm text-white/90", !infoOpen && "line-clamp-3")}>
              <RichText text={title} linkClassName="font-semibold text-white hover:underline" />
            </p>
          ) : null}
          {/* Tapping below the caption reveals the full text + post info (date
              posted) instead of just fading in place. */}
          <button
            type="button"
            onClick={() => setInfoOpen((v) => !v)}
            className="pointer-events-auto mt-1 flex items-center gap-1 text-xs font-semibold text-white/60 transition hover:text-white/90"
          >
            {infoOpen ? "Show less" : "More"}
            <ChevronDown className={cn("h-3 w-3 transition-transform", infoOpen && "rotate-180")} />
          </button>
          {infoOpen ? (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-white/50">
              <Calendar className="h-3 w-3" /> Posted {formatPostedOn(item.createdAt)}
            </p>
          ) : null}
        </div>

        {/* Action rail (auto-hides on mobile; stays visible AND clickable on lg —
            `lg:!pointer-events-auto` alongside `lg:!opacity-100`, so it can never go
            silently dead the way the reels rail once did). The `lg:pr-24` on the
            parent already reserves its gutter, so a plain `right-3` (no escape
            offset needed) lands cleanly between the image and the comments
            sidebar instead of overlapping it. */}
        <div className={cn("absolute bottom-24 right-3 z-30 flex flex-col items-center gap-5 transition-opacity duration-200 sm:bottom-8 lg:!pointer-events-auto lg:!opacity-100", ui ? "opacity-100" : "pointer-events-none opacity-0")}>
          <RailBtn
            icon={liked ? WowSolid : WowOutline}
            active={liked}
            activeClass="text-violet-300"
            count={likes}
            label="Wow"
            onClick={(e) => {
              if (!liked) floatReaction(e.clientX, e.clientY);
              void react("like");
            }}
          />
          <RailBtn icon={MessageCircle} count={item.commentsCount} label="Comments" onClick={openComments} />
          <RailBtn icon={Share2} count={item.sharesCount} label="Share" onClick={share} />
          <RailBtn icon={Bookmark} active={saved} fill={saved} activeClass="text-amber-400" label="Save" onClick={() => react("save")} />
        </div>

        {/* Comments sheet — mobile/tablet only; large screens use the persistent
            sidebar instead. */}
        <div className="lg:hidden">
          <GlassSheetShell
            open={showComments}
            onClose={() => setShowComments(false)}
            title={`Comments${item.commentsCount > 0 ? ` · ${formatCompactNumber(item.commentsCount)}` : ""}`}
          >
            {comments ? (
              <Comments postId={item.id} comments={comments.comments} loggedIn={comments.loggedIn} canComment={comments.canComment} disabledReason={comments.canComment ? null : "Comments are unavailable."} count={item.commentsCount} variant="sheet" />
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
            )}
          </GlassSheetShell>
        </div>
      </div>

      {/* Persistent comments sidebar — large screens only. Publisher + caption +
          quick actions repeated statically (the overlaid versions above still
          work but auto-hide/aren't discoverable at a glance in a side-panel
          context), then the comments list — always visible, no tap required. */}
      <aside className="hidden w-[400px] shrink-0 flex-col overflow-y-auto border-l border-white/10 bg-card p-5 lg:flex">
        <div className="flex items-center gap-3">
          <Link href={`/u/${item.publisher.handle}`} onClick={onClose} className="shrink-0">
            {item.publisher.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.publisher.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover ring-1 ring-border" />
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
              onClick={toggleFollow}
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
          <Act
            icon={liked ? WowSolid : WowOutline}
            label="Wow"
            active={liked}
            activeClass="text-violet-500"
            count={likes}
            onClick={(e) => {
              if (!liked) floatReaction(e.clientX, e.clientY);
              void react("like");
            }}
          />
          <Act icon={Share2} label="Share" count={item.sharesCount} onClick={share} />
          <Act icon={Bookmark} label="Save" active={saved} fill={saved} activeClass="text-primary" onClick={() => react("save")} />
        </div>

        <h3 className="mt-4 text-sm font-bold">Comments{item.commentsCount > 0 ? ` · ${formatCompactNumber(item.commentsCount)}` : ""}</h3>
        <div className="mt-2 min-h-0 flex-1">
          {comments ? (
            <Comments postId={item.id} comments={comments.comments} loggedIn={comments.loggedIn} canComment={comments.canComment} disabledReason={comments.canComment ? null : "Comments are unavailable."} count={item.commentsCount} />
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          )}
        </div>
      </aside>

      {/* "More" menu — same overflow the reel viewer offers, adapted for a
          single photo (no quality/mute-audio items). */}
      <AnimatePresence>
        {moreOpen ? (
          <div className="fixed inset-0 z-[95] flex items-end justify-center">
            <motion.button
              type="button"
              aria-label="Close"
              onClick={() => setMoreOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div
              role="menu"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={springs.sheet}
              className="relative m-2 w-full max-w-md overflow-hidden rounded-3xl border border-border/60 bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop-blur-2xl"
            >
              <div className="mx-auto mt-2.5 mb-1 h-1 w-9 rounded-full bg-border" />
              <div className="max-h-[70vh] overflow-y-auto p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <MoreGroup>
                  <MoreItem icon={Share2} label="Share" onClick={share} />
                  <MoreItem icon={Link2} label="Copy link" onClick={copyLink} />
                  <MoreItem icon={ExternalLink} label="Open in browser" onClick={openInBrowser} />
                  <MoreItem icon={Info} label="View post details" onClick={viewDetails} />
                </MoreGroup>

                <MoreGroup>
                  <MoreItem icon={FolderPlus} label="Add to collection" onClick={() => { setMoreOpen(false); setPickerReady(true); setPickerOpen(true); }} />
                  <MoreItem icon={Download} label="Download" onClick={() => { setMoreOpen(false); void downloadPost({ id: item.id, mediaUrl: item.mediaUrl, title }); }} />
                  {item.isOwner ? (
                    <MoreItem icon={Pencil} label="Edit post" onClick={() => { setMoreOpen(false); setEditReady(true); setEditOpen(true); }} />
                  ) : (
                    <>
                      <MoreItem icon={following ? Check : UserPlus} label={following ? "Following creator" : "Follow creator"} onClick={() => { setMoreOpen(false); toggleFollow(); }} />
                      <MoreItem icon={BellOff} label="Mute creator" onClick={muteCreator} />
                    </>
                  )}
                </MoreGroup>

                {!item.isOwner ? (
                  <MoreGroup>
                    <MoreItem icon={EyeOff} label="Hide this post" onClick={hidePost} />
                    <MoreItem icon={Ban} label="Not interested" onClick={hidePost} />
                  </MoreGroup>
                ) : null}

                {!item.isOwner ? (
                  <MoreGroup>
                    <MoreItem icon={Flag} label="Report post" onClick={openReport} danger />
                    <MoreItem icon={UserX} label={`Block @${item.publisher.handle}`} onClick={blockUser} danger />
                  </MoreGroup>
                ) : null}
              </div>

              <div className="p-1.5 pt-0">
                <button type="button" onClick={() => setMoreOpen(false)} className="w-full rounded-2xl bg-secondary/70 py-3 text-sm font-semibold text-foreground transition hover:bg-secondary active:scale-[0.99]">
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      {pickerReady ? <CollectionPicker postId={item.id} open={pickerOpen} onClose={() => setPickerOpen(false)} /> : null}

      {item.isOwner && editReady ? (
        <PostEditSheet
          item={{ id: item.id, title: title ?? "" }}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={(p) => setTitle(p.title)}
          onDeleted={onClose}
        />
      ) : null}

      {reportReady ? <ReportSheet targetType="post" targetId={item.id} open={reportOpen} onClose={() => setReportOpen(false)} /> : null}

      {shareReady ? (
        <>
          <ShareSheet
            postId={item.id}
            title={title ?? undefined}
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            onQrCode={() => setQrOpen(true)}
          />
          <ShareQrSheet postId={item.id} url={`${typeof window !== "undefined" ? window.location.origin : ""}/p/${item.id}`} open={qrOpen} onClose={() => setQrOpen(false)} />
        </>
      ) : null}
    </motion.div>
  );
}

/** Stories-style: how long an unattended slide stays up before auto-advancing. */
const ALBUM_AUTO_SLIDE_MS = 3500;

/**
 * Fullscreen album — opens on the exact slide that was tapped (never always
 * the first), then AUTO-SLIDES through the rest Stories-style until the
 * viewer touches the screen at all, at which point autoplay stops for good
 * and every further slide change is manual (owner, 2026-08-17: "auto slide
 * and when tapped it stops and demands a manual slide"). Drag-down-to-
 * dismiss is NOT handled here — it lives on the parent `ImageStage`'s outer
 * wrapper (see its own extensive comment), so this component only ever
 * needs to own its native horizontal scroll and tap/double-tap. A vertical
 * swipe never moves to the next/previous POST either (owner, same day,
 * earlier: "remove the Y axis scroll and movement from the multi post
 * viewer") — a mostly-vertical gesture here is always either the parent's
 * dismiss-drag or nothing, never post navigation.
 */
function AlbumSwipe({
  items,
  startIndex,
  onIndexChange,
  onTap,
  onDoubleTap,
}: {
  items: NonNullable<FeedItem["mediaItems"]>;
  startIndex: number;
  onIndexChange: (i: number) => void;
  onTap: () => void;
  onDoubleTap: (x: number, y: number) => void;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(startIndex);
  const indexRef = useRef(index);
  indexRef.current = index;
  const raf = useRef(0);
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const lastTap = useRef(0);
  // Starts true for any real album; a single-slide "album" (shouldn't
  // normally reach this component, but defensively) never auto-advances
  // into nothing.
  const [autoPlaying, setAutoPlaying] = useState(items.length > 1);

  // Stories-style auto-advance: one persistent interval (not recreated on
  // every slide change — it reads the CURRENT index via ref each tick)
  // until it either reaches the last slide or the viewer touches the
  // screen at all (see `stopAutoPlay` in the pointer handlers below).
  useEffect(() => {
    if (!autoPlaying) return;
    const id = setInterval(() => {
      const el = scroller.current;
      if (!el || el.clientWidth === 0) return;
      const next = indexRef.current + 1;
      if (next >= items.length) {
        setAutoPlaying(false);
        return;
      }
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    }, ALBUM_AUTO_SLIDE_MS);
    return () => clearInterval(id);
  }, [autoPlaying, items.length]);

  // Sequential/priority loading (same fix as the feed's inline MediaCarousel
  // — see [[media-zoom-scroll-fixes]]): every slide used to mount its real
  // <img>/<video> src unconditionally the instant this viewer opened, so an
  // album with many photos fired that many simultaneous requests and the ONE
  // slide the user actually tapped competed with all the others for the
  // browser's connection cap. Only the tapped slide + its immediate
  // neighbours load at first; more unlock (and stay unlocked) as you swipe.
  const [unlocked, setUnlocked] = useState<Set<number>>(() => new Set([startIndex - 1, startIndex, startIndex + 1].filter((i) => i >= 0 && i < items.length)));
  // Per-slide true aspect ratio — seeded from each item's own stored
  // `width`/`height` (already populated by the feed's post-creation
  // pipelines, same source `reel-viewer.tsx`'s own album handling already
  // reads) and refined once that slide's real `<img>`/`<video>` reports its
  // natural size. This component was the one media surface in the codebase
  // that never sized its slides at all — no `aspectRatio`, no `object-fit`
  // target to letterbox against — so a slide had nothing but its own raw
  // intrinsic size (0×0, or a `<video>`'s ~300×150 browser default, before
  // metadata loads) to render at. That's the concrete gap behind "the multi
  // image still moves and doesn't cover the whole screen edge to edge".
  const [measuredRatios, setMeasuredRatios] = useState<Record<number, number>>({});
  const ratioFor = (i: number, m: NonNullable<FeedItem["mediaItems"]>[number]) => measuredRatios[i] ?? clampFeedRatio(m.width, m.height) ?? undefined;
  const onMediaMeasured = (i: number, w: number, h: number) => {
    if (measuredRatios[i] !== undefined) return;
    const r = clampFeedRatio(w, h);
    if (r) setMeasuredRatios((prev) => ({ ...prev, [i]: r }));
  };
  useEffect(() => {
    setUnlocked((prev) => {
      if (prev.has(index) && prev.has(Math.max(0, index - 1)) && prev.has(Math.min(items.length - 1, index + 1))) return prev;
      const next = new Set(prev);
      next.add(index);
      if (index > 0) next.add(index - 1);
      if (index < items.length - 1) next.add(index + 1);
      return next;
    });
  }, [index, items.length]);
  const isNear = (i: number) => Math.abs(i - index) <= 1;

  // Jump to the tapped slide instantly on mount — no smooth-scroll flash.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = startIndex * el.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = scroller.current;
      if (!el || el.clientWidth === 0) return;
      const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollLeft / el.clientWidth)));
      setIndex(i);
      onIndexChange(i);
    });
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const onPointerDown = (e: React.PointerEvent) => {
    startPt.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    // ANY touch on the album — tap, drag, whatever it turns out to be —
    // ends autoplay for good (owner: "when tapped it stops and demands a
    // manual slide"). Deliberately in pointerDOWN, not resolved later in
    // pointerUp, so it can never race a fast follow-up gesture.
    if (autoPlaying) setAutoPlaying(false);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!startPt.current || moved.current) return;
    if (Math.abs(e.clientX - startPt.current.x) > 10 || Math.abs(e.clientY - startPt.current.y) > 10) moved.current = true;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const wasMoved = moved.current;
    startPt.current = null;
    // A real drag already did its job as either the native horizontal scroll
    // or the parent's own dismiss-drag (see ImageStage) — never also a tap.
    if (wasMoved) return;
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      onDoubleTap(e.clientX, e.clientY);
    } else {
      lastTap.current = now;
      setTimeout(() => {
        if (lastTap.current && Date.now() - lastTap.current >= 280) onTap();
      }, 290);
    }
  };
  const onPointerCancel = () => {
    startPt.current = null;
  };

  return (
    <div
      className="absolute inset-0"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div
        ref={scroller}
        onScroll={onScroll}
        data-hscroll
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ touchAction: "pan-x" }}
      >
        {items.map((m, i) => {
          const loaded = isNear(i) || unlocked.has(i);
          const slideRatio = ratioFor(i, m) ?? null;
          // 🔴 THE ONE EXCEPTION TO NEVER-CROP — see `isReelsShaped`'s note
          // in lib/media/aspect.ts. Below reels-tallness: never crops, same
          // as always. At or beyond it: fills the slide edge to edge via
          // object-cover, wallpaper-reels.tsx style.
          const tall = isReelsShaped(slideRatio);
          const fitClassName = tall
            ? "relative h-full w-full select-none object-cover"
            : "relative h-auto max-h-full w-auto max-w-full select-none object-contain";
          const fitStyle = tall ? undefined : slideRatio ? { aspectRatio: slideRatio } : undefined;
          return (
            <div key={i} className={cn("relative h-full w-full shrink-0 snap-center", !tall && "flex items-center justify-center")}>
              {!loaded ? (
                <div className="absolute inset-0 bg-black" />
              ) : (
                <>
                  {/* Blurred fill — only meaningful when there's letterbox
                      space left to fill; a reels-shaped slide above already
                      covers the box completely on its own. 70%, not 30% —
                      see the single-photo backdrop for the same fix. */}
                  {!tall && (m.thumbnailUrl ?? (m.kind === "image" ? m.url : null)) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={(m.thumbnailUrl ?? m.url)!}
                      alt=""
                      aria-hidden
                      loading="eager"
                      decoding="async"
                      className="absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-2xl"
                    />
                  ) : null}
                  {m.kind === "video" ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video
                      src={m.url}
                      poster={m.thumbnailUrl ?? undefined}
                      muted
                      loop
                      playsInline
                      preload={Math.abs(i - index) <= 1 ? "auto" : "metadata"}
                      style={fitStyle}
                      onLoadedMetadata={(e) => {
                        const v = e.currentTarget;
                        if (v.videoWidth && v.videoHeight) onMediaMeasured(i, v.videoWidth, v.videoHeight);
                      }}
                      className={fitClassName}
                      onPlay={(e) => claimPlayback(e.currentTarget)}
                      onPause={(e) => releasePlayback(e.currentTarget)}
                      ref={(el) => {
                        if (!el) return;
                        // Autoplay only while this slide is the active one.
                        if (i === index) void el.play().catch(() => {});
                        else el.pause();
                      }}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.url}
                      alt=""
                      draggable={false}
                      loading="eager"
                      style={fitStyle}
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        if (img.naturalWidth && img.naturalHeight) onMediaMeasured(i, img.naturalWidth, img.naturalHeight);
                      }}
                      className={fitClassName}
                    />
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Counter + dots — placed just under the top X / More buttons so they
          never collide with the bottom caption/action rail. */}
      <div className="pointer-events-none absolute inset-x-0 top-[calc(max(1rem,var(--frenz-safe-top))+3.25rem)] z-[55] flex flex-col items-center gap-2">
        <span className="rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white backdrop-blur">
          {index + 1}/{items.length}
        </span>
        <div className="flex items-center gap-1.5">
          {items.map((_, i) => (
            <span key={i} className={cn("h-1.5 rounded-full transition-all duration-300", i === index ? "w-4 bg-white" : "w-1.5 bg-white/45")} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A visually grouped block of overflow rows, separated by a subtle divider. */
function MoreGroup({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 overflow-hidden rounded-2xl bg-secondary/30 last:mb-0">{children}</div>;
}

function MoreItem({ icon: Icon, label, onClick, danger }: { icon: typeof Heart; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      className={cn(
        "flex w-full items-center gap-3.5 px-4 py-3 text-left text-[15px] font-medium transition first:rounded-t-2xl last:rounded-b-2xl active:scale-[0.99]",
        danger ? "text-red-500 hover:bg-red-500/10" : "text-foreground hover:bg-secondary/70",
      )}
    >
      <Icon className="h-5 w-5 shrink-0 opacity-90" strokeWidth={1.9} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function Act({
  icon: Icon,
  label,
  count,
  active,
  fill,
  activeClass,
  onClick,
}: {
  icon: typeof Heart;
  label: string;
  count?: number;
  active?: boolean;
  fill?: boolean;
  activeClass?: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-muted-foreground transition hover:bg-secondary", active && activeClass)}
    >
      <Icon className={cn("h-[18px] w-[18px]", fill && "fill-current")} />
      {count !== undefined && count > 0 ? <AnimatedCount value={count} className="text-xs font-medium tabular-nums" /> : null}
    </button>
  );
}

function RailBtn({ icon: Icon, count, active, fill, activeClass, label, onClick }: { icon: typeof Heart; count?: number; active?: boolean; fill?: boolean; activeClass?: string; label: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <motion.button type="button" onClick={onClick} aria-label={label} aria-pressed={active} whileTap={{ scale: 0.86 }} transition={{ type: "spring", stiffness: 520, damping: 22 }} className="flex flex-col items-center gap-1 text-white">
      <span className={cn("flex h-12 w-12 items-center justify-center rounded-full bg-white/10 ring-1 ring-inset ring-white/15 backdrop-blur-md transition-colors", active && "bg-white/15 ring-white/25")}>
        <Icon className={cn("h-6 w-6 drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]", fill && "fill-current", active && activeClass)} strokeWidth={2.1} />
      </span>
      {count !== undefined && count > 0 ? <AnimatedCount value={count} className="text-[11px] font-bold tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" /> : null}
    </motion.button>
  );
}
