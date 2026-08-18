"use client";

import {
  AnimatePresence,
  motion } from "framer-motion";
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
import { VerifiedTick } from "@/components/badges/identity-badges";
import { FrenzLogo } from "@/components/brand/frenz-logo";
import Link from "next/link";
import { memo, useEffect, useRef, useState } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";

import { WowOutline, WowSolid } from "@/components/brand/wow-icon";
import { RichText } from "@/components/social/rich-text";
import { PostPollInline } from "@/features/social/post-poll-inline";
import { AnimatedCount } from "@/features/ui/animated-count";
import { fireWowFeedback } from "@/features/ui/wow-burst";
import { FeedImage } from "@/features/media/feed-image";
import { FeedVideo } from "@/features/media/feed-video";
import { MediaGrid } from "@/features/media/media-grid";
import dynamic from "next/dynamic";
import Image from "next/image";

import { makeEmotionIcon, reactionGlyph, ReactionPicker, type ReactionEmotion } from "@/features/social/reaction-picker";
import { RepostBurst } from "@/features/social/repost-burst";
import { WhyThisChip } from "@/features/social/repost/why-this";
import { attributeRepost } from "@/lib/social/repost/attribution-client";
import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";

// These sheets appear only on interaction (edit / save-to-collection / repost)
// and this card renders many times per feed — code-split so they never weigh
// down the feed.
const CollectionPicker = dynamic(() => import("@/features/social/collection-picker").then((m) => m.CollectionPicker), { ssr: false });
const PostEditSheet = dynamic(() => import("@/features/social/post-edit-sheet").then((m) => m.PostEditSheet), { ssr: false });
const RepostComposer = dynamic(() => import("@/features/social/repost-composer").then((m) => m.RepostComposer), { ssr: false });
const RepostSheet = dynamic(() => import("@/features/social/repost/repost-sheet").then((m) => m.RepostSheet), { ssr: false });
const RepostersSheet = dynamic(() => import("@/features/social/reposters-sheet").then((m) => m.RepostersSheet), { ssr: false });
const ShareSheet = dynamic(() => import("@/features/social/share-sheet").then((m) => m.ShareSheet), { ssr: false });
const ShareQrSheet = dynamic(() => import("@/features/social/share-qr-sheet").then((m) => m.ShareQrSheet), { ssr: false });
const ContentPreferencesSheet = dynamic(() => import("@/features/social/content-preferences-sheet").then((m) => m.ContentPreferencesSheet), { ssr: false });
const ReportSheet = dynamic(() => import("@/features/social/report-sheet").then((m) => m.ReportSheet), { ssr: false });
const CommentsSheet = dynamic(() => import("@/features/social/comments-sheet").then((m) => m.CommentsSheet), { ssr: false });
import { floatReaction } from "@/features/ui/reaction-float";
import { useLongPress } from "@/lib/hooks/use-long-press";
import { enqueueOfflineAction } from "@/lib/offline/action-queue";
import { isCategory } from "@/lib/social/categories";
import { prefetchPostComments } from "@/lib/social/comments-cache";
import { FrenzsaveError } from "@/lib/sdk";
import { toggleFollow as toggleFollowShared, useFollowState } from "@/lib/social/follow-store";
import { postHref } from "@/lib/social/post-url";
import type { RepostAudience } from "@/lib/social/repost/audience";
import { toggleRepost, useRepostState } from "@/lib/social/repost-store";
import type { FeedItem } from "@/lib/social/home-feed";
import type { SmartReason, SmartReasonTone } from "@/lib/social/smart-feed";
import { cn, formatCompactNumber, formatDuration } from "@/lib/utils";

