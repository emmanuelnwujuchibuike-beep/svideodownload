"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, Pause, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { claimPlayback, recordView, releasePlayback } from "@/lib/media/video-coordinator";
import type { PostCard } from "@/lib/social/posts";
import { cn } from "@/lib/utils";

/**
 * Fullscreen in-profile video player over the profile's videos. Plays the tapped
 * clip uncut (object-contain) with its cover as the poster, auto-advances when it
 * ends, supports swipe up/down, press-hold to pause, and links to the full post
 * for likes/comments. Keeps people watching without leaving the profile.
 */
export function ProfileVideoPlayer({
  posts,
  startIndex = 0,
  onClose,
}: {
  posts: PostCard[] | null;
  startIndex?: number;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {posts && posts.length ? <Inner key="pvp" posts={posts} startIndex={startIndex} onClose={onClose} /> : null}
    </AnimatePresence>
  );
}

function Inner({ posts, startIndex, onClose }: { posts: PostCard[]; startIndex: number; onClose: () => void }) {
  const [index, setIndex] = useState(Math.min(Math.max(0, startIndex), posts.length - 1));
  const video = useRef<HTMLVideoElement | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ui, setUi] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const post = posts[index]!;
  const hasNext = index < posts.length - 1;

  const goNext = useCallback(() => setIndex((i) => (i < posts.length - 1 ? i + 1 : i)), [posts.length]);
  const goPrev = useCallback(() => setIndex((i) => (i > 0 ? i - 1 : i)), []);

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
    scheduleHide();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (video.current) releasePlayback(video.current);
    };
  }, [onClose, scheduleHide]);

  const onPointerDown = (e: React.PointerEvent) => {
    startPt.current = { x: e.clientX, y: e.clientY };
    holding.current = false;
    holdTimer.current = setTimeout(() => {
      holding.current = true;
      video.current?.pause();
      setPaused(true);
    }, 160);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const dy = startPt.current ? e.clientY - startPt.current.y : 0;
    const dx = startPt.current ? e.clientX - startPt.current.x : 0;
    startPt.current = null;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (holding.current) {
      holding.current = false;
      void video.current?.play();
      setPaused(false);
      return;
    }
    if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx)) {
      if (dy < 0) goNext();
      else goPrev();
      return;
    }
    toggleUi();
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
      aria-label={post.title}
    >
      <div className={cn("absolute inset-x-0 top-0 z-30 h-0.5 bg-white/15 transition-opacity duration-200", ui ? "opacity-100" : "opacity-0")}>
        <div className="h-full bg-white" style={{ width: `${progress}%` }} />
      </div>

      {/* Back — always visible */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Back"
        className="absolute left-4 top-4 z-40 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>

      <div
        className="absolute inset-0 flex items-center justify-center"
        onPointerDown={onPointerDown}
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
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={video}
          key={post.id}
          src={post.mediaUrl!}
          poster={post.thumbnailUrl ?? undefined}
          autoPlay
          loop={!hasNext}
          playsInline
          className="max-h-full max-w-full object-contain"
          onPlay={() => {
            video.current && claimPlayback(video.current);
            recordView(post.id);
          }}
          onEnded={() => hasNext && goNext()}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (v.duration) setProgress((v.currentTime / v.duration) * 100);
          }}
        />
        {paused ? (
          <span className="pointer-events-none absolute flex h-16 w-16 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur">
            <Pause className="h-7 w-7 fill-white" />
          </span>
        ) : null}
      </div>

      {/* Caption + open post (auto-hides) */}
      <div className={cn("absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-4 pb-8 pt-16 transition-opacity duration-200", ui ? "opacity-100" : "pointer-events-none opacity-0")}>
        {post.title ? <p className="line-clamp-2 max-w-md text-sm font-medium text-white/90">{post.title}</p> : null}
        <Link
          href={`/p/${post.id}`}
          onClick={onClose}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-white/25"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Open post
        </Link>
      </div>
    </motion.div>
  );
}
