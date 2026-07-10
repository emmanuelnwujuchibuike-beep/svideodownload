"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  Ban,
  BellOff,
  Bookmark,
  Check,
  Download,
  EyeOff,
  Flag,
  FolderPlus,
  Heart,
  Link as LinkIcon,
  MessageCircle,
  MoreHorizontal,
  Music,
  Pencil,
  Play,
  Repeat2,
  Send as SendIcon,
  Share2,
  Sparkles,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { memo, useRef, useState } from "react";

import { WowOutline, WowSolid } from "@/components/brand/wow-icon";
import { RichText } from "@/components/social/rich-text";
import { PostPollInline } from "@/features/social/post-poll-inline";
import { AnimatedCount } from "@/features/ui/animated-count";
import { FeedImage } from "@/features/media/feed-image";
import { FeedVideo } from "@/features/media/feed-video";
import { MediaCarousel } from "@/features/media/media-carousel";
import dynamic from "next/dynamic";
import Image from "next/image";

import { makeEmotionIcon, reactionGlyph, ReactionPicker, type ReactionEmotion } from "@/features/social/reaction-picker";
import { RepostBurst } from "@/features/social/repost-burst";
import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";

// These sheets appear only on interaction (edit / save-to-collection / repost)
// and this card renders many times per feed — code-split so they never weigh
// down the feed.
const CollectionPicker = dynamic(() => import("@/features/social/collection-picker").then((m) => m.CollectionPicker), { ssr: false });
const PostEditSheet = dynamic(() => import("@/features/social/post-edit-sheet").then((m) => m.PostEditSheet), { ssr: false });
const RepostComposer = dynamic(() => import("@/features/social/repost-composer").then((m) => m.RepostComposer), { ssr: false });
const RepostOptionsSheet = dynamic(() => import("@/features/social/repost-options").then((m) => m.RepostOptionsSheet), { ssr: false });
const RepostersSheet = dynamic(() => import("@/features/social/reposters-sheet").then((m) => m.RepostersSheet), { ssr: false });
const ShareSheet = dynamic(() => import("@/features/social/share-sheet").then((m) => m.ShareSheet), { ssr: false });
import { floatReaction } from "@/features/ui/reaction-float";
import { useLongPress } from "@/lib/hooks/use-long-press";
import { downloadPost } from "@/lib/media/download-post";
import { prefetchPostComments } from "@/lib/social/comments-cache";
import { FrenzsaveError } from "@/lib/sdk";
import { toggleFollow as toggleFollowShared, useFollowState } from "@/lib/social/follow-store";
import { toggleRepost, useRepostState } from "@/lib/social/repost-store";
import type { FeedItem } from "@/lib/social/home-feed";
import type { SmartReason, SmartReasonTone } from "@/lib/social/smart-feed";
import { cn, formatCompactNumber, formatDuration } from "@/lib/utils";