// The mockup's eyebrow keeps its text muted and carries the tone in the DOT
// (solid blue for follow, etc.) — replaces the old all-colored text chip.
const REASON_DOT: Record<SmartReasonTone, string> = {
  follow: "bg-blue-500",
  fresh: "bg-emerald-500",
  hot: "bg-rose-500",
  download: "bg-teal-500",
  interest: "bg-violet-500",
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
  /**
   * True for the feed's first TWO cards (owner, 2026-08-18: originally just
   * the very first — "make the feed page have the same LCP as landing" —
   * then widened: "feed and reels should never load the first two videos on
   * landing, they should load ahead"). Threaded down to `FeedImage` (fetch
   * eagerly instead of the blanket "low" priority every other card
   * correctly uses) and `FeedVideo` (`preload="auto"` + attach the source
   * immediately instead of waiting on its own IntersectionObserver).
   */
  priority = false,
}: {
  item: FeedItem;
  reason?: SmartReason | null;
  onRemove: (id: string) => void;
  onOpen: (item: FeedItem, startComments?: boolean, startIndex?: number) => void;
  priority?: boolean;
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
  // The audience picked in the destination sheet, carried into the quote composer.
  const [composerAudience, setComposerAudience] = useState<RepostAudience>("public");
  const [repostSheetOpen, setRepostSheetOpen] = useState(false);
  const [repostersOpen, setRepostersOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareReady, setShareReady] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrReady, setQrReady] = useState(false);
  // Long-press Wow → the reaction picker; the picked glyph replaces the icon.
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [myEmotion, setMyEmotion] = useState<string | null>(item.viewerReactionEmotion ?? null);
  const wowPress = useLongPress(() => setReactionsOpen(true));
  // Gate the code-split sheets: mount only after first open (keeps their chunks
  // out of the feed until actually needed, then stays mounted for exit animations).
  const [editReady, setEditReady] = useState(false);
  const [pickerReady, setPickerReady] = useState(false);
  const [composerReady, setComposerReady] = useState(false);
  const [repostSheetReady, setRepostSheetReady] = useState(false);
  const [repostersReady, setRepostersReady] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefsReady, setPrefsReady] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReady, setReportReady] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsReady, setCommentsReady] = useState(false);

  // Holding the Repost button opens the same destination sheet the tap does —
  // one surface reached two ways, rather than a second menu to keep in step.
  const repostPress = useLongPress(() => {
    if (!requireAuth()) return;
    setRepostSheetReady(true);
    setRepostSheetOpen(true);
  });

  // Plain toggle (Save, and the base Like on/off). Like/Save are idempotent
  // set-membership toggles (confirmed against the API: POST upserts, DELETE
  // no-ops on a missing row), so a request that fails because the device is
  // OFFLINE gets queued for replay instead of rolled back — the "Offline
  // Interactions" ask — while a genuine server rejection still rolls back as
  // before. Queued under `${type}:${postId}` so flipping the same toggle
  // multiple times offline coalesces into just the final desired state.
  /*
    Attribution (Part 4). `viaRepostId` is set ONLY on an item the ranking
    surfaced as someone's recommendation, so on an organic post every one of
    these calls is a no-op — the helper takes a null id deliberately, so callers
    do not have to branch.

    The impression fires on mount rather than on an intersection observer: this
    card is only rendered inside the feed's own virtualisation, so mounting
    already means "close enough to be seen", and an observer per card is a real
    cost on a long feed for a distinction nobody would notice in the numbers.
  */
  useEffect(() => {
    attributeRepost(item.viaRepostId, item.id, "impression");
  }, [item.viaRepostId, item.id]);

  /*
    Opening it is the signal that actually matters — an impression is free, a
    tap is a decision. Wrapping `onOpen` here rather than attributing at each of
    the five call sites below means a new way to open a card cannot silently
    stop being counted.
  */
  const open = (target: FeedItem, startComments?: boolean, startIndex?: number) => {
    attributeRepost(item.viaRepostId, item.id, "open");
    onOpen(target, startComments, startIndex);
  };

  /*
    ── Guest gate (2026-08-18, guest feed access; softened 2026-08-18) ─────────
    This card now also renders for signed-out visitors (the new guest-
    accessible /feed route — "watch feed but can't interact"). `useEntitlements`
    is already memoized app-wide, so this costs nothing extra when a signed-in
    viewer's identity was already resolved elsewhere on the page.
    `identityReady` guards against a false "signed out" reading before the
    (synchronous, cookie-based) check has actually resolved.

    🔴 NO LONGER REDIRECTS (owner, 2026-08-18: "interaction from guest in the
    feed and reels shouldn't lead to sign in page, rather it just interact and
    goes out"). A tap that used to bounce a guest straight to /login now just
    stays put with a toast — callers that have a safe, non-persisted local
    flourish (the Wow burst) still play it; this only gates the part that
    would otherwise hit the server as an unauthenticated request.
  */
  const { handle: viewerHandle, ready: identityReady } = useEntitlements();
  const requireAuth = (): boolean => {
    if (identityReady && !viewerHandle) {
      toast("Sign in to like, comment and share.", "info", { duration: 2500 });
      return false;
    }
    return true;
  };

  const react = async (type: "like" | "save") => {
    if (!requireAuth()) return;
    const isLike = type === "like";
    const cur = isLike ? liked : saved;
    const next = !cur;
    // Only the positive direction is attributed — un-liking is not engagement,
    // and the ledger's unique index would keep the first row anyway.
    if (next) attributeRepost(item.viaRepostId, item.id, isLike ? "like" : "save");
    if (isLike) {
      setLiked(next);
      setLikes((n) => n + (next ? 1 : -1));
      if (!next) setMyEmotion(null);
    } else setSaved(next);

    const queued = { key: `${type}:${item.id}`, url: `/api/posts/${item.id}/react`, method: next ? ("POST" as const) : ("DELETE" as const), body: { type } };
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await enqueueOfflineAction(queued);
      return;
    }
    try {
      const res = await fetch(queued.url, {
        method: queued.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(queued.body),
      });
      if (!res.ok) throw new Error();
    } catch {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueueOfflineAction(queued);
        return;
      }
      // rollback (a genuine rejection, not a connectivity issue)
      if (isLike) {
        setLiked(cur);
        setLikes((n) => n + (next ? -1 : 1));
      } else setSaved(cur);
    }
  };

  // Reaction picker: always ends in a Wow (liked=true) with a specific flavor,
  // whether this is a fresh like or the user is just changing their flavor.
  // Same offline-queue treatment as `react` above, same coalescing key
  // (`like:<postId>`) — a flavor picked right after an offline plain-Like
  // replaces it rather than queuing a second, redundant write.
  const reactWithEmotion = async (emotion: ReactionEmotion) => {
    if (!requireAuth()) return;
    const wasLiked = liked;
    const prevEmotion = myEmotion;
    setLiked(true);
    if (!wasLiked) setLikes((n) => n + 1);
    setMyEmotion(emotion);

    const queued = { key: `like:${item.id}`, url: `/api/posts/${item.id}/react`, method: "POST" as const, body: { type: "like", emotion } };
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await enqueueOfflineAction(queued);
      return;
    }
    try {
      const res = await fetch(queued.url, {
        method: queued.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(queued.body),
      });
      if (!res.ok) throw new Error();
    } catch {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueueOfflineAction(queued);
        return;
      }
      if (!wasLiked) {
        setLiked(false);
        setLikes((n) => n - 1);
      }
      setMyEmotion(prevEmotion);
    }
  };

  const copyLink = async () => {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${postHref(item)}`);
      toast("Link copied.", "success");
    } catch {
      toast("Couldn't copy the link.", "error");
    }
  };

  const toggleFollow = async () => {
    if (!requireAuth()) return;
    setBusy(true);
    try {
      // Shared store updates every card/reel for this creator at once.
      await toggleFollowShared(item.publisher.id, !following);
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  };

  /*
    Repost opens the destination sheet (Part 4) — where the audience is chosen
    and every other destination lives. Same change, same reasoning, as the reel
    viewer: going straight to the caption composer made "recommend this" and
    "write about this" one action and left nowhere to say who it reaches.
  */
  const repost = () => {
    if (!requireAuth()) return;
    setMenuOpen(false);
    setRepostSheetReady(true);
    setRepostSheetOpen(true);
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

  const openReport = () => {
    setMenuOpen(false);
    setReportReady(true);
    setReportOpen(true);
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

  // True for exactly the two media shapes that render inside their own
  // full-bleed box (FeedVideo/FeedImage) and can have the engagement row
  // blended onto them — see engagementRow's own note just below.
  const overlayEngagement =
    !(item.mediaItems && item.mediaItems.length > 1) &&
    ((item.mediaKind === "video" && !!(item.streamUid || item.mediaUrl)) ||
      (item.mediaKind === "image" && !!(item.mediaUrl || item.thumbnailUrl)));

  /*
    ── Blended engagement row (2026-08-18 follow-up) ───────────────────────────
    Owner, from a screenshot of the shipped inline row (see the row's own note
    below): "the buttons on the feed card... blended underneath the video
    without causing visual noise and cluster" — a separate white toolbar under
    every video/photo read as clutter. For video and single-image posts (the
    two cases that render inside their own full-bleed, correctly-sized box —
    see FeedVideo/FeedImage's `children` prop) this now renders AS AN OVERLAY
    on the media's bottom edge instead of a sibling row below it, `light`
    styling (white icons, translucent hover) over a gradient scrim, the same
    treatment the views/duration badge already gets. Multi-photo grids, audio
    cards and text-only posts keep the original below-content row — MediaGrid
    is a different, denser composition (see the width note above: only single
    video breaks out of the avatar column) and a text-only post has no media
    to blend onto in the first place.
  */
  const engagementRow = (light: boolean) => (
    <div
      /*
        🔴 STOPS THE TAP-TO-OPEN GESTURE UNDERNEATH (owner: "interacting a
        post that the engagement is overlayed on top of the post in feed
        shouldn't open it on full"). Only matters for `light` (the overlay
        case, on video/single-image) — FeedImage's own tap-to-expand gesture
        listens on its OUTER container via onPointerDown/Move/Up, and this
        row renders INSIDE that same container as `children`, so a pointer
        interaction that starts on a Wow/Comment/Save button bubbled straight
        up into the image's own gesture state machine, which had no idea it
        wasn't a genuine tap on the photo itself. Stopping propagation right
        here, before it leaves this row, is enough — each button's own
        onClick still fires normally, since stopPropagation only blocks the
        event from continuing PAST this point, not from reaching its actual
        target.
      */
      onPointerDown={light ? (e) => e.stopPropagation() : undefined}
      className={cn(
        "flex items-center justify-between",
        // 🔴 DARKER GROUND (owner, 2026-08-18: "more premium and 3d and more
        // darker, fitting the professionality of instagram and twitter").
        // /70→/25 read as a thin, slightly-too-light wash next to the reels
        // rail's own near-solid scrim (see mobile-nav.tsx's immersive
        // gradient) — deepened to match that same weight so the icons sit on
        // a real dark ground rather than a light haze, on any video frame.
        light
          ? "absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-1.5 pb-1 pt-8"
          : "mt-1 pb-1",
      )}
    >
      <div className={cn("flex min-w-0 items-center", light ? "gap-0.5" : "gap-1")}>
        <span className="relative inline-flex">
          <ActionButton
            active={liked}
            onClick={(e) => {
              // 🔴 Haptic+sound on a DIRECT tap too, not just the double-tap-
              // on-media gesture (owner, 2026-08-18: "clicking the wow button
              // directly should make haptic sound too"). Same reasoning as
              // the burst below it — this is tactile button feedback, not a
              // persisted action, so it plays regardless of auth/like state.
              fireWowFeedback();
              // The burst plays regardless of auth — a guest tap "just
              // interacts" (owner, 2026-08-18); requireAuth only gates the
              // part that would otherwise persist to the server unsigned.
              if (!liked) floatReaction(e.clientX, e.clientY);
              if (!requireAuth()) return;
              void react("like");
            }}
            icon={myEmotion ? makeEmotionIcon(reactionGlyph(myEmotion)!) : liked ? WowSolid : WowOutline}
            count={likes}
            activeClass="text-violet-500"
            label="Wow"
            press={wowPress}
            light={light}
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
        <ActionButton
          icon={MessageCircle}
          count={item.commentsCount}
          onClick={() => {
            if (!requireAuth()) return;
            setCommentsReady(true);
            setCommentsOpen(true);
          }}
          label="Comment"
          light={light}
        />
        {!item.isOwner ? (
          <span className="relative inline-flex">
            <RepostBurst triggerKey={repostBurst} />
            <ActionButton icon={Repeat2} active={repostState.reposted} count={repostState.count} activeClass="text-emerald-500" onClick={repost} label="Repost" press={repostPress} light={light} />
          </span>
        ) : null}
        <ActionButton
          icon={SendIcon}
          onClick={() => {
            if (!requireAuth()) return;
            setShareReady(true);
            setShareOpen(true);
          }}
          label="Send"
          light={light}
        />
      </div>
      <ActionButton active={saved} onClick={() => react("save")} icon={Bookmark} fill={saved} activeClass="text-blue-500" label="Save" light={light} />
    </div>
  );

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
      /*
        🔴 CONTINUOUS TIMELINE, NOT A FLOATING CARD (owner, 2026-08-17 redesign
        spec, superseding the Facebook-style card from the previous pass):
        "Change the feed from a traditional floating-card layout into a
        continuous social timeline... Do not place every post inside a heavily
        elevated white/gray card." The elevated box-shadow + rounded corners +
        `bg-card` surface are gone; every post is now the SAME flat surface as
        the feed itself, separated from its neighbour by one hairline border
        only (spec section 15 — "approximately 1px", barely visible in light,
        low-opacity white in dark). `space-y-4` between cards is gone too (see
        smart-feed.tsx) — posts now sit edge to edge, the border IS the gap.
      */
      className="group relative cv-auto border-b border-border/70 py-3 last:border-b-0 dark:border-white/[0.07]"
    >
      {/* Repost discovery — lightweight "@x reposted" attribution when someone you
          follow reposted this, plus their recommendation caption when they wrote
          one. Never distracts from the content below. */}
      {item.repostBadge && item.repostBadge.count > 0 ? (
        <div className="px-2 pt-1 sm:px-3">
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
          {/*
            "Why am I seeing this?" (Part 4) — only on a post that was SURFACED
            as a recommendation. A post already in the feed on its own merits
            did not need explaining, and a reason attached to it would claim a
            recommendation that never happened.
          */}
          {item.repostReason ? (
            <div className="mt-2">
              <WhyThisChip reason={item.repostReason} />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Smart Explanation — why this is in your feed, styled to the owner's
          home mockup: an uppercase, letter-spaced eyebrow with a solid tone
          dot ("● FROM SOMEONE YOU FOLLOW") ABOVE the post, exactly where the
          mockup places it. Still tappable: opens the real content-preference
          controls (Feature 17 Part 13's "Discovery Transparency" made
          actionable, not just descriptive text). */}
      {reason ? (
        <div className="px-2 pb-0 pt-1 sm:px-3">
          <button
            type="button"
            onClick={() => { setPrefsReady(true); setPrefsOpen(true); }}
            className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground transition hover:text-foreground"
          >
            <span aria-hidden className={cn("h-2 w-2 rounded-full", REASON_DOT[reason.tone])} />
            {reason.label}
          </button>
        </div>
      ) : null}

      {/*
        🔴 TWO-COLUMN TWITTER LAYOUT (owner, 2026-08-17: "the profile ring
        and header should be at the far left end like twitter... the media
        and profile position" — after an earlier message of the owner's had
        read as walking this back, a later message in the same day clarified
        it was still wanted: "you have not done feed card arangement"). The
        avatar is now its OWN fixed-width left column, top-aligned; every-
        thing else — name/handle/time, the F-mark + menu, caption, poll,
        media, and the action row — lives in ONE right column next to it,
        matching X's actual two-column tweet layout instead of Instagram's
        stacked "avatar+name spans full width, media spans full width below"
        arrangement this card used before. Card padding also tightened from
        p-4/p-5 to px-2 (owner: "go to the extreme right end with just
        padding 2") so the whole row sits closer to the screen edge. Avatar
        shrunk again 40px->36px and the gap to its content column tightened
        (owner, same day: "the space on the left for the profile ring
        shouldnt be that big").
      */}
      <div className="flex gap-2 px-2 sm:px-3">
        <Link
          href={`/u/${item.publisher.handle}`}
          className="shrink-0 self-start rounded-full bg-gradient-to-br from-primary/70 to-accent/70 p-[2px] transition-transform duration-300 group-hover:scale-105"
        >
          {item.publisher.avatarUrl ? (
            <Image src={item.publisher.avatarUrl} alt="" width={36} height={36} className="h-9 w-9 rounded-full object-cover ring-2 ring-card" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-base font-bold text-white ring-2 ring-card">
              {item.publisher.displayName.charAt(0).toUpperCase()}
            </span>
          )}
        </Link>

        <div className="min-w-0 flex-1 pt-0.5">
          {/* Name row — ONE line like X (name, verified tick, @handle · time),
              not the old two-line Instagram-style stack. `truncate` on each
              piece keeps a long name or handle from pushing the trailing
              F-mark/menu off the row instead of wrapping. */}
          <div className="flex items-center gap-1.5 text-[15px] leading-tight">
            <Link href={`/u/${item.publisher.handle}`} className="flex min-w-0 shrink items-center gap-1 font-semibold hover:underline">
              <span className="truncate">{item.publisher.displayName}</span>
              {item.publisher.isVerified ? <VerifiedTick className="h-3.5 w-3.5 shrink-0" /> : null}
            </Link>
            <span className="shrink-0 truncate text-xs text-muted-foreground">@{item.publisher.handle} · {timeAgo(item.createdAt)}</span>
            <span className="min-w-2 flex-1" />

            {!item.isOwner ? (
              <button
                type="button"
                onClick={toggleFollow}
                disabled={busy}
                className={cn(
                  "hidden shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 sm:inline-flex",
                  following ? "bg-secondary text-foreground" : "bg-gradient-to-r from-blue-600 to-violet-600 text-white hover:opacity-95",
                )}
              >
                {following ? <Check className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                {following ? "Following" : "Follow"}
              </button>
            ) : null}

            {/*
              🔴 F-MARK WATERMARK, TOP-RIGHT OF EVERY POST (owner, 2026-08-17,
              with reference screenshots of the real X app: "the X logo by
              top side of every post . all should be the same , replace the
              X logo with F logo"). Real X stamps its own brand mark in this
              exact spot on every tweet's header row — decorative, not
              interactive (no link, no click target), same treatment here
              with Frenz's own mark instead.
            */}
            <FrenzLogo size={16} alt="" className="shrink-0 opacity-50" />

            {/* Overflow menu */}
            <div className="relative shrink-0">
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
                      <MenuItem icon={Share2} label="Share" onClick={() => { setMenuOpen(false); setShareReady(true); setShareOpen(true); }} />
                      <MenuItem icon={LinkIcon} label="Copy link" onClick={copyLink} />
                      <MenuItem
                        icon={Download}
                        label="Download"
                        onClick={() => {
                          setMenuOpen(false);
                          void import("@/lib/media/download-post").then((m) => m.downloadPost({ id: item.id, mediaUrl: item.mediaUrl, title }));
                        }}
                      />
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
                      {item.category ? (
                        <MenuItem icon={Sparkles} label="Content preferences" onClick={() => { setMenuOpen(false); setPrefsReady(true); setPrefsOpen(true); }} />
                      ) : null}
                      <MenuItem icon={EyeOff} label="Hide this post" onClick={() => onRemove(item.id)} />
                      <MenuItem icon={Ban} label="Not interested" onClick={() => onRemove(item.id)} />
                      <MenuItem icon={Flag} label="Report" danger onClick={openReport} />
                    </motion.div>
                  </>
                ) : null}
              </AnimatePresence>
            </div>
          </div>

          {/* Caption — a real <a href> to the post's canonical URL (postHref:
              lib/social/post-url.ts), not just an onClick target. Section 8 of
              the SEO brief: every post rendered in the feed needs a normal
              crawlable link to its content page present in the HTML, not only
              reachable via a JS click handler — this card previously had NONE
              anywhere (2026-08-18 audit), so Google could browse /explore's
              grid but not discover a single post from the feed itself.
              Deliberately scoped to just the caption rather than also
              wrapping the media box: FeedVideo/FeedImage's tap/double-tap/
              hold gesture state machines are separately, heavily tuned (see
              either file's own history of "SETTLED"/"REVERSED" notes) and
              retrofitting them to double as real anchors risks exactly the
              kind of regression this fix must not introduce. A plain click
              still opens the instant in-app viewer (preventDefault below,
              same interception PostGrid's MediaTile/PostCardItem already
              use) — only Ctrl/Cmd/middle-click, right-click → copy link, and
              a crawler's DOM parser see the real navigation. */}
          {title ? (
            <div className="pb-3 pt-0.5">
              <Link
                href={postHref(item)}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
                  e.preventDefault();
                  open(item);
                }}
                className="block text-[15px] leading-relaxed"
              >
                <RichText text={title} />
              </Link>
              {item.category ? (
                // Was /explore?q=%23category (a search results page); now the
                // real indexable hub — see category-hub-view.tsx's note on
                // the owner's "search for news/sports should land on the
                // hashtag page for that topic" (2026-08-18).
                <Link href={`/${item.category}`} className="mt-1 inline-block text-xs font-medium text-primary hover:underline">
                  #{item.category}
                </Link>
              ) : null}
            </div>
          ) : null}

          {/* Poll (vote) — below the caption */}
          {item.hasPoll ? (
            <div className="pb-3">
              <PostPollInline postId={item.id} />
            </div>
          ) : null}

          {/* Media — taller/bigger than a typical compact card (closer to X/
              Instagram's large feed previews) so video/photo posts read as the
              hero of the card, not a thumbnail.

              🔴 BACK INSIDE THE AVATAR COLUMN, FOR EVERY MEDIA TYPE (owner,
              2026-08-18, reversing this same day's earlier breakout attempt:
              "single video, multi post and video shouldn't break through the
              avatar left area... images shouldn't shrink, they should only
              not break the avatar area"). Media no longer escapes to a wider,
              avatar-independent box — it renders here, in the same indented
              column as the caption, at that column's own natural width.
          */}
          {item.mediaItems && item.mediaItems.length > 1 ? (
            <div className="mb-3">
              <MediaGrid
                items={item.mediaItems}
                onExpandItem={(index) => open(item, false, index)}
                onDoubleTapLike={() => {
                  if (!liked) void react("like");
                }}
              />
            </div>
          ) : item.mediaKind === "video" && (item.streamUid || item.mediaUrl) ? (
            <div className="relative mb-3 overflow-hidden rounded-2xl">
              <FeedVideo
                src={item.mediaUrl}
                streamUid={item.streamUid}
                streamReady={item.streamReady}
                streamFailed={item.streamFailed}
                poster={item.thumbnailUrl}
                postId={item.id}
                onExpand={() => open(item)}
                onDoubleTapLike={() => {
                  if (!liked) void react("like");
                }}
                width={item.mediaWidth ?? undefined}
                height={item.mediaHeight ?? undefined}
                priority={priority}
              >
                {item.viewsCount > 0 || item.durationSec ? (
                  <span className="pointer-events-none absolute left-2.5 top-2.5 z-10 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                    {item.viewsCount > 0 ? `${formatCompactNumber(item.viewsCount)} views` : null}
                    {item.viewsCount > 0 && item.durationSec ? " · " : null}
                    {item.durationSec ? formatDuration(item.durationSec) : null}
                  </span>
                ) : null}
                {engagementRow(true)}
              </FeedVideo>
            </div>
          ) : item.mediaKind === "image" && (item.mediaUrl || item.thumbnailUrl) ? (
            <div className="relative mb-3 overflow-hidden rounded-2xl">
              <FeedImage
                src={item.mediaUrl || item.thumbnailUrl!}
                alt={item.title}
                width={item.mediaWidth ?? undefined}
                height={item.mediaHeight ?? undefined}
                liked={liked}
                priority={priority}
                onDoubleTapLike={() => {
                  if (!liked) void react("like");
                }}
                onExpand={() => open(item)}
              >
                {item.viewsCount > 0 ? (
                  <span className="pointer-events-none absolute left-2.5 top-2.5 z-10 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                    {formatCompactNumber(item.viewsCount)} views
                  </span>
                ) : null}
                {engagementRow(true)}
              </FeedImage>
            </div>
          ) : item.mediaKind === "audio" ? (
        <button type="button" onClick={() => open(item)} className="block w-full text-left" aria-label="Play">
          <div className="mb-3 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-blue-600/10 to-violet-600/10 p-3 ring-1 ring-inset ring-violet-500/15">
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
        <button type="button" onClick={() => open(item)} className="block w-full text-left" aria-label="Open">
          <div className="relative mb-3 aspect-video overflow-hidden rounded-2xl bg-neutral-900">
            {item.thumbnailUrl ? (
              // No hover zoom (owner, 2026-08-11): the same "media stays still"
              // rule as FeedVideo. A poster that grows under the pointer is the
              // still-frame version of the movement being complained about, and
              // this is the tile a video post falls back to.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
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

      {/*
        🔴 LIGHTWEIGHT INLINE ROW, NOT A BOXED PILL (owner, 2026-08-17 redesign
        spec, section 11): "Replace the current large enclosed reaction
        container. Use a clean inline engagement row." The `bg-secondary/40
        ring-1 ...` capsule is gone — icons now sit directly on the post's own
        surface with breathing room between them, matching X's density rather
        than a boxed toolbar. Icons bumped 19px→20px (spec: "approximately
        20-22px"). Colors restrained to the brand palette (spec section 18:
        "do not introduce random additional accent colors") — Save's old
        amber-500 had no brand justification and is now blue, distinct from
        Wow's purple.

        Repost KEEPS its established emerald rather than switching to the
        spec's suggested indigo — deliberately: `RepostBurst` (the "Reposted!"
        bubble) and this same active-color are a SHARED, cross-surface pair
        also used by reel-viewer.tsx, which section 26 explicitly puts out of
        scope ("Only update the feed experience"). Recoloring just this one
        instance would split one interaction into two different colors
        depending on which surface you're on — a worse inconsistency than
        keeping the existing, already-established accent.

        🔴 2026-08-18: only rendered HERE (below the content, on the card's own
        surface) for the cases with no full-bleed media box to blend onto — a
        multi-photo grid, an audio card, or a text-only post. Video and single-
        image posts get this SAME row rendered as an overlay on the media
        itself instead (see `engagementRow`'s own note) — `overlayEngagement`
        below is true for exactly those two cases.
      */}
          {overlayEngagement ? null : engagementRow(false)}
        </div>
      </div>

      {shareReady ? (
        <ShareSheet
          postId={item.id}
          title={title ?? undefined}
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          onRepost={item.isOwner ? undefined : () => openComposer("create", null)}
          onQrCode={() => {
            setQrReady(true);
            setQrOpen(true);
          }}
        />
      ) : null}
      {qrReady ? <ShareQrSheet postId={item.id} url={`${typeof window !== "undefined" ? window.location.origin : ""}${postHref(item)}`} open={qrOpen} onClose={() => setQrOpen(false)} /> : null}

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
          audience={composerAudience}
          sourceRepostId={item.viaRepostId ?? null}
        />
      ) : null}

      {/* Part 4's destination sheet, replacing the three-row options sheet. Same
          lazy `*Ready` gate as every other sheet on this card, so nothing is in
          the first-load bundle until it is actually opened. */}
      {repostSheetReady ? (
        <RepostSheet
          postId={item.id}
          post={{ title, thumbnailUrl: item.thumbnailUrl, handle: item.publisher.handle }}
          currentCount={repostState.count}
          open={repostSheetOpen}
          onClose={() => setRepostSheetOpen(false)}
          alreadyReposted={repostState.reposted}
          sourceRepostId={item.viaRepostId ?? null}
          onReposted={onReposted}
          onQuote={(audience) => {
          setComposerAudience(audience);
          openComposer("create", null);
        }}
          onSendInChat={() => setShareOpen(true)}
          onSaveForLater={() => {
            setPickerReady(true);
            setPickerOpen(true);
          }}
        />
      ) : null}

      {repostersReady ? <RepostersSheet postId={item.id} open={repostersOpen} onClose={() => setRepostersOpen(false)} /> : null}

      {prefsReady ? (
        <ContentPreferencesSheet
          category={isCategory(item.category) ? item.category : null}
          reason={reason}
          publisherHandle={item.publisher.handle}
          open={prefsOpen}
          onClose={() => setPrefsOpen(false)}
          onMuteCreator={muteCreator}
        />
      ) : null}

      {reportReady ? (
        <ReportSheet targetType="post" targetId={item.id} open={reportOpen} onClose={() => setReportOpen(false)} onReported={() => onRemove(item.id)} />
      ) : null}

      {commentsReady ? (
        <CommentsSheet postId={item.id} commentsCount={item.commentsCount} open={commentsOpen} onClose={() => setCommentsOpen(false)} />
      ) : null}
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
  light,
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
  /** Blended-on-media variant (Feature 15 feed redesign follow-up, 2026-08-18):
   *  white/translucent instead of the card-surface muted/secondary colors, for
   *  when this sits directly over a video/image rather than on the card's own
   *  background. `activeClass`'s brand colors still apply on top either way. */
  light?: boolean;
}) {
  const inner = (
    <>
      <motion.span
        key={String(active)}
        initial={false}
        animate={active ? { scale: [1, 1.35, 1] } : { scale: 1 }}
        transition={{ duration: 0.32, ease: [0.34, 1.4, 0.5, 1] }}
        className={cn(
          "inline-flex",
          // 🔴 A REAL RAISED CHIP, NOT JUST A SHADOW ON THE GLYPH (owner,
          // 2026-08-18, twice: "more premium and 3d and more darker" — the
          // first pass only deepened the row's own background gradient and
          // added a drop-shadow to the bare icon, which read as too subtle a
          // change to notice against a genuinely dark video frame, where a
          // few extra points of gradient opacity behind an already-dark icon
          // is nearly invisible. A solid dark circular ground BEHIND each
          // icon — its own shadow, its own hairline ring — reads as a
          // distinct raised button regardless of what's playing behind it,
          // which is the actual "3D" cue Twitter/Instagram's own icon
          // treatments lean on, not a deeper page-level wash.
          light && "h-7 w-7 items-center justify-center rounded-full bg-black/55 shadow-[0_3px_8px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)] ring-1 ring-white/10",
        )}
      >
        <Icon
          className={cn(
            light ? "h-4 w-4" : "h-5 w-5",
            fill && "fill-current",
            light && "drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]",
          )}
          strokeWidth={light ? 2.3 : 2}
        />
      </motion.span>
      {count !== undefined && count > 0 ? (
        <AnimatedCount
          value={count}
          className={cn(
            "text-xs tabular-nums",
            light ? "font-bold drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" : "font-semibold",
          )}
        />
      ) : null}
    </>
  );
  // Muted by default, brand-colored only when active (spec section 11) — was
  // `text-foreground` at rest, full contrast even for an untouched icon.
  //
  // 🔴 TIGHTER PADDING/GAP WHEN `light` (owner: "long videos crop off the
  // save button... falling off the post card"). This row sits on top of the
  // media itself, and a tall/portrait clip's rendered WIDTH can be narrower
  // than the row's natural minimum width at the original `px-2.5 py-2` — the
  // flex row (Wow/Comment/Repost/Send on the left, Save pushed to the far
  // right via `justify-between`) had nowhere to shrink, so Save overflowed
  // past the media box and got clipped by its `overflow-hidden`. Smaller
  // icons (h-4 vs h-5) above plus tighter padding/gap here meaningfully
  // lowers that minimum width; the below-content row (`!light`, always full
  // card width) is untouched since it never hits this narrow-container case.
  const cls = cn(
    "group/act inline-flex shrink-0 items-center rounded-full transition-colors active:scale-95",
    light ? "gap-1 px-1.5 py-1.5" : "gap-1.5 px-2.5 py-2",
    light
      ? "text-white/90 drop-shadow-sm hover:bg-white/15 hover:text-white"
      : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
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
