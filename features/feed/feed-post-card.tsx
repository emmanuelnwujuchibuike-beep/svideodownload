"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  Ban,
  Bookmark,
  Check,
  Download,
  EyeOff,
  Flag,
  FolderPlus,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Music,
  Pencil,
  Play,
  Repeat2,
  Share2,
  Sparkles,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { memo, useState } from "react";

import { RichText } from "@/components/social/rich-text";
import { PostPollInline } from "@/features/social/post-poll-inline";
import { FeedImage } from "@/features/media/feed-image";
import { FeedVideo } from "@/features/media/feed-video";
import dynamic from "next/dynamic";
import Image from "next/image";

import { RepostBurst } from "@/features/social/repost-burst";
import { toast } from "@/features/ui/toast";

// These sheets appear only on interaction (edit / save-to-collection) and this
// card renders many times per feed — code-split so they never weigh down the feed.
const CollectionPicker = dynamic(() => import("@/features/social/collection-picker").then((m) => m.CollectionPicker), { ssr: false });
const PostEditSheet = dynamic(() => import("@/features/social/post-edit-sheet").then((m) => m.PostEditSheet), { ssr: false });
import { downloadPost } from "@/lib/media/download-post";
import { prefetchPostComments } from "@/lib/social/comments-cache";
import { FrenzsaveError } from "@/lib/sdk";
import { toggleFollow as toggleFollowShared, useFollowState } from "@/lib/social/follow-store";
import { toggleRepost, useRepostState } from "@/lib/social/repost-store";
import type { FeedItem } from "@/lib/social/home-feed";
import type { SmartReason, SmartReasonTone } from "@/lib/social/smart-feed";
import { cn, formatCompactNumber } from "@/lib/utils";

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
  onOpen: (item: FeedItem, startComments?: boolean) => void;
}) {
  const [liked, setLiked] = useState(item.viewerLiked);
  const [saved, setSaved] = useState(item.viewerSaved);
  const following = useFollowState(item.publisher.id, item.isFollowing);
  const repostState = useRepostState(item.id, item.viewerReposted ?? false, item.repostsCount ?? 0);
  const [likes, setLikes] = useState(item.likesCount);
  const [shares, setShares] = useState(item.sharesCount);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [editOpen, setEditOpen] = useState(false);
  const [repostBurst, setRepostBurst] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Gate the code-split sheets: mount only after first open (keeps their chunks
  // out of the feed until actually needed, then stays mounted for exit animations).
  const [editReady, setEditReady] = useState(false);
  const [pickerReady, setPickerReady] = useState(false);

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
      // rollback
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
      /* user cancelled */
    }
    fetch(`/api/posts/${item.id}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "share" }),
    }).catch(() => {});
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

  const repost = async () => {
    setMenuOpen(false);
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

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      // Warm this post's comments on hover so opening the sheet is instant.
      onPointerEnter={() => prefetchPostComments(item.id)}
      className="group relative cv-auto overflow-hidden rounded-[26px] border border-border/60 bg-card shadow-soft ring-1 ring-inset ring-white/[0.04] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-elevated hover:ring-primary/25"
    >
      {/* Always-on premium accent bar — visible on every device (no hover needed) */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px] bg-gradient-to-r from-blue-500 via-violet-500 to-fuchsia-500" />

      {/* Repost discovery — lightweight "@x reposted" attribution when someone you
          follow reposted this. Never distracts from the content below. */}
      {item.repostBadge && item.repostBadge.count > 0 ? (
        <Link href={`/u/${item.repostBadge.handles[0]}`} className="flex items-center gap-2 px-4 pt-3 text-xs font-medium text-muted-foreground transition hover:text-foreground">
          <Repeat2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          {item.repostBadge.avatars[0] ? (
            <Image src={item.repostBadge.avatars[0]} alt="" width={16} height={16} className="h-4 w-4 rounded-full object-cover ring-1 ring-border" />
          ) : null}
          <span className="truncate">
            @{item.repostBadge.handles[0]}
            {item.repostBadge.count > 1 ? ` and ${item.repostBadge.count - 1} other${item.repostBadge.count > 2 ? "s" : ""}` : ""} reposted
          </span>
        </Link>
      ) : null}

      {/* Header */}
      <div className="flex items-center gap-3 p-4 pb-3">
        <Link href={`/u/${item.publisher.handle}`} className="shrink-0 rounded-full bg-gradient-to-br from-primary/70 to-accent/70 p-[2px] transition-transform duration-300 group-hover:scale-105">
          {item.publisher.avatarUrl ? (
            <Image src={item.publisher.avatarUrl} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover ring-2 ring-card" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold text-white ring-2 ring-card">
              {item.publisher.displayName.charAt(0).toUpperCase()}
            </span>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/u/${item.publisher.handle}`} className="flex items-center gap-1 text-sm font-semibold leading-tight hover:underline">
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
                  {item.isOwner ? (
                    <MenuItem icon={Pencil} label="Edit post" onClick={() => { setMenuOpen(false); setEditReady(true); setEditOpen(true); }} />
                  ) : null}
                  {!item.isOwner ? (
                    <MenuItem icon={UserPlus} label={following ? "Unfollow creator" : "Follow creator"} onClick={toggleFollow} />
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
        <div className="px-4 pb-3">
          <p className="text-sm leading-relaxed">
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

      {/* Media */}
      {item.mediaKind === "video" && (item.streamUid || item.mediaUrl) ? (
        // Big, immersive inline preview: autoplays muted in view, tap → fullscreen
        // reel, press-hold → pause.
        <div className="mx-4 mb-3 overflow-hidden rounded-2xl">
          <FeedVideo
            src={item.mediaUrl}
            streamUid={item.streamUid}
            streamFailed={item.streamFailed}
            poster={item.thumbnailUrl}
            postId={item.id}
            onExpand={() => onOpen(item)}
            className="aspect-[4/5] w-full"
          />
        </div>
      ) : item.mediaKind === "image" && (item.mediaUrl || item.thumbnailUrl) ? (
        // Image posts behave like videos: full-size, double-tap to like, tap to open.
        <div className="mx-4 mb-3 overflow-hidden rounded-2xl">
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
            className="max-h-[80vh] w-full"
          />
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

      {/* Actions — premium tinted engagement bar (always visible, mobile-first) */}
      <div className="mx-3 mb-3 mt-1 flex items-center justify-between rounded-2xl bg-secondary/40 px-1 py-1 ring-1 ring-inset ring-border/40">
        <div className="flex items-center">
          <ActionButton active={liked} onClick={() => react("like")} icon={Heart} fill={liked} count={likes} activeClass="text-rose-500" label="Like" />
          <ActionButton icon={MessageCircle} count={item.commentsCount} onClick={() => onOpen(item, true)} label="Comment" />
          {!item.isOwner ? (
            <span className="relative inline-flex">
              <RepostBurst triggerKey={repostBurst} />
              <ActionButton icon={Repeat2} active={repostState.reposted} count={repostState.count} activeClass="text-emerald-500" onClick={repost} label="Repost" />
            </span>
          ) : null}
          <ActionButton icon={Share2} count={shares} onClick={share} label="Share" />
        </div>
        <div className="flex items-center">
          <ActionButton active={saved} onClick={() => react("save")} icon={Bookmark} fill={saved} activeClass="text-amber-500" label="Bookmark" />
          <ActionButton icon={Download} onClick={() => downloadPost({ id: item.id, mediaUrl: item.mediaUrl, title })} label="Download" />
        </div>
      </div>

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
}: {
  icon: typeof Heart;
  count?: number;
  active?: boolean;
  fill?: boolean;
  activeClass?: string;
  onClick?: () => void;
  href?: string;
  label: string;
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
      {count !== undefined && count > 0 ? <span className="text-xs font-semibold tabular-nums">{formatCompactNumber(count)}</span> : null}
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
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={active} className={cls}>
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
