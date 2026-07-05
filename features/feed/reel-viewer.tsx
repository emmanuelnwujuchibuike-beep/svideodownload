"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  Ban,
  BellOff,
  Bookmark,
  Check,
  Download,
  ExternalLink,
  EyeOff,
  Flag,
  FolderPlus,
  Gauge,
  Heart,
  Info,
  Link2,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Repeat2,
  Share2,
  UserPlus,
  UserX,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { RichText } from "@/components/social/rich-text";
import { SmartVideo } from "@/features/media/smart-video";
import { useAdaptiveSource } from "@/features/media/use-adaptive-source";
import { Comments } from "@/features/social/comments";
import { CollectionPicker } from "@/features/social/collection-picker";
import { PostPollInline } from "@/features/social/post-poll-inline";
import { RepostBurst } from "@/features/social/repost-burst";
import { claimPlayback, recordView, releasePlayback } from "@/lib/media/video-coordinator";
import { PostEditSheet } from "@/features/social/post-edit-sheet";
import { toast } from "@/features/ui/toast";
import { FrenzsaveError } from "@/lib/sdk";
import { muteInstant, unmuteWithFade } from "@/lib/media/audio-playback";
import { downloadPost } from "@/lib/media/download-post";
import { getQualityPreference, setQualityPreference, type QualityPreference } from "@/lib/media/network-conditions";
import { streamHlsUrl } from "@/lib/media/stream";
import { loadPostComments, prefetchPostComments } from "@/lib/social/comments-cache";
import { toggleFollow as toggleFollowShared, useFollowState } from "@/lib/social/follow-store";
import { toggleRepost, useRepostState } from "@/lib/social/repost-store";
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