const REASON_STYLE: Record<SmartReasonTone, string> = {
  follow: "text-blue-500 dark:text-blue-300",
  fresh: "text-emerald-500 dark:text-emerald-300",
  hot: "text-rose-500 dark:text-rose-300",
  download: "text-teal-500 dark:text-teal-300",
  interest: "text-violet-500 dark:text-violet-300",
};

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function FeedPostCardImpl({
  item,
  reason,
  onRemove,
  onOpen,
}: {
  item: FeedItem;
  reason?: SmartReason | null;
  onRemove: (id: string) => void;
  onOpen: (item: FeedItem, startComments?: boolean, startIndex?: number) => void;
}) {
  const [liked, setLiked] = useState(item.viewerLiked);
  const [saved, setSaved] = useState(item.viewerSaved);
  const following = useFollowState(item.publisher.id, item.isFollowing);
  const repostState = useRepostState(item.id, item.viewerReposted ?? false, item.repostsCount ?? 0);
  const [likes, setLikes] = useState(item.likesCount);
  const articleRef = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [editOpen, setEditOpen] = useState(false);
  const [repostBurst, setRepostBurst] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<"create" | "edit">("create");
  const [composerCaption, setComposerCaption] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [repostersOpen, setRepostersOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareReady, setShareReady] = useState(false);
  // Long-press Wow → the reaction picker; the picked glyph replaces the icon.
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [myEmotion, setMyEmotion] = useState<string | null>(item.viewerReactionEmotion ?? null);
  const wowPress = useLongPress(() => setReactionsOpen(true));
  // Gate the code-split sheets: mount only after first open (keeps their chunks
  // out of the feed until actually needed, then stays mounted for exit animations).
  const [editReady, setEditReady] = useState(false);
  const [pickerReady, setPickerReady] = useState(false);
  const [composerReady, setComposerReady] = useState(false);
  const [optionsReady, setOptionsReady] = useState(false);
  const [repostersReady, setRepostersReady] = useState(false);

  // Holding the Repost button opens the advanced options sheet.
  const repostPress = useLongPress(() => {
    setOptionsReady(true);
    setOptionsOpen(true);
  });

  // Plain toggle (Save, and the base Like on/off) — unchanged behavior.
  const react = async (type: "like" | "save") => {
    const isLike = type === "like";
    const cur = isLike ? liked : saved;
    const next = !cur;
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
      // rollback
      if (isLike) {
        setLiked(cur);
        setLikes((n) => n + (next ? -1 : 1));
      } else setSaved(cur);
    }
  };

  // Reaction picker: always ends in a Wow (liked=true) with a specific flavor,
  // whether this is a fresh like or the user is just changing their flavor.
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
    const url = `${window.location.origin}/p/${item.id}`;
    try {
      if (navigator.share) await navigator.share({ title: item.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Link copied.", "success");
      }
    } catch {
      /* user cancelled */
    }
    fetch(`/api/posts/${item.id}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "share" }),
    }).catch(() => {});
  };

  const copyLink = async () => {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/p/${item.id}`);
      toast("Link copied.", "success");
    } catch {
      toast("Couldn't copy the link.", "error");
    }
  };

  const toggleFollow = async () => {
    setBusy(true);
    try {
      // Shared store updates every card/reel for this creator at once.
      await toggleFollowShared(item.publisher.id, !following);
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  };

  // Repost is a recommendation, never a one-tap accident: opens the composer
  // (quick "Post Now" or an optional caption). Tapping again undoes it.
  const repost = async () => {
    setMenuOpen(false);
    if (!repostState.reposted) {
      openComposer("create", null);
      return;
    }
    try {
      await toggleRepost(item.id, false, repostState.count);
      toast("Removed repost.", "success");
    } catch (e) {
      toast(e instanceof FrenzsaveError ? e.message : "Couldn't repost.", "error");
    }
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

  const report = async () => {
    setMenuOpen(false);
    try {
      await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "post", targetId: item.id, reason: "inappropriate" }),
      });
    } catch {
      /* ignore */
    }
    onRemove(item.id);
  };

  // Softer than Hide/Not interested: their posts stop appearing in YOUR feed
  // going forward, silently — nothing severed, they're never notified.
  const muteCreator = async () => {
    setMenuOpen(false);
    try {
      const r = await fetch(`/api/mute/${item.publisher.id}`, { method: "POST" });
      if (!r.ok) throw new Error();
      toast(`Muted @${item.publisher.handle} — you won't see their posts in your feed.`, "success");
      onRemove(item.id);
    } catch {
      toast("Couldn't mute.", "error");
    }
  };

  return (
    <motion.article
      ref={articleRef}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      // Framer-motion leaves an inline `transform` on this element even once
      // settled at rest — and ANY transform on an ancestor turns descendant
      // `position: fixed` elements (the video's fullscreen promotion) into
      // ones anchored to THIS card's box instead of the true viewport. Once
      // the entrance animation actually finishes, strip it — there is no
      // other reason for this card to carry a transform afterward.
      onAnimationComplete={() => {
        if (articleRef.current) articleRef.current.style.transform = "";
      }}
      // Warm this post's comments on hover so opening the sheet is instant.
      onPointerEnter={() => prefetchPostComments(item.id)}
      // Mature, professional card: quiet hairline border + soft depth, no
      // decorative color bars — the content is the color (owner spec).
      className="group relative cv-auto overflow-hidden rounded-3xl border border-border/70 bg-card shadow-soft ring-1 ring-inset ring-white/[0.04] transition-shadow duration-300 hover:shadow-elevated"
    >
      {/* Repost discovery — lightweight "@x reposted" attribution when someone you
          follow reposted this, plus their recommendation caption when they wrote
          one. Never distracts from the content below. */}
      {item.repostBadge && item.repostBadge.count > 0 ? (
        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={() => {
              setRepostersReady(true);
              setRepostersOpen(true);
            }}
            className="flex w-full items-center gap-2 text-left text-xs font-medium text-muted-foreground transition hover:text-foreground"
          >
            <Repeat2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
            {item.repostBadge.avatars[0] ? (
              <Image src={item.repostBadge.avatars[0]} alt="" width={16} height={16} className="h-4 w-4 rounded-full object-cover ring-1 ring-border" />
            ) : null}
            <span className="truncate">
              {item.repostBadge.count > 3
                ? "Recommended by people you follow"
                : `@${item.repostBadge.handles[0]}${item.repostBadge.count > 1 ? ` and ${item.repostBadge.count - 1} other${item.repostBadge.count > 2 ? "s" : ""}` : ""} reposted`}
            </span>
          </button>
          {item.repostBadge.caption ? (
            <p className="mt-1.5 border-l-2 border-emerald-500/40 pl-2.5 text-[13px] leading-relaxed text-foreground/90">
              <RichText text={item.repostBadge.caption} />
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Header */}
      <div className="flex items-center gap-3 p-4 pb-3 sm:p-5 sm:pb-3">
        <Link href={`/u/${item.publisher.handle}`} className="shrink-0 rounded-full bg-gradient-to-br from-primary/70 to-accent/70 p-[2px] transition-transform duration-300 group-hover:scale-105">
          {item.publisher.avatarUrl ? (
            <Image src={item.publisher.avatarUrl} alt="" width={44} height={44} className="h-11 w-11 rounded-full object-cover ring-2 ring-card" />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-base font-bold text-white ring-2 ring-card">
              {item.publisher.displayName.charAt(0).toUpperCase()}
            </span>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/u/${item.publisher.handle}`} className="flex items-center gap-1 text-[15px] font-semibold leading-tight hover:underline">
            <span className="truncate">{item.publisher.displayName}</span>
            {item.publisher.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
          </Link>
          <p className="text-xs text-muted-foreground">@{item.publisher.handle} · {timeAgo(item.createdAt)}</p>
        </div>

        {!item.isOwner ? (
          <button
            type="button"
            onClick={toggleFollow}
            disabled={busy}
            className={cn(
              "hidden items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 sm:inline-flex",
              following ? "bg-secondary text-foreground" : "bg-gradient-to-r from-blue-600 to-violet-600 text-white hover:opacity-95",
            )}
          >
            {following ? <Check className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
            {following ? "Following" : "Follow"}
          </button>
        ) : null}

        {/* Overflow menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Post options"
            aria-expanded={menuOpen}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
          <AnimatePresence>
            {menuOpen ? (
              <>
                <button type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="absolute right-0 z-50 mt-1 w-48 overflow-hidden rounded-xl border border-border/70 bg-card py-1 shadow-elevated"
                >
                  <MenuItem icon={Share2} label="Share" onClick={() => { setMenuOpen(false); void share(); }} />
                  <MenuItem icon={LinkIcon} label="Copy link" onClick={copyLink} />
                  <MenuItem icon={Download} label="Download" onClick={() => { setMenuOpen(false); void downloadPost({ id: item.id, mediaUrl: item.mediaUrl, title }); }} />
                  {item.isOwner ? (
                    <MenuItem icon={Pencil} label="Edit post" onClick={() => { setMenuOpen(false); setEditReady(true); setEditOpen(true); }} />
                  ) : null}
                  {!item.isOwner ? (
                    <>
                      <MenuItem icon={UserPlus} label={following ? "Unfollow creator" : "Follow creator"} onClick={toggleFollow} />
                      <MenuItem icon={BellOff} label="Mute creator" onClick={muteCreator} />
                    </>
                  ) : null}
                  <MenuItem icon={FolderPlus} label="Save to collection" onClick={() => { setMenuOpen(false); setPickerReady(true); setPickerOpen(true); }} />
                  <MenuItem icon={EyeOff} label="Hide this post" onClick={() => onRemove(item.id)} />
                  <MenuItem icon={Ban} label="Not interested" onClick={() => onRemove(item.id)} />
                  <MenuItem icon={Flag} label="Report" danger onClick={report} />
                </motion.div>
              </>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* Smart Explanation — why this is in your feed */}
      {reason ? (
        <div className="px-4 pb-1">
          <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold", REASON_STYLE[reason.tone])}>
            <Sparkles aria-hidden className="h-3 w-3" />
            {reason.label}
          </span>
        </div>
      ) : null}

      {/* Caption */}
      {title ? (
        <div className="px-4 pb-3 sm:px-5">
          <p className="text-[15px] leading-relaxed">
            <RichText text={title} />
          </p>
          {item.category ? (
            <Link href={`/explore?q=${encodeURIComponent(`#${item.category}`)}`} className="mt-1 inline-block text-xs font-medium text-primary hover:underline">
              #{item.category}
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* Poll (vote) — below the caption */}
      {item.hasPoll ? (
        <div className="px-4 pb-3">
          <PostPollInline postId={item.id} />
        </div>
      ) : null}

      {/* Media — taller/bigger than a typical compact card (closer to X/
          Instagram's large feed previews) so video/photo posts read as the
          hero of the card, not a thumbnail. */}
      {item.mediaItems && item.mediaItems.length > 1 ? (
        /* Album / carousel — swipeable slides with counter + dots */
        <div className="mx-4 mb-3 overflow-hidden rounded-2xl sm:mx-5">
          <MediaCarousel
            items={item.mediaItems}
            onExpandItem={(index) => onOpen(item, false, index)}
            liked={liked}
            onDoubleTapLike={() => {
              if (!liked) void react("like");
            }}
          />
        </div>
      ) : item.mediaKind === "video" && (item.streamUid || item.mediaUrl) ? (
        // Big, immersive inline preview: autoplays muted in view, tap → fullscreen
        // reel, press-hold → pause.
        <div className="relative mx-4 mb-3 overflow-hidden rounded-2xl sm:mx-5">
          <FeedVideo
            src={item.mediaUrl}
            streamUid={item.streamUid}
            streamReady={item.streamReady}
            streamFailed={item.streamFailed}
            poster={item.thumbnailUrl}
            postId={item.id}
            onExpand={() => onOpen(item)}
            onDoubleTapLike={() => {
              if (!liked) void react("like");
            }}
            // FeedVideo renders the clip at its TRUE aspect ratio (measured from
            // the video) — tall clips expand, short/wide ones show as they are.
            className="w-full"
          />
          {/* Views/duration — the two corners FeedVideo's own mute + expand
              controls use are bottom-right and top-right, so this goes
              top-left, the one unclaimed corner. */}
          {item.viewsCount > 0 || item.durationSec ? (
            <span className="pointer-events-none absolute left-2.5 top-2.5 z-10 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
              {item.viewsCount > 0 ? `${formatCompactNumber(item.viewsCount)} views` : null}
              {item.viewsCount > 0 && item.durationSec ? " · " : null}
              {item.durationSec ? formatDuration(item.durationSec) : null}
            </span>
          ) : null}
        </div>
      ) : item.mediaKind === "image" && (item.mediaUrl || item.thumbnailUrl) ? (
        // Image posts behave like videos: full-size, double-tap to like, tap to open.
        <div className="relative mx-4 mb-3 overflow-hidden rounded-2xl sm:mx-5">
          <FeedImage
            src={item.mediaUrl || item.thumbnailUrl!}
            alt={item.title}
            width={item.mediaWidth ?? undefined}
            height={item.mediaHeight ?? undefined}
            liked={liked}
            onDoubleTapLike={() => {
              if (!liked) void react("like");
            }}
            onExpand={() => onOpen(item)}
            className="max-h-[85vh] w-full"
          />
          {item.viewsCount > 0 ? (
            <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
              {formatCompactNumber(item.viewsCount)} views
            </span>
          ) : null}
        </div>
      ) : item.mediaKind === "audio" ? (
        <button type="button" onClick={() => onOpen(item)} className="block w-full text-left" aria-label="Play">
          <div className="mx-4 mb-3 flex items-center gap-3 rounded-xl bg-gradient-to-r from-blue-600/10 to-violet-600/10 p-3 ring-1 ring-inset ring-violet-500/15">
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 text-white">
              <Music className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{item.title}</p>
              <div className="mt-1.5 flex h-6 items-end gap-0.5">
                {Array.from({ length: 32 }).map((_, i) => (
                  <span key={i} className="w-1 rounded-full bg-violet-500/50" style={{ height: `${20 + Math.abs(Math.sin(i)) * 80}%` }} />
                ))}
              </div>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-600 text-white"><Play className="h-4 w-4 fill-white" /></span>
          </div>
        </button>
      ) : (
        <button type="button" onClick={() => onOpen(item)} className="block w-full text-left" aria-label="Open">
          <div className="relative mx-4 mb-3 aspect-video overflow-hidden rounded-xl bg-neutral-900">
            {item.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-300 hover:scale-105" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-600/30 to-violet-600/30 text-white/40">
                <Play className="h-10 w-10" />
              </div>
            )}
            {item.mediaKind === "video" ? (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/40 backdrop-blur">
                  <Play className="h-6 w-6 fill-white text-white" />
                </span>
              </span>
            ) : null}
            <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
              {formatCompactNumber(item.viewsCount)} views
            </span>
          </div>
        </button>
      )}

      {/* Actions — Wow / Comment / Repost / Send / Save; anything rarer
          (Download, …) lives in the ••• overflow so content stays the focus. */}
      <div className="mx-3 mb-3 mt-1 flex items-center justify-between rounded-2xl bg-secondary/40 px-1 py-1 ring-1 ring-inset ring-border/40">
        <div className="flex items-center">
          <span className="relative inline-flex">
            <ActionButton
              active={liked}
              onClick={(e) => {
                if (!liked) floatReaction(e.clientX, e.clientY);
                void react("like");
              }}
              icon={myEmotion ? makeEmotionIcon(reactionGlyph(myEmotion)!) : liked ? WowSolid : WowOutline}
              count={likes}
              activeClass="text-violet-500"
              label="Wow"
              press={wowPress}
            />
            <ReactionPicker
              open={reactionsOpen}
              onClose={() => setReactionsOpen(false)}
              onPick={(emotion, _glyph, e) => {
                floatReaction(e.clientX, e.clientY);
                void reactWithEmotion(emotion);
              }}
            />
          </span>
          <ActionButton icon={MessageCircle} count={item.commentsCount} onClick={() => onOpen(item, true)} label="Comment" />
          {!item.isOwner ? (
            <span className="relative inline-flex">
              <RepostBurst triggerKey={repostBurst} />
              <ActionButton icon={Repeat2} active={repostState.reposted} count={repostState.count} activeClass="text-emerald-500" onClick={repost} label="Repost" press={repostPress} />
            </span>
          ) : null}
          <ActionButton
            icon={SendIcon}
            onClick={() => {
              setShareReady(true);
              setShareOpen(true);
            }}
            label="Send"
          />
        </div>
        <ActionButton active={saved} onClick={() => react("save")} icon={Bookmark} fill={saved} activeClass="text-amber-500" label="Save" />
      </div>

      {shareReady ? (
        <ShareSheet
          postId={item.id}
          title={title ?? undefined}
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          onRepost={item.isOwner ? undefined : () => openComposer("create", null)}
        />
      ) : null}

      {item.isOwner && editReady ? (
        <PostEditSheet
          item={{ id: item.id, title: title ?? "" }}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={(p) => setTitle(p.title)}
          onDeleted={() => onRemove(item.id)}
        />
      ) : null}

      {pickerReady ? <CollectionPicker postId={item.id} open={pickerOpen} onClose={() => setPickerOpen(false)} /> : null}

      {composerReady ? (
        <RepostComposer
          post={{ id: item.id, title: title ?? "", thumbnailUrl: item.thumbnailUrl, publisher: item.publisher }}
          currentCount={repostState.count}
          open={composerOpen}
          onClose={() => setComposerOpen(false)}
          onReposted={onReposted}
          mode={composerMode}
          initialCaption={composerCaption}
        />
      ) : null}

      {optionsReady ? (
        <RepostOptionsSheet
          postId={item.id}
          currentCount={repostState.count}
          open={optionsOpen}
          onClose={() => setOptionsOpen(false)}
          onReposted={onReposted}
          onCompose={() => openComposer("create", null)}
          onEditCaption={(caption) => openComposer("edit", caption)}
        />
      ) : null}

      {repostersReady ? <RepostersSheet postId={item.id} open={repostersOpen} onClose={() => setRepostersOpen(false)} /> : null}
    </motion.article>
  );
}

/**
 * Memoized so a feed state change (loading the next page, opening a viewer)
 * never re-renders every already-mounted card — only cards whose props actually
 * change repaint. Requires the parent to pass STABLE onRemove/onOpen callbacks.
 * The smart stream hands each card a fresh `reason` object on every rebuild, so
 * we compare it by value (label/tone) rather than identity.
 */
export const FeedPostCard = memo(
  FeedPostCardImpl,
  (a, b) =>
    a.item === b.item &&
    a.onRemove === b.onRemove &&
    a.onOpen === b.onOpen &&
    a.reason?.label === b.reason?.label &&
    a.reason?.tone === b.reason?.tone,
);

function ActionButton({
  icon: Icon,
  count,
  active,
  fill,
  activeClass,
  onClick,
  href,
  label,
  press,
}: {
  icon: typeof Heart;
  count?: number;
  active?: boolean;
  fill?: boolean;
  activeClass?: string;
  onClick?: (e: React.MouseEvent) => void;
  href?: string;
  label: string;
  /** Long-press handlers (from useLongPress) for buttons with a hold action. */
  press?: ReturnType<typeof useLongPress>;
}) {
  const inner = (
    <>
      <motion.span
        key={String(active)}
        initial={false}
        animate={active ? { scale: [1, 1.35, 1] } : { scale: 1 }}
        transition={{ duration: 0.32, ease: [0.34, 1.4, 0.5, 1] }}
        className="inline-flex"
      >
        <Icon className={cn("h-[19px] w-[19px]", fill && "fill-current")} strokeWidth={2.1} />
      </motion.span>
      {count !== undefined && count > 0 ? <AnimatedCount value={count} className="text-xs font-semibold tabular-nums" /> : null}
    </>
  );
  const cls = cn(
    "group/act inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-foreground transition-colors hover:bg-secondary/70 active:scale-95",
    active && activeClass,
  );
  if (href) {
    return (
      <Link href={href} aria-label={label} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={active} className={cls} {...press}>
      {inner}
    </button>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Heart; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-secondary",
        danger ? "text-red-500" : "text-foreground",
      )}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}
