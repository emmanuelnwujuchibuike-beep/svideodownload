"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  BadgeCheck,
  Bookmark,
  Check,
  Download,
  Heart,
  Loader2,
  MessageCircle,
  Pencil,
  Play,
  Share2,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { WowOutline, WowSolid } from "@/components/brand/wow-icon";
import { SmartVideo } from "@/features/media/smart-video";
import { Comments } from "@/features/social/comments";
import { PostEditSheet } from "@/features/social/post-edit-sheet";
import { useEntitlements } from "@/features/auth/use-entitlements";
import { downloadPost } from "@/lib/media/download-post";
import type { CommentNode } from "@/lib/social/engagement";
import { toggleFollow as toggleFollowShared, useFollowState } from "@/lib/social/follow-store";
import type { FeedItem } from "@/lib/social/home-feed";
import { cn, formatCompactNumber } from "@/lib/utils";

/** Builds a native device-download URL: the stored file when available, else
 *  an on-demand stream via the existing worker pipeline ("best" selector). */
function downloadHref(item: FeedItem): string {
  if (item.mediaUrl) return item.mediaUrl;
  const selector = item.mediaKind === "audio" ? "bestaudio" : "best";
  const sp = new URLSearchParams({ url: item.sourceUrl, formatId: selector, kind: item.mediaKind, title: item.title });
  return `/api/download?${sp.toString()}`;
}

interface CommentsData {
  comments: CommentNode[];
  canComment: boolean;
  loggedIn: boolean;
}

/** Fullscreen in-place post viewer — plays inline (no navigation), with a
 *  premium back button and comments loaded on demand. */
export function PostViewer({
  item,
  startWithComments = false,
  onClose,
}: {
  item: FeedItem | null;
  startWithComments?: boolean;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {item ? <ViewerInner key={item.id} item={item} startWithComments={startWithComments} onClose={onClose} /> : null}
    </AnimatePresence>
  );
}

