"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  Bookmark,
  Check,
  Heart,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  Share2,
  UserPlus,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { RichText } from "@/components/social/rich-text";
import { SmartVideo } from "@/features/media/smart-video";
import { Comments } from "@/features/social/comments";
import { claimPlayback, recordView, releasePlayback } from "@/lib/media/video-coordinator";
import type { CommentNode } from "@/lib/social/engagement";
import type { FeedItem } from "@/lib/social/home-feed";
import { cn, formatCompactNumber } from "@/lib/utils";

interface CommentsData {
  comments: CommentNode[];
  canComment: boolean;
  loggedIn: boolean;
}

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

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
  onClose,
}: {
  items: FeedItem[] | null;
  startIndex?: number;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {items && items.length ? <ReelDeck key="reeldeck" items={items} startIndex={startIndex} onClose={onClose} /> : null}
    </AnimatePresence>
  );
}

function ReelDeck({ items, startIndex, onClose }: { items: FeedItem[]; startIndex: number; onClose: () => void }) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const raf = useRef<number | null>(null);
  const start = Math.min(Math.max(0, startIndex), items.length - 1);
  const [active, setActive] = useState(start);
  // While a comments sheet is open the deck must NOT snap-scroll to the next
  // reel — the sheet stays put and the reel behind it is frozen.
  const [locked, setLocked] = useState(false);

  // Lock the page, jump to the opening reel, wire Escape.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = scroller.current;
    if (el) el.scrollTop = start * el.clientHeight; // instant, no smooth-scroll flash
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
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
    });
  }, [items.length]);

  const scrollToIndex = useCallback((i: number) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: i * el.clientHeight, behavior: "smooth" });
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[85] bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="Reels"
    >
      {/* Back — ALWAYS visible, above every reel */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Back"
        className="absolute left-4 top-4 z-[60] flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>

      <div
        ref={scroller}
        onScroll={onScroll}
        className={cn(
          "h-full w-full overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          locked ? "overflow-hidden" : "snap-y snap-mandatory overflow-y-scroll",
        )}
        style={locked ? undefined : { scrollSnapType: "y mandatory" }}
      >
        {items.map((item, i) => (
          <section key={item.id} className="relative h-[100dvh] w-full snap-start snap-always">
            <ReelCard
              item={item}
              isActive={i === active}
              nearby={Math.abs(i - active) <= 1}
              loop={items.length === 1}
              onClose={onClose}
              onEnded={() => (i < items.length - 1 ? scrollToIndex(i + 1) : undefined)}
              onCommentsOpen={setLocked}
            />
          </section>
        ))}
      </div>
    </motion.div>
  );
}

