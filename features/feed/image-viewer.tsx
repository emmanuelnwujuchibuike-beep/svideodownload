"use client";

import { AnimatePresence, motion } from "framer-motion";
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
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { WowOutline, WowSolid } from "@/components/brand/wow-icon";
import { RichText } from "@/components/social/rich-text";
import { AnimatedCount } from "@/features/ui/animated-count";
import { floatReaction } from "@/features/ui/reaction-float";
import { CollectionPicker } from "@/features/social/collection-picker";
import { Comments } from "@/features/social/comments";
import { PostEditSheet } from "@/features/social/post-edit-sheet";
import { ReportSheet } from "@/features/social/report-sheet";
import { toast } from "@/features/ui/toast";
import { downloadPost } from "@/lib/media/download-post";
import { toggleFollow as toggleFollowShared, useFollowState } from "@/lib/social/follow-store";
import { springs } from "@/lib/motion/springs";
import { loadPostComments, prefetchPostComments } from "@/lib/social/comments-cache";
import type { CommentNode } from "@/lib/social/engagement";
import type { FeedItem } from "@/lib/social/home-feed";
import { cn, formatCompactNumber, formatPostedOn } from "@/lib/utils";

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
      {item ? <ImageStage key={item.id} item={item} startIndex={startIndex} autoOpenComments={autoOpenComments} onClose={onClose} /> : null}
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerReady, setPickerReady] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editReady, setEditReady] = useState(false);
  const lastTap = useRef(0);
  const startY = useRef<number | null>(null);

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

  const share = async () => {
    const url = `${window.location.origin}/p/${item.id}`;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else await navigator.clipboard.writeText(url);
    } catch {
      /* cancelled */
    }
    fetch(`/api/posts/${item.id}/event`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "share" }) }).catch(() => {});
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
      className="fixed inset-0 z-[85] flex bg-black lg:left-64"
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
    >
      {/* `lg:pr-24` reserves a real gutter on large screens so the action rail
          (below) never overlaps the comments sidebar — mirrors the reel
          viewer's column-vs-gutter split, just via padding since a single
          image (unlike the reel's height-capped column) has no natural gap of
          its own. Absolute children position relative to this padding box, so
          the image/caption also recenter within the narrower space. */}
      <div className="relative h-full flex-1 lg:pr-24">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-[60] flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition hover:bg-black/60 active:scale-95">
          <X className="h-5 w-5" />
        </button>

        {/* Options — top-right, mirroring the close (X) button at top-left,
            same as reels. Always visible (not gated by `ui`). */}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="More options"
          className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-[60] flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition hover:bg-black/60 active:scale-95"
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
            onDismiss={onClose}
          />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center"
            onPointerDown={(e) => (startY.current = e.clientY)}
            onPointerUp={(e) => {
              if (startY.current !== null && e.clientY - startY.current > 90) onClose();
              else onImgPointerUp(e);
              startY.current = null;
            }}
          >
            {/* Always object-contain — tapping a photo to "view" it must show
                the WHOLE picture, never a cropped fill. (An earlier full-bleed
                object-cover rule cropped near-screen-aspect photos, so the
                edges were cut off — it read as "the picture doesn't show
                full".) A blurred backdrop still fills the letterbox space. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={title}
              className="max-h-full max-w-full select-none object-contain"
              draggable={false}
            />
            {/* blurred fill behind the letterbox so a photo whose shape doesn't
                match the screen never sits on plain black */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" aria-hidden className="pointer-events-none absolute inset-0 -z-10 h-full w-full scale-110 object-cover opacity-30 blur-2xl" />
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
        <AnimatePresence>
          {showComments ? (
            <div className="lg:hidden">
              <button type="button" aria-label="Close comments" onClick={() => setShowComments(false)} className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
              <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 380, damping: 36 }} className="fixed inset-x-0 bottom-0 z-50 mx-auto flex h-[68vh] max-w-2xl flex-col rounded-t-3xl border-t border-white/10 bg-card/95 shadow-[0_-8px_40px_rgba(0,0,0,0.35)] backdrop-blur-2xl">
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
            </div>
          ) : null}
        </AnimatePresence>
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
              {item.publisher.isVerified ? <BadgeCheck className="h-4 w-4 shrink-0 text-primary" /> : null}
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

      <ReportSheet targetType="post" targetId={item.id} open={reportOpen} onClose={() => setReportOpen(false)} />
    </motion.div>
  );
}