function ViewerInner({
  item,
  startWithComments,
  onClose,
}: {
  item: FeedItem;
  startWithComments: boolean;
  onClose: () => void;
}) {
  const { isPremium } = useEntitlements();
  const [liked, setLiked] = useState(item.viewerLiked);
  const [saved, setSaved] = useState(item.viewerSaved);
  const following = useFollowState(item.publisher.id, item.isFollowing);
  const [likes, setLikes] = useState(item.likesCount);
  const [title, setTitle] = useState(item.title);
  const [editOpen, setEditOpen] = useState(false);
  const [showComments, setShowComments] = useState(startWithComments);
  const [comments, setComments] = useState<CommentsData | null>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const fetched = useRef(false);

  // Lock body scroll + close on Escape. overflowY only — the `overflow`
  // shorthand also resets overflow-x, undoing the `overflow-x: clip` on <body>
  // that keeps the app sidebar sticky (it would otherwise scroll away).
  useEffect(() => {
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflowY = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

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

  useEffect(() => {
    if (showComments) void loadComments();
  }, [showComments, loadComments]);

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
    await toggleFollowShared(item.publisher.id, !following);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      // On large screens this sits BESIDE the app sidebar (which stays visible +
      // scrollable, same as every other page) instead of covering it.
      className="fixed inset-0 z-[80] flex flex-col bg-black/95 backdrop-blur-sm lg:left-64 lg:flex-row"
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
    >
      {/* Premium back button — closes instantly, no page load */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Back"
        className="fixed left-4 top-4 z-[90] inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white shadow-lg backdrop-blur-md transition hover:bg-white/20 active:scale-95"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {/* Media */}
      <motion.div
        initial={{ scale: 0.96 }}
        animate={{ scale: 1 }}
        className="flex min-h-0 flex-1 items-center justify-center p-0 lg:p-6"
      >
        {item.mediaKind === "video" && (item.streamUid || item.mediaUrl) ? (
          <div className="flex max-h-full w-full max-w-5xl items-center justify-center bg-black lg:rounded-2xl">
            <SmartVideo
              streamUid={item.streamUid}
              src={item.mediaUrl}
              poster={item.thumbnailUrl}
              controls
              autoPlay
              className={cn(item.streamUid ? "aspect-video" : "max-h-full", "lg:rounded-2xl")}
            />
          </div>
        ) : item.mediaKind === "audio" && item.mediaUrl ? (
          <div className="w-full max-w-xl rounded-2xl bg-gradient-to-br from-blue-600 to-violet-700 p-8 text-white">
            {item.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumbnailUrl} alt="" className="mx-auto mb-5 h-40 w-40 rounded-2xl object-cover shadow-xl" />
            ) : null}
            <p className="mb-3 text-center font-semibold">{item.title}</p>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio src={item.mediaUrl} controls autoPlay className="w-full" />
          </div>
        ) : item.mediaKind === "image" && item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumbnailUrl} alt={item.title} className="max-h-full max-w-full object-contain lg:rounded-2xl" />
        ) : (
          <div className="relative aspect-video w-full max-w-4xl overflow-hidden bg-neutral-900 lg:rounded-2xl">
            {item.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
            ) : null}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/45 text-white">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur">
                <Play className="h-7 w-7 fill-white" />
              </span>
              <p className="text-sm font-medium">Preparing this video for playback…</p>
              {isPremium ? (
                <a
                  href={downloadHref(item)}
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-900"
                >
                  <Download className="h-4 w-4" /> Download
                </a>
              ) : (
                <Link href="/pricing" className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-900">
                  Go Pro to download
                </Link>
              )}
            </div>
          </div>
        )}
      </motion.div>

      {/* Details / comments panel */}
      <motion.aside
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.05 }}
        className="flex max-h-[55vh] w-full shrink-0 flex-col overflow-y-auto rounded-t-3xl bg-card p-5 lg:max-h-none lg:w-[400px] lg:rounded-none lg:rounded-l-3xl"
      >
        {/* Publisher */}
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
              {item.publisher.isVerified ? <BadgeCheck className="h-4 w-4 shrink-0 text-primary" /> : null}
            </span>
            <span className="block truncate text-sm text-muted-foreground">@{item.publisher.handle}</span>
          </Link>
          {item.isOwner ? (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-secondary/70"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          ) : (
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
          )}
        </div>

        {/* Title + description */}
        {title ? <h2 className="mt-4 text-base font-bold leading-snug">{title}</h2> : null}
        {item.description ? (
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{item.description}</p>
        ) : null}

        {/* Actions */}
        <div className="mt-4 flex items-center gap-1 border-y border-border/50 py-1.5">
          <Act icon={liked ? WowSolid : WowOutline} label="Wow" active={liked} activeClass="text-violet-500" count={likes} onClick={() => react("like")} />
          <Act icon={MessageCircle} label="Comments" count={item.commentsCount} onClick={() => setShowComments(true)} />
          <Act icon={Share2} label="Share" count={item.sharesCount} onClick={share} />
          <Act icon={Bookmark} label="Save" active={saved} fill={saved} activeClass="text-primary" onClick={() => react("save")} />
          {item.platform === "frenz" && item.mediaUrl ? (
            // Frenz-hosted post → direct download (free members get 5/day).
            <button
              type="button"
              onClick={() => downloadPost({ id: item.id, mediaUrl: item.mediaUrl, title })}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-muted-foreground transition hover:bg-secondary"
              aria-label="Download to device"
            >
              <Download className="h-[18px] w-[18px]" />
            </button>
          ) : isPremium ? (
            <a
              href={downloadHref(item)}
              onClick={() => fetch(`/api/posts/${item.id}/event`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "download" }) }).catch(() => {})}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-muted-foreground transition hover:bg-secondary"
              aria-label="Download to device"
            >
              <Download className="h-[18px] w-[18px]" />
            </a>
          ) : (
            <Link
              href="/pricing"
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-amber-500 transition hover:bg-secondary"
              aria-label="Go Pro to download"
            >
              <Download className="h-[18px] w-[18px]" /> Pro
            </Link>
          )}
        </div>

        {/* Comments — on demand */}
        {showComments ? (
          loadingComments ? (
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
          ) : null
        ) : (
          <button
            type="button"
            onClick={() => setShowComments(true)}
            className="mt-4 w-full rounded-xl bg-secondary py-2.5 text-sm font-semibold transition hover:bg-secondary/70"
          >
            View comments{item.commentsCount > 0 ? ` (${formatCompactNumber(item.commentsCount)})` : ""}
          </button>
        )}
      </motion.aside>

      {item.isOwner ? (
        <PostEditSheet
          item={{ id: item.id, title: title ?? "" }}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={(p) => setTitle(p.title)}
          onDeleted={onClose}
        />
      ) : null}
    </motion.div>
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
  onClick: () => void;
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
      {count !== undefined && count > 0 ? <span className="text-xs font-medium tabular-nums">{formatCompactNumber(count)}</span> : null}
    </button>
  );
}