const QUALITY_LABELS: Record<QualityPreference, string> = {
  auto: "Auto (recommended)",
  "data-saver": "Data saver",
  high: "Highest quality",
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

export function ReelDeck({
  items,
  startIndex,
  onClose,
  onEndReached,
  variant = "modal",
  autoOpenCommentsId,
}: {
  items: FeedItem[];
  startIndex: number;
  onClose: () => void;
  /** Called as the viewer nears the end — powers infinite loading on the page. */
  onEndReached?: () => void;
  /** "modal" (over the app) or "page" (a route; sits below the mobile nav). */
  variant?: "modal" | "page";
  /** Deep-link support: open this reel's comments sheet the moment it mounts. */
  autoOpenCommentsId?: string | null;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const raf = useRef<number | null>(null);
  const start = Math.min(Math.max(0, startIndex), items.length - 1);
  const [active, setActive] = useState(start);
  // While a comments sheet is open the deck must NOT snap-scroll to the next
  // reel — the sheet stays put and the reel behind it is frozen.
  const [locked, setLocked] = useState(false);

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
      if (i >= items.length - 3) onEndReached?.();
    });
  }, [items.length, onEndReached]);

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
      className={cn(
        "fixed inset-0 overflow-hidden overscroll-none bg-black",
        // On large screens the /reels page sits BESIDE the app sidebar (which stays
        // visible + scrollable) instead of covering it.
        variant === "page" ? "z-30 lg:left-64" : "z-[85]",
      )}
      style={{ touchAction: "pan-y" }}
      role="dialog"
      aria-modal="true"
      aria-label="Reels"
    >
      {/* Back — ALWAYS visible and tappable, above every reel element (incl. the
          scrubber) so it reliably closes the reel on every device. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close reels"
        className="absolute left-4 top-4 z-[80] flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition hover:bg-black/60 active:scale-95"
      >
        <X className="h-5 w-5" />
      </button>

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
          <section key={item.id} className="relative flex h-[100dvh] w-full snap-start snap-always justify-center bg-black">
            {/* On phones the reel fills the screen; on tablets/desktop it becomes a
                centered 9:16 column (black to the sides). On lg the column lets its
                overflow show so the action rail can sit OUTSIDE the video, in the
                right gutter (YouTube-Shorts-style). */}
            <div className="relative h-full w-full overflow-hidden bg-black lg:w-[min(100%,56.25vh)] lg:overflow-visible">
              <ReelCard
                item={item}
                isActive={i === active}
                isNext={i === active + 1}
                // Mount the previous clip + the next three so scrolling forward
                // never hits an unmounted video. To protect battery/data we only
                // FULLY buffer (preload=auto) the active clip and the next two you're
                // about to reach; the neighbours load metadata only.
                nearby={i >= active - 1 && i <= active + 3}
                preload={i >= active && i <= active + 2 ? "auto" : "metadata"}
                loop={items.length === 1}
                onClose={onClose}
                onEnded={() => (i < items.length - 1 ? scrollToIndex(i + 1) : undefined)}
                onCommentsOpen={setLocked}
                autoOpenComments={item.id === autoOpenCommentsId}
                variant={variant}
                onReady={markReady}
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
  isActive,
  isNext,
  nearby,
  loop,
  onClose,
  onEnded,
  onCommentsOpen,
  autoOpenComments,
  variant = "modal",
  onReady,
  preload = "auto",
}: {
  item: FeedItem;
  isActive: boolean;
  isNext: boolean;
  nearby: boolean;
  loop: boolean;
  onClose: () => void;
  onEnded: () => void;
  onCommentsOpen: (open: boolean) => void;
  autoOpenComments?: boolean;
  variant?: "modal" | "page";
  /** Report this reel as buffered/ready so the deck can extend the scroll ceiling. */
  onReady?: (id: string) => void;
  /** How aggressively to buffer this clip — "auto" for the ones you'll reach next,
   *  "metadata" for the further neighbours (saves mobile battery/data). */
  preload?: "auto" | "metadata";
}) {
  // Anchor the caption + action rail low. On the /reels route (page) they sit just
  // above the mobile bottom nav and drop to the very bottom on large screens; in
  // the modal (no nav) they hug the bottom on every size — no empty gap.
  const railBottom = variant === "page" ? "bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:bottom-6" : "bottom-6";
  const captionPad = variant === "page" ? "pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-8" : "pb-6 lg:pb-8";
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
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubPct, setScrubPct] = useState(0);
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  const seekBar = useRef<HTMLDivElement | null>(null);
  const pauseSignTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [liked, setLiked] = useState(item.viewerLiked);
  const [saved, setSaved] = useState(item.viewerSaved);
  const following = useFollowState(item.publisher.id, item.isFollowing);
  const [likes, setLikes] = useState(item.likesCount);
  const [showComments, setShowComments] = useState(false);
  const [sheetVideoPaused, setSheetVideoPaused] = useState(false);
  const [comments, setComments] = useState<CommentsData | null>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [editOpen, setEditOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const repostState = useRepostState(item.id, item.viewerReposted ?? false, item.repostsCount ?? 0);
  const [repostBurst, setRepostBurst] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [srcReady, setSrcReady] = useState(false);
  const [qualityPref, setQualityPref] = useState<QualityPreference>("auto");
  const fetched = useRef(false);

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
  // that will never exist.
  const hlsUrl = item.streamUid && !item.streamFailed ? streamHlsUrl(item.streamUid) : null;
  const native = !!item.mediaUrl || !!hlsUrl;
  const markSrcReady = useCallback(() => setSrcReady(true), []);
  // HLS (hls.js) buffers whatever is attached, so only wire the ACTIVE + NEXT reel
  // (predictive preload of exactly the next clip; decoders released for the rest).
  // Plain MP4 can attach across the nearby window — the `preload` attribute keeps
  // the far ones to metadata only, so it's cheap.
  const attachSource = hlsUrl ? isActive || isNext : nearby;
  useAdaptiveSource(video, { hlsUrl, src: item.mediaUrl, poster: item.thumbnailUrl, active: attachSource, onReady: markSrcReady, postId: item.id });

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

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setUi(false), 4000);
  }, []);
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
        if (video.current?.paused) setPaused(true);
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
      if (video.current) releasePlayback(video.current);
    };
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

  // Predictively warm this reel's comments the moment it becomes the active one,
  // so tapping the comment button opens instantly.
  useEffect(() => {
    if (isActive) prefetchPostComments(item.id);
  }, [isActive, item.id]);

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

  const repost = async () => {
    const next = !repostState.reposted;
    if (next) {
      setRepostBurst(Date.now()); // OS-style bubble pops on repost (not on undo)
      try {
        navigator.vibrate?.(10);
      } catch {
        /* no haptics */
      }
    }
    try {
      await toggleRepost(item.id, next, repostState.count);
      toast(next ? "Reposted to your profile." : "Removed repost.", "success");
    } catch (e) {
      setRepostBurst(null);
      toast(e instanceof FrenzsaveError ? e.message : "Couldn't repost.", "error");
    }
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
  const reportPost = async () => {
    setMoreOpen(false);
    try {
      await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "post", targetId: item.id, reason: "inappropriate" }),
      });
      toast("Reported. Thanks for keeping Frenz safe.", "success");
    } catch {
      toast("Couldn't send the report.", "error");
    }
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
  const hidePost = () => {
    setMoreOpen(false);
    toast("We'll show less like this.", "info");
    onClose();
  };
  const comingSoon = (what: string) => {
    setMoreOpen(false);
    toast(`${what} — coming soon.`, "info");
  };

  // Manual quality override (spec: automatic selection is the default, but let
  // the viewer force it). A three-way cycle — same shape as every major
  // short-video app uses instead of a per-rendition picker. Takes effect from
  // the next video that attaches (this one keeps playing at its current level).
  const cycleQuality = () => {
    const order: QualityPreference[] = ["auto", "data-saver", "high"];
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
  //  • press-and-HOLD (~0.5s) → pause while held; release resumes.
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
      else likeBurst(e.clientX, e.clientY); // double-tap center to like
      return;
    }
    lastTap.current = { t: now, x };
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    singleTapTimer.current = setTimeout(() => togglePauseTap(), 280);
  };

  return (
    <>
      {/* Cover — always painted underneath so a snapped-in reel never flashes black */}
      {item.thumbnailUrl ? (
        <div className="absolute inset-0 bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.thumbnailUrl} alt="" aria-hidden loading="lazy" decoding="async" className="h-full w-full scale-110 object-cover opacity-40 blur-2xl lg:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.thumbnailUrl} alt="" aria-hidden loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover lg:object-contain" />
        </div>
      ) : null}

      {/* Top / bottom legibility scrims */}
      <div className={cn("pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-black/50 to-transparent transition-opacity duration-200", ui ? "opacity-100" : "opacity-0")} />

      {/* Progress / scrubber (auto-hides). Drag to seek when we own the <video>. */}
      {(() => {
        const scrubbable = native && dur > 0;
        const displayPct = scrubbing ? scrubPct * 100 : progress;
        return (
          <div className={cn("absolute inset-x-0 top-0 z-40 transition-opacity duration-200", ui || scrubbing ? "opacity-100" : "opacity-0")}>
            <div
              ref={seekBar}
              onPointerDown={scrubbable ? scrubStart : undefined}
              onPointerMove={scrubbable ? scrubMove : undefined}
              onPointerUp={scrubbable ? scrubEnd : undefined}
              onPointerCancel={scrubbable ? scrubEnd : undefined}
              className={cn("group/seek relative flex items-center", scrubbable ? "h-5 cursor-pointer touch-none" : "h-1")}
            >
              <div className={cn("absolute inset-x-0 top-0 bg-white/15 transition-[height] duration-150", scrubbing ? "h-1.5" : "h-1 group-hover/seek:h-1.5")}>
                <div className="h-full rounded-r-full bg-gradient-to-r from-blue-400 via-violet-400 to-fuchsia-400 shadow-[0_0_8px] shadow-violet-400/50" style={{ width: `${displayPct}%` }} />
              </div>
              {scrubbable ? (
                <span
                  aria-hidden
                  className={cn("absolute top-0 h-3 w-3 -translate-x-1/2 rounded-full bg-white shadow ring-2 ring-violet-400 transition-transform", scrubbing ? "scale-125 opacity-100" : "opacity-0 group-hover/seek:opacity-100")}
                  style={{ left: `${displayPct}%` }}
                />
              ) : null}
              {scrubbing ? (
                <span className="absolute -top-8 -translate-x-1/2 rounded-md bg-black/80 px-2 py-1 text-[11px] font-bold tabular-nums text-white shadow-lg" style={{ left: `${displayPct}%` }}>
                  {fmt(scrubPct * dur)}
                </span>
              ) : null}
            </div>
          </div>
        );
      })()}

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
              // Source (HLS or MP4) is attached imperatively by useAdaptiveSource.
              poster={item.thumbnailUrl ?? undefined}
              loop={loop}
              playsInline
              preload={preload}
              className="relative z-10 h-full w-full object-cover lg:h-auto lg:max-h-full lg:w-auto lg:max-w-full lg:object-contain"
              onPlay={() => {
                video.current && claimPlayback(video.current);
                setBuffering(false);
                recordView(item.id);
              }}
              onWaiting={() => setBuffering(true)}
              onPlaying={() => setBuffering(false)}
              onCanPlay={() => onReady?.(item.id)}
              onError={() => onReady?.(item.id)}
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

        {/* Double-tap-to-like heart bursts */}
        {bursts.map((b) => (
          <span key={b.id} aria-hidden style={{ position: "fixed", left: b.x, top: b.y, zIndex: 45 }} className="pointer-events-none -translate-x-1/2 -translate-y-1/2">
            <motion.span
              initial={{ opacity: 0, scale: 0.4, y: 0 }}
              animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.3, 1.1, 1.5], y: [0, -10, -18, -46] }}
              transition={{ duration: 0.9, ease: "easeOut", times: [0, 0.2, 0.6, 1] }}
              onAnimationComplete={() => setBursts((x) => x.filter((i) => i.id !== b.id))}
              className="block"
            >
              <Heart className="h-16 w-16 fill-rose-500 text-rose-500 drop-shadow-[0_2px_12px_rgba(244,63,94,0.6)]" />
            </motion.span>
          </span>
        ))}
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

      {/* Action rail — auto-hides over the video on mobile; on lg it lives OUTSIDE
          the video in the right gutter and stays put. */}
      <div className={cn("absolute right-3 z-30 flex flex-col items-center gap-5 transition-opacity duration-200 lg:-right-[4.5rem] lg:!opacity-100", railBottom, ui ? "opacity-100" : "pointer-events-none opacity-0")}>
        <Link href={`/u/${item.publisher.handle}`} onClick={onClose} className="relative mb-1">
          {item.publisher.avatarUrl ? (
            <Image src={item.publisher.avatarUrl} alt="" width={44} height={44} className="h-11 w-11 rounded-full object-cover ring-2 ring-white" />
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

        {/* Refined action stack: Like · Comment · Repost · Save · More. Share and
            everything else live in the premium overflow sheet. */}
        <RailButton icon={Heart} active={liked} fill={liked} activeClass="text-rose-500" count={likes} label="Like" onClick={() => react("like")} />
        <RailButton icon={MessageCircle} count={item.commentsCount} label="Comment" onClick={openComments} />
        <div className="relative flex flex-col items-center gap-1">
          <RepostBurst triggerKey={repostBurst} />
          {item.repostBadge && item.repostBadge.count > 0 ? (
            <div className="flex items-center" aria-label={`${item.repostBadge.count} people you follow reposted this`}>
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
            </div>
          ) : null}
          <RailButton icon={Repeat2} active={repostState.reposted} count={repostState.count} activeClass="text-emerald-400" label="Repost" onClick={repost} />
        </div>
        <RailButton icon={Bookmark} active={saved} fill={saved} activeClass="text-amber-400" label="Save" onClick={() => react("save")} />
        <RailButton icon={MoreHorizontal} label="More" onClick={() => setMoreOpen(true)} />
      </div>

      {/* Author + caption (auto-hides) */}
      <div className={cn("absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-4 pt-16 transition-opacity duration-200", captionPad, ui ? "opacity-100" : "pointer-events-none opacity-0")}>
        <Link href={`/u/${item.publisher.handle}`} onClick={onClose} className="inline-flex items-center gap-1.5 text-white">
          <span className="font-bold">@{item.publisher.handle}</span>
          {item.publisher.isVerified ? <BadgeCheck className="h-4 w-4" /> : null}
        </Link>
        {title ? (
          <p className="mt-1.5 line-clamp-2 max-w-md text-sm text-white/90">
            <RichText text={title} linkClassName="font-semibold text-white hover:underline" />
          </p>
        ) : null}
        {item.hasPoll ? (
          <div className="mt-2 max-w-md text-white">
            <PostPollInline postId={item.id} compact />
          </div>
        ) : null}
      </div>

      {/* Comments sheet — fixed half-height panel. The reel behind it is frozen
          (the deck is scroll-locked), so scrolling to the bottom of the comments
          never jumps to the next video. The video is paused; a toggle lets you
          keep watching while you type. */}
      {mounted ? createPortal(
      <AnimatePresence>
        {showComments ? (
          <>
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
          </>
        ) : null}
      </AnimatePresence>,
      document.body,
    ) : null}

      {/* "More" menu — the decluttered overflow: download, edit, follow, mute.
          Portaled to <body> so it sits above the bottom nav. */}
      {mounted && moreOpen
        ? createPortal(
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
                transition={{ type: "spring", stiffness: 420, damping: 38 }}
                className="relative m-2 w-full max-w-md overflow-hidden rounded-3xl border border-border/60 bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop-blur-2xl"
              >
                <div className="mx-auto mt-2.5 mb-1 h-1 w-9 rounded-full bg-border" />
                <div className="max-h-[70vh] overflow-y-auto p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {/* Share & link */}
                  <MoreGroup>
                    <MoreItem icon={Share2} label="Share" onClick={share} />
                    <MoreItem icon={Link2} label="Copy link" onClick={copyLink} />
                    <MoreItem icon={ExternalLink} label="Open in browser" onClick={openInBrowser} />
                    <MoreItem icon={Info} label="View post details" onClick={viewDetails} />
                  </MoreGroup>

                  {/* Organize & creator */}
                  <MoreGroup>
                    <MoreItem icon={FolderPlus} label="Add to collection" onClick={() => { setMoreOpen(false); setPickerOpen(true); }} />
                    <MoreItem icon={Download} label="Download" onClick={() => { setMoreOpen(false); void downloadPost({ id: item.id, mediaUrl: item.mediaUrl, title: title ?? undefined }); }} />
                    {item.isOwner ? (
                      <MoreItem icon={Pencil} label="Edit post" onClick={() => { setMoreOpen(false); setEditOpen(true); }} />
                    ) : (
                      <>
                        <MoreItem icon={following ? Check : UserPlus} label={following ? "Following creator" : "Follow creator"} onClick={() => void toggleFollow()} />
                        <MoreItem icon={BellOff} label="Mute creator" onClick={() => comingSoon("Mute creator")} />
                      </>
                    )}
                    {native ? <MoreItem icon={mutedAuto ? VolumeX : Volume2} label={mutedAuto ? "Unmute audio" : "Mute audio"} onClick={() => { toggleMute(); setMoreOpen(false); }} /> : null}
                    {hlsUrl ? <MoreItem icon={Gauge} label={`Video quality: ${QUALITY_LABELS[qualityPref]}`} onClick={cycleQuality} /> : null}
                  </MoreGroup>

                  {/* Feedback */}
                  {!item.isOwner ? (
                    <MoreGroup>
                      <MoreItem icon={EyeOff} label="Hide this post" onClick={hidePost} />
                      <MoreItem icon={Ban} label="Not interested" onClick={hidePost} />
                    </MoreGroup>
                  ) : null}

                  {/* Danger */}
                  {!item.isOwner ? (
                    <MoreGroup>
                      <MoreItem icon={Flag} label="Report post" onClick={reportPost} danger />
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
            </div>,
            document.body,
          )
        : null}

      {/* Save-to-collection picker */}
      <CollectionPicker postId={item.id} open={pickerOpen} onClose={() => setPickerOpen(false)} />

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
      <Icon className="h-5 w-5 shrink-0 opacity-90" strokeWidth={1.9} /> {label}
    </button>
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
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      whileTap={{ scale: 0.86 }}
      transition={{ type: "spring", stiffness: 520, damping: 22 }}
      className="flex flex-col items-center gap-1 text-white"
    >
      <span
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full bg-white/10 ring-1 ring-inset ring-white/15 backdrop-blur-md transition-colors",
          active && "bg-white/15 ring-white/25",
        )}
      >
        <Icon className={cn("h-6 w-6 drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]", fill && "fill-current", active && activeClass)} strokeWidth={2.1} />
      </span>
      {count !== undefined && count > 0 ? <span className="text-[11px] font-bold tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">{formatCompactNumber(count)}</span> : null}
    </motion.button>
  );
}