/**
 * Fullscreen album — swipes horizontally through every photo/video of a
 * multi-media post, opening on the exact slide that was tapped (never
 * always the first). Reuses the same tap/double-tap/swipe-down-to-dismiss
 * gesture model as a single photo: a tap toggles the chrome, a double-tap
 * likes the post (comments/likes/caption stay post-level, matching how
 * Instagram/TikTok carousel posts work — one thread for the whole post).
 */
function AlbumSwipe({
  items,
  startIndex,
  onIndexChange,
  onTap,
  onDoubleTap,
  onDismiss,
}: {
  items: NonNullable<FeedItem["mediaItems"]>;
  startIndex: number;
  onIndexChange: (i: number) => void;
  onTap: () => void;
  onDoubleTap: (x: number, y: number) => void;
  onDismiss: () => void;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(startIndex);
  const raf = useRef(0);
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const lastTap = useRef(0);

  // Sequential/priority loading (same fix as the feed's inline MediaCarousel
  // — see [[media-zoom-scroll-fixes]]): every slide used to mount its real
  // <img>/<video> src unconditionally the instant this viewer opened, so an
  // album with many photos fired that many simultaneous requests and the ONE
  // slide the user actually tapped competed with all the others for the
  // browser's connection cap. Only the tapped slide + its immediate
  // neighbours load at first; more unlock (and stay unlocked) as you swipe.
  const [unlocked, setUnlocked] = useState<Set<number>>(() => new Set([startIndex - 1, startIndex, startIndex + 1].filter((i) => i >= 0 && i < items.length)));
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
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!startPt.current || moved.current) return;
    if (Math.abs(e.clientX - startPt.current.x) > 10 || Math.abs(e.clientY - startPt.current.y) > 10) moved.current = true;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = startPt.current;
    startPt.current = null;
    if (moved.current) {
      // A real drag: a mostly-VERTICAL downward swipe dismisses (same as a
      // single photo); a mostly-horizontal one is the album's own native
      // swipe-between-slides — never misread as a tap or a dismiss.
      if (start) {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.abs(dy) > Math.abs(dx) && dy > 90) onDismiss();
      }
      return;
    }
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

  return (
    <div className="absolute inset-0" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div
        ref={scroller}
        onScroll={onScroll}
        data-hscroll
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ touchAction: "pan-x" }}
      >
        {items.map((m, i) => {
          const loaded = isNear(i) || unlocked.has(i);
          return (
            <div key={i} className="relative flex h-full w-full shrink-0 snap-center items-center justify-center">
              {!loaded ? (
                <div className="absolute inset-0 bg-black" />
              ) : (
                <>
                  {/* blurred fill so a slide whose shape doesn't match the screen never letterboxes onto plain black */}
                  {(m.thumbnailUrl ?? (m.kind === "image" ? m.url : null)) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={(m.thumbnailUrl ?? m.url)!}
                      alt=""
                      aria-hidden
                      loading="eager"
                      decoding="async"
                      className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-2xl"
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
                      className="relative max-h-full max-w-full select-none object-contain"
                      ref={(el) => {
                        if (!el) return;
                        // Autoplay only while this slide is the active one.
                        if (i === index) void el.play().catch(() => {});
                        else el.pause();
                      }}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt="" draggable={false} loading="eager" className="relative max-h-full max-w-full select-none object-contain" />
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Counter + dots — placed just under the top X / More buttons so they
          never collide with the bottom caption/action rail. */}
      <div className="pointer-events-none absolute inset-x-0 top-[calc(max(1rem,env(safe-area-inset-top))+3.25rem)] z-[55] flex flex-col items-center gap-2">
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
