"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, Download, Heart, MessageCircle, Share2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { RichText } from "@/components/social/rich-text";
import { Comments } from "@/features/social/comments";
import { downloadPost } from "@/lib/media/download-post";
import { loadPostComments, prefetchPostComments } from "@/lib/social/comments-cache";
import type { CommentNode } from "@/lib/social/engagement";
import type { FeedItem } from "@/lib/social/home-feed";
import { cn, formatCompactNumber } from "@/lib/utils";

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
export function ImageViewer({ item, onClose }: { item: FeedItem | null; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>{item ? <ImageStage key={item.id} item={item} onClose={onClose} /> : null}</AnimatePresence>,
    document.body,
  );
}

function ImageStage({ item, onClose }: { item: FeedItem; onClose: () => void }) {
  const src = item.mediaUrl || item.thumbnailUrl || "";
  const [ui, setUi] = useState(true);
  const [liked, setLiked] = useState(item.viewerLiked);
  const [saved, setSaved] = useState(item.viewerSaved);
  const [likes, setLikes] = useState(item.likesCount);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<CommentsData | null>(null);
  const [burst, setBurst] = useState<{ x: number; y: number; key: number } | null>(null);
  const lastTap = useRef(0);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    prefetchPostComments(item.id);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
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

  const share = async () => {
    const url = `${window.location.origin}/p/${item.id}`;
    try {
      if (navigator.share) await navigator.share({ title: item.title, url });
      else await navigator.clipboard.writeText(url);
    } catch {
      /* cancelled */
    }
    fetch(`/api/posts/${item.id}/event`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "share" }) }).catch(() => {});
  };

  const openComments = useCallback(async () => {
    setShowComments(true);
    if (!comments) {
      const data = await loadPostComments<CommentsData>(item.id);
      if (data) setComments(data);
    }
  }, [comments, item.id]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[85] bg-black lg:left-64"
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
    >
      <button type="button" onClick={onClose} aria-label="Close" className="absolute left-4 top-4 z-[60] flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition hover:bg-black/60 active:scale-95">
        <X className="h-5 w-5" />
      </button>

      {/* Image — swipe down to dismiss (X/IG style) */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        onPointerDown={(e) => (startY.current = e.clientY)}
        onPointerUp={(e) => {
          if (startY.current !== null && e.clientY - startY.current > 90) onClose();
          else onImgPointerUp(e);
          startY.current = null;
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={item.title} className="max-h-full max-w-full select-none object-contain" draggable={false} />
      </div>

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
            <Heart className="h-16 w-16 fill-rose-500 text-rose-500 drop-shadow-[0_2px_12px_rgba(244,63,94,0.6)]" />
          </motion.span>
        ) : null}
      </AnimatePresence>

      {/* Caption + author (auto-hides) */}
      <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-16 transition-opacity duration-200", ui ? "opacity-100" : "opacity-0")}>
        <Link href={`/u/${item.publisher.handle}`} onClick={onClose} className="pointer-events-auto inline-flex items-center gap-1.5 font-bold text-white">
          @{item.publisher.handle}
        </Link>
        {item.title ? (
          <p className="mt-1.5 line-clamp-3 max-w-xl text-sm text-white/90">
            <RichText text={item.title} linkClassName="font-semibold text-white hover:underline" />
          </p>
        ) : null}
      </div>

      {/* Action rail (auto-hides; outside the image on lg) */}
      <div className={cn("absolute bottom-24 right-3 z-30 flex flex-col items-center gap-5 transition-opacity duration-200 sm:bottom-8 lg:-right-[4.5rem] lg:!opacity-100", ui ? "opacity-100" : "pointer-events-none opacity-0")}>
        <RailBtn icon={Heart} active={liked} fill={liked} activeClass="text-rose-500" count={likes} label="Like" onClick={() => react("like")} />
        <RailBtn icon={MessageCircle} count={item.commentsCount} label="Comments" onClick={openComments} />
        <RailBtn icon={Share2} count={item.sharesCount} label="Share" onClick={share} />
        <RailBtn icon={Bookmark} active={saved} fill={saved} activeClass="text-amber-400" label="Save" onClick={() => react("save")} />
        <RailBtn icon={Download} label="Download" onClick={() => downloadPost({ id: item.id, mediaUrl: item.mediaUrl, title: item.title })} />
      </div>

      {/* Comments sheet */}
      <AnimatePresence>
        {showComments ? (
          <>
            <button type="button" aria-label="Close comments" onClick={() => setShowComments(false)} className="absolute inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 380, damping: 36 }} className="absolute inset-x-0 bottom-0 z-50 mx-auto flex h-[68vh] max-w-2xl flex-col rounded-t-3xl border-t border-white/10 bg-card/95 shadow-[0_-8px_40px_rgba(0,0,0,0.35)] backdrop-blur-2xl">
              <div className="shrink-0 px-5 pt-3">
                <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" />
                <h3 className="text-sm font-bold">Comments{item.commentsCount > 0 ? ` · ${formatCompactNumber(item.commentsCount)}` : ""}</h3>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-1">
                {comments ? (
                  <Comments postId={item.id} comments={comments.comments} loggedIn={comments.loggedIn} canComment={comments.canComment} disabledReason={comments.canComment ? null : "Comments are unavailable."} count={item.commentsCount} variant="sheet" />
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
                )}
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

function RailBtn({ icon: Icon, count, active, fill, activeClass, label, onClick }: { icon: typeof Heart; count?: number; active?: boolean; fill?: boolean; activeClass?: string; label: string; onClick: () => void }) {
  return (
    <motion.button type="button" onClick={onClick} aria-label={label} aria-pressed={active} whileTap={{ scale: 0.86 }} transition={{ type: "spring", stiffness: 520, damping: 22 }} className="flex flex-col items-center gap-1 text-white">
      <span className={cn("flex h-12 w-12 items-center justify-center rounded-full bg-white/10 ring-1 ring-inset ring-white/15 backdrop-blur-md transition-colors", active && "bg-white/15 ring-white/25")}>
        <Icon className={cn("h-6 w-6 drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]", fill && "fill-current", active && activeClass)} strokeWidth={2.1} />
      </span>
      {count !== undefined && count > 0 ? <span className="text-[11px] font-bold tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">{formatCompactNumber(count)}</span> : null}
    </motion.button>
  );
}