function ReelCard({
  item,
  isActive,
  nearby,
  loop,
  onClose,
  onEnded,
  onCommentsOpen,
}: {
  item: FeedItem;
  isActive: boolean;
  nearby: boolean;
  loop: boolean;
  onClose: () => void;
  onEnded: () => void;
  onCommentsOpen: (open: boolean) => void;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ t: number; x: number }>({ t: 0, x: 0 });
  const holding = useRef(false);
  const moved = useRef(false);
  const startPt = useRef<{ x: number; y: number } | null>(null);

  const [paused, setPaused] = useState(false);
  const [mutedAuto, setMutedAuto] = useState(false);
  const [progress, setProgress] = useState(0);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [seekFlash, setSeekFlash] = useState<{ side: "back" | "fwd"; key: number } | null>(null);
  const [ui, setUi] = useState(true);

  const [liked, setLiked] = useState(item.viewerLiked);
  const [saved, setSaved] = useState(item.viewerSaved);
  const [following, setFollowing] = useState(item.isFollowing);
  const [likes, setLikes] = useState(item.likesCount);
  const [shares, setShares] = useState(item.sharesCount);
  const [showComments, setShowComments] = useState(false);
  const [sheetVideoPaused, setSheetVideoPaused] = useState(false);
  const [comments, setComments] = useState<CommentsData | null>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const fetched = useRef(false);

  const native = !!item.mediaUrl;

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setUi(false), 2000);
  }, []);
  const toggleUi = useCallback(() => {
    setUi((v) => {
      const next = !v;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (next) hideTimer.current = setTimeout(() => setUi(false), 2000);
      return next;
    });
  }, []);

  // Play only the reel in view; pause + rewind the rest so re-entry is fresh.
  useEffect(() => {
    const v = video.current;
    if (!v || !native) return;
    if (isActive) {
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
  }, [isActive, native]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (video.current) releasePlayback(video.current);
    };
  }, []);

  const loadComments = useCallback(async () => {
    if (fetched.current) return;
    fetched.current = true;
    setLoadingComments(true);
    try {
      const res = await fetch(`/api/posts/${item.id}/comments`);
      if (res.ok) setComments((await res.json()) as CommentsData);
    } catch {
      /* ignore */
    } finally {
      setLoadingComments(false);
    }
  }, [item.id]);

  // Opening comments freezes the reel (no snap to the next video) and pauses
  // playback so people can read/type calmly; closing resumes it.
  const openComments = useCallback(() => {
    setShowComments(true);
    onCommentsOpen(true);
    video.current?.pause();
    setSheetVideoPaused(true);
  }, [onCommentsOpen]);
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

  const share = async () => {
    setShares((n) => n + 1);
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
    const next = !following;
    setFollowing(next);
    try {
      const res = await fetch(`/api/follow/${item.publisher.id}`, { method: next ? "POST" : "DELETE" });
      if (!res.ok) setFollowing(!next);
    } catch {
      setFollowing(!next);
    }
  };

  const unmute = () => {
    const v = video.current;
    if (!v) return;
    v.muted = false;
    setMutedAuto(false);
    void v.play().catch(() => {});
  };

  const seekBy = (delta: number) => {
    const v = video.current;
    if (!v || !v.duration) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
    setSeekFlash({ side: delta < 0 ? "back" : "fwd", key: Date.now() });
    setTimeout(() => setSeekFlash((s) => (s && Date.now() - s.key >= 480 ? null : s)), 500);
  };

  // Gesture model (vertical scrolling is now native, so movement is never a tap):
  //  • press-and-HOLD (~0.5s, no movement) → pause; release → resume.
  //  • double-tap left/right → seek −10s / +10s; single tap → toggle the UI.
  const onPointerDown = (e: React.PointerEvent) => {
    startPt.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    if (!native) return;
    holding.current = false;
    holdTimer.current = setTimeout(() => {
      if (moved.current) return;
      holding.current = true;
      video.current?.pause();
      setPaused(true);
    }, 500);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!startPt.current || moved.current) return;
    const dx = Math.abs(e.clientX - startPt.current.x);
    const dy = Math.abs(e.clientY - startPt.current.y);
    if (dx > 10 || dy > 10) {
      moved.current = true;
      if (holdTimer.current) clearTimeout(holdTimer.current);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    startPt.current = null;
    if (native && holdTimer.current) clearTimeout(holdTimer.current);
    if (native && holding.current) {
      holding.current = false;
      void video.current?.play();
      setPaused(false);
      return;
    }
    if (moved.current) return; // a scroll — leave it to the native scroller

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
      else toggleUi();
      return;
    }
    lastTap.current = { t: now, x };
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    singleTapTimer.current = setTimeout(() => toggleUi(), 280);
  };

  return (
    <>
      {/* Cover — always painted underneath so a snapped-in reel never flashes black */}
      {item.thumbnailUrl ? (
        <div className="absolute inset-0 bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.thumbnailUrl} alt="" aria-hidden className="h-full w-full scale-110 object-cover opacity-40 blur-2xl" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.thumbnailUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full object-contain" />
        </div>
      ) : null}

      {/* Top / bottom legibility scrims */}
      <div className={cn("pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-black/50 to-transparent transition-opacity duration-200", ui ? "opacity-100" : "opacity-0")} />

      {/* Progress (auto-hides) */}
      <div className={cn("absolute inset-x-0 top-0 z-30 h-1 bg-white/10 transition-opacity duration-200", ui ? "opacity-100" : "opacity-0")}>
        <div className="h-full rounded-r-full bg-gradient-to-r from-blue-400 via-violet-400 to-fuchsia-400 shadow-[0_0_8px] shadow-violet-400/50" style={{ width: `${progress}%` }} />
      </div>

      {/* Elapsed / total time — moves with playback, auto-hides with the UI */}
      {native && dur > 0 ? (
        <div className={cn("absolute right-4 top-4 z-30 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white backdrop-blur transition-opacity duration-200", ui ? "opacity-100" : "opacity-0")}>
          {fmt(cur)} / {fmt(dur)}
        </div>
      ) : null}

      {/* Media */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          if (holdTimer.current) clearTimeout(holdTimer.current);
          if (holding.current) {
            holding.current = false;
            void video.current?.play();
            setPaused(false);
          }
        }}
      >
        {native ? (
          nearby ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              ref={video}
              src={item.mediaUrl!}
              poster={item.thumbnailUrl ?? undefined}
              loop={loop}
              playsInline
              preload="auto"
              className="relative z-10 max-h-full max-w-full object-contain"
              onPlay={() => {
                video.current && claimPlayback(video.current);
                setBuffering(false);
                recordView(item.id);
              }}
              onWaiting={() => setBuffering(true)}
              onPlaying={() => setBuffering(false)}
              onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
              onEnded={() => !loop && onEnded()}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                setCur(v.currentTime);
                if (v.duration) setProgress((v.currentTime / v.duration) * 100);
              }}
            />
          ) : null
        ) : (
          <SmartVideo streamUid={item.streamUid} src={item.mediaUrl} poster={item.thumbnailUrl} controls autoPlay={isActive} className="relative z-10 max-h-full" />
        )}

        {/* Buffering — only when the network can't keep up */}
        {native && nearby && buffering && !paused ? (
          <span className="pointer-events-none absolute z-20 flex h-14 w-14 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur">
            <Loader2 className="h-6 w-6 animate-spin" />
          </span>
        ) : null}

        {paused ? (
          <span className="pointer-events-none absolute z-20 flex h-16 w-16 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur">
            <Pause className="h-7 w-7 fill-white" />
          </span>
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
      </div>

      {/* Tap-to-unmute pill */}
      {native && mutedAuto && isActive ? (
        <button
          type="button"
          onClick={unmute}
          className="absolute left-1/2 top-16 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur-md"
        >
          <VolumeX className="h-4 w-4" /> Tap for sound
        </button>
      ) : null}

      {/* Action rail (auto-hides) */}
      <div className={cn("absolute bottom-24 right-3 z-30 flex flex-col items-center gap-5 transition-opacity duration-200 sm:bottom-8", ui ? "opacity-100" : "pointer-events-none opacity-0")}>
        <Link href={`/u/${item.publisher.handle}`} onClick={onClose} className="relative mb-1">
          {item.publisher.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.publisher.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover ring-2 ring-white" />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-base font-bold text-white ring-2 ring-white">
              {item.publisher.displayName.charAt(0).toUpperCase()}
            </span>
          )}
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

        <RailButton icon={Heart} active={liked} fill={liked} activeClass="text-rose-500" count={likes} label="Like" onClick={() => react("like")} />
        <RailButton icon={MessageCircle} count={item.commentsCount} label="Comments" onClick={openComments} />
        <RailButton icon={Bookmark} active={saved} fill={saved} activeClass="text-amber-400" label="Save" onClick={() => react("save")} />
        <RailButton icon={Share2} count={shares} label="Share" onClick={share} />
        {native ? (
          <RailButton
            icon={mutedAuto ? VolumeX : Volume2}
            label={mutedAuto ? "Unmute" : "Mute"}
            onClick={() => {
              const v = video.current;
              if (!v) return;
              if (mutedAuto) unmute();
              else {
                v.muted = true;
                setMutedAuto(true);
              }
            }}
          />
        ) : null}
        {following && !item.isOwner ? (
          <span className="flex flex-col items-center text-white/90">
            <Check className="h-6 w-6" />
            <span className="text-[10px] font-semibold">Following</span>
          </span>
        ) : null}
      </div>

      {/* Author + caption (auto-hides) */}
      <div className={cn("absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-4 pb-24 pt-16 transition-opacity duration-200 sm:pb-8", ui ? "opacity-100" : "pointer-events-none opacity-0")}>
        <Link href={`/u/${item.publisher.handle}`} onClick={onClose} className="inline-flex items-center gap-1.5 text-white">
          <span className="font-bold">@{item.publisher.handle}</span>
          {item.publisher.isVerified ? <BadgeCheck className="h-4 w-4" /> : null}
        </Link>
        {item.title ? (
          <p className="mt-1.5 line-clamp-2 max-w-md text-sm text-white/90">
            <RichText text={item.title} linkClassName="font-semibold text-white hover:underline" />
          </p>
        ) : null}
      </div>

      {/* Comments sheet — fixed half-height panel. The reel behind it is frozen
          (the deck is scroll-locked), so scrolling to the bottom of the comments
          never jumps to the next video. The video is paused; a toggle lets you
          keep watching while you type. */}
      <AnimatePresence>
        {showComments ? (
          <>
            <button type="button" aria-label="Close comments" onClick={closeComments} className="absolute inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
              className="absolute inset-x-0 bottom-0 z-50 flex h-[68vh] flex-col rounded-t-3xl bg-card shadow-[0_-8px_40px_rgba(0,0,0,0.35)]"
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
                  <Comments
                    postId={item.id}
                    comments={comments.comments}
                    loggedIn={comments.loggedIn}
                    canComment={comments.canComment}
                    disabledReason={comments.canComment ? null : "Comments are unavailable."}
                    count={item.commentsCount}
                    variant="sheet"
                  />
                ) : null}
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </>
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
}: {
  icon: typeof Heart;
  count?: number;
  active?: boolean;
  fill?: boolean;
  activeClass?: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={active} className="flex flex-col items-center gap-1 text-white">
      <span
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15 backdrop-blur-md transition active:scale-90",
          active && "bg-white/15 ring-white/25",
        )}
      >
        <Icon className={cn("h-6 w-6 drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]", fill && "fill-current", active && activeClass)} strokeWidth={2.1} />
      </span>
      {count !== undefined && count > 0 ? <span className="text-[11px] font-bold tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">{formatCompactNumber(count)}</span> : null}
    </button>
  );
}
