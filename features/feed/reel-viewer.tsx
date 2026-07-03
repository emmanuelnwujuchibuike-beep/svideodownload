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
  Share2,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { SmartVideo } from "@/features/media/smart-video";
import { Comments } from "@/features/social/comments";
import type { CommentNode } from "@/lib/social/engagement";
import { claimPlayback, releasePlayback } from "@/lib/media/video-coordinator";
import type { FeedItem } from "@/lib/social/home-feed";
import { cn, formatCompactNumber } from "@/lib/utils";

interface CommentsData {
  comments: CommentNode[];
  canComment: boolean;
  loggedIn: boolean;
}

/**
 * Fullscreen reel player. A video plays edge-to-edge with sound; a vertical
 * action rail (like / comment / share / save) floats on the right and the
 * author + caption sit at the bottom. Playback is press-and-hold to pause —
 * hold anywhere on the video and release to resume, like TikTok/Reels.
 */
export function ReelViewer({ item, onClose }: { item: FeedItem | null; onClose: () => void }) {
  return (
    <AnimatePresence>{item ? <ReelInner key={item.id} item={item} onClose={onClose} /> : null}</AnimatePresence>
  );
}

function ReelInner({ item, onClose }: { item: FeedItem; onClose: () => void }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  // Controls (rail, caption, progress) auto-hide after 2s of no tap for a clean,
  // full-screen view; a tap toggles them. The back button always stays.
  const [ui, setUi] = useState(true);

  const [liked, setLiked] = useState(item.viewerLiked);
  const [saved, setSaved] = useState(item.viewerSaved);
  const [following, setFollowing] = useState(item.isFollowing);
  const [likes, setLikes] = useState(item.likesCount);
  const [shares, setShares] = useState(item.sharesCount);
  const [showComments, setShowComments] = useState(false);
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

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    scheduleHide(); // start the initial 2s auto-hide
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (video.current) releasePlayback(video.current);
    };
  }, [onClose, scheduleHide]);

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

  const react = async (type: "like" | "save") => {
    const isLike = type === "like";
    const cur = isLike ? liked : saved;
    const next = !cur;
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
        setLiked(cur);
        setLikes((n) => n + (next ? -1 : 1));
      } else setSaved(cur);
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

  // Press-and-hold to pause (native player only); a quick tap toggles the UI.
  const onPointerDown = () => {
    if (!native) return;
    holding.current = false;
    holdTimer.current = setTimeout(() => {
      holding.current = true;
      video.current?.pause();
      setPaused(true);
    }, 160);
  };
  const endHold = () => {
    if (native && holdTimer.current) clearTimeout(holdTimer.current);
    if (native && holding.current) {
      holding.current = false;
      void video.current?.play();
      setPaused(false);
    } else {
      toggleUi();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[85] bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
    >
      {/* Progress bar (part of the auto-hiding UI) */}
      <div className={cn("absolute inset-x-0 top-0 z-30 h-0.5 bg-white/15 transition-opacity duration-200", ui ? "opacity-100" : "opacity-0")}>
        <div className="h-full bg-white" style={{ width: `${progress}%` }} />
      </div>

      {/* Close — ALWAYS visible, even when the rest of the UI is hidden */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Back"
        className="absolute left-4 top-4 z-40 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Media (press-and-hold to pause) */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        onPointerDown={onPointerDown}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
      >
        {native ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            ref={video}
            src={item.mediaUrl!}
            poster={item.thumbnailUrl ?? undefined}
            autoPlay
            loop
            playsInline
            className="max-h-full max-w-full object-contain"
            onPlay={() => video.current && claimPlayback(video.current)}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration) setProgress((v.currentTime / v.duration) * 100);
            }}
          />
        ) : (
          <SmartVideo streamUid={item.streamUid} src={item.mediaUrl} poster={item.thumbnailUrl} controls autoPlay className="max-h-full" />
        )}

        {/* Paused indicator */}
        {paused ? (
          <span className="pointer-events-none absolute flex h-16 w-16 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur">
            <Pause className="h-7 w-7 fill-white" />
          </span>
        ) : null}
      </div>

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
        <RailButton icon={MessageCircle} count={item.commentsCount} label="Comments" onClick={() => setShowComments(true)} />
        <RailButton icon={Bookmark} active={saved} fill={saved} activeClass="text-amber-400" label="Save" onClick={() => react("save")} />
        <RailButton icon={Share2} count={shares} label="Share" onClick={share} />
        {following && !item.isOwner ? (
          <button type="button" onClick={toggleFollow} aria-label="Following" className="flex flex-col items-center text-white/90">
            <Check className="h-6 w-6" />
            <span className="text-[10px] font-semibold">Following</span>
          </button>
        ) : null}
      </div>

      {/* Author + caption (auto-hides) */}
      <div className={cn("absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-4 pb-24 pt-16 transition-opacity duration-200 sm:pb-8", ui ? "opacity-100" : "pointer-events-none opacity-0")}>
        <Link href={`/u/${item.publisher.handle}`} onClick={onClose} className="inline-flex items-center gap-1.5 text-white">
          <span className="font-bold">@{item.publisher.handle}</span>
          {item.publisher.isVerified ? <BadgeCheck className="h-4 w-4" /> : null}
        </Link>
        {item.title ? <p className="mt-1.5 line-clamp-2 max-w-md text-sm text-white/90">{item.title}</p> : null}
      </div>

      {/* Comments sheet */}
      <AnimatePresence>
        {showComments ? (
          <>
            <button type="button" aria-label="Close comments" onClick={() => setShowComments(false)} className="absolute inset-0 z-40 bg-black/40" />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
              className="absolute inset-x-0 bottom-0 z-50 max-h-[72vh] overflow-y-auto rounded-t-3xl bg-card p-5"
              onAnimationStart={loadComments}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold">Comments{item.commentsCount > 0 ? ` · ${formatCompactNumber(item.commentsCount)}` : ""}</h3>
                <button type="button" onClick={() => setShowComments(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
                  <X className="h-5 w-5" />
                </button>
              </div>
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
                />
              ) : null}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
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
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 backdrop-blur transition active:scale-90">
        <Icon className={cn("h-6 w-6", fill && "fill-current", active && activeClass)} />
      </span>
      {count !== undefined && count > 0 ? <span className="text-[11px] font-semibold tabular-nums">{formatCompactNumber(count)}</span> : null}
    </button>
  );
}
