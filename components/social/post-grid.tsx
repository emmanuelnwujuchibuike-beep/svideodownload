"use client";

import { Eye, FileText, Image as ImageIcon, Music, Play } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useState } from "react";

import type { FeedItem } from "@/lib/social/home-feed";
import type { PostCard } from "@/lib/social/posts";
import { postHref } from "@/lib/social/post-url";
import { cn, formatCompactNumber } from "@/lib/utils";
import type { PostMediaKind } from "@/types";

// Same code-split, instant, no-navigation viewers the Home feed uses — a grid
// tap opens straight into one of these instead of `/p/[id]` (owner: "the
// images in feed enters another page before opening, i want it to open
// instantly on click smoothly without waiting or going through round route").
const ReelsFeed = dynamic(() => import("@/features/reels/reels-feed").then((m) => m.ReelsFeed), {
  ssr: false,
  loading: () => <div className="fixed inset-0 z-[85] bg-black" aria-hidden />,
});
const PostViewer = dynamic(() => import("@/features/feed/post-viewer").then((m) => m.PostViewer), {
  ssr: false,
  loading: () => <div className="fixed inset-0 z-[85] bg-black" aria-hidden />,
});
const ImageViewer = dynamic(() => import("@/features/feed/image-viewer").then((m) => m.ImageViewer), { ssr: false });

/* `text` (2026-08-23, migration 0128) is a write-up with no media at all, so a
   grid tile has nothing to paint but a glyph — the caption is the whole post.
   Typed against PostMediaKind so a future kind cannot be added without the
   compiler pointing here. */
const KIND_ICON: Record<PostMediaKind, typeof Play> = {
  video: Play,
  image: ImageIcon,
  audio: Music,
  text: FileText,
};

/**
 * A post's cover image. Prefers the stored thumbnail; for videos without one it
 * paints the real first frame from the media file (so uploads never show a blank
 * black tile); otherwise a kind icon. Every call site places this inside a
 * `relative` + fixed-aspect container, so the thumbnail uses next/image `fill`
 * (AVIF/WebP + a right-sized srcset + lazy) — grids never download oversized art.
 */
export function PostCover({
  post,
  className,
  sizes = "(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 300px",
}: {
  post: PostCard;
  className?: string;
  /** Match the tile's rendered width so the optimizer picks the smallest image. */
  sizes?: string;
}) {
  const KindIcon = KIND_ICON[post.mediaKind] ?? Play;
  if (post.thumbnailUrl) {
    return <Image src={post.thumbnailUrl} alt="" fill sizes={sizes} loading="lazy" className={cn("object-cover", className)} />;
  }
  if (post.mediaKind === "video" && post.mediaUrl) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        src={`${post.mediaUrl}#t=0.5`}
        muted
        playsInline
        preload="metadata"
        tabIndex={-1}
        className={className}
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center text-white/25">
      <KindIcon className="h-8 w-8" />
    </div>
  );
}

/**
 * Post cards in three responsive layouts:
 *  - "card"  → the default titled cards (related, explore).
 *  - "reel"  → edge-to-edge portrait (9:16) tiles, TikTok-style — for Videos.
 *  - "photo" → edge-to-edge square tiles — for Photos.
 * Reel/photo tiles fill the row and scale their column count to the device
 * (3 on phones → up to 5 on desktop) so media always fills the screen width.
 *
 * A plain tap opens the tapped post INSTANTLY, client-side, in the same
 * viewer the Home feed uses (no `/p/[id]` navigation/round-trip) — the tile
 * stays a real `<Link>` underneath (Ctrl/Cmd/middle-click, right-click "copy
 * link", keyboard Enter-then-open-in-new-tab all still work normally) so
 * nothing about sharing/SEO/deep-linking changes, only the plain-click path.
 */
/**
 * How many tiles one page reveals.
 *
 * The media grid is 3 columns on a phone, so ten lines is thirty tiles — the
 * "see more after the 10th grid line" in the request. Wider screens fit 4–5
 * across and so get fewer than ten lines per page, which is right: the point is
 * a bounded first paint, and a desktop showing six lines before the button is
 * not a worse experience than a phone showing ten.
 */
const PAGE_SIZE = 30;

export function PostGrid({
  posts,
  emptyText = "No posts yet.",
  layout = "card",
}: {
  posts: PostCard[];
  emptyText?: string;
  layout?: "card" | "reel" | "photo";
}) {
  const [openItem, setOpenItem] = useState<FeedItem | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  /*
    🔴 REVEAL IN PAGES, rather than mounting every tile at once.

    Owner, 2026-08-31: "there should be a see more after the 10th grid line and
    all cards and thumbnail should loads one after the others accordingly to
    avoid loading junk and delay."

    A creator with 200 posts was mounting 200 tiles in a single commit — 200
    `next/image` elements and 200 intersection targets, in one long main-thread
    task, on the page most likely to be opened from a phone. `loading="lazy"`
    holds the BYTES back but does nothing about the elements themselves, which
    is the "loading junk and delay" in the report.

    Paging the DOM is what fixes that. The browser then lazy-loads the
    thumbnails of the page it has, in viewport order — "one after the other".
  */
  const [visible, setVisible] = useState(PAGE_SIZE);

  const openPost = useCallback(async (e: React.MouseEvent, post: PostCard) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return; // let modified clicks navigate normally
    e.preventDefault();
    if (loadingId) return;
    setLoadingId(post.id);
    try {
      const res = await fetch(`/api/posts/${post.id}/feed-item`);
      if (res.ok) {
        const json = await res.json();
        setOpenItem(json.item as FeedItem);
      } else {
        window.location.href = postHref(post); // fall back to the real page rather than silently doing nothing
      }
    } catch {
      window.location.href = postHref(post);
    } finally {
      setLoadingId(null);
    }
  }, [loadingId]);

  const shown = posts.length > visible ? posts.slice(0, visible) : posts;
  const remaining = posts.length - shown.length;

  if (posts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  const isAlbum = (openItem?.mediaItems?.length ?? 0) > 1;
  const allVideoAlbum = isAlbum && openItem!.mediaItems!.every((m) => m.kind === "video");
  const isVideo = !!openItem && openItem.mediaKind === "video" && (!isAlbum || allVideoAlbum);
  const isImage = !!openItem && !isVideo && (isAlbum || openItem.mediaKind === "image");

  return (
    <>
      {layout === "reel" || layout === "photo" ? (
        <div className="grid grid-cols-3 gap-1 sm:gap-1.5 md:grid-cols-4 lg:grid-cols-5">
          {shown.map((p) => (
            <MediaTile key={p.id} post={p} aspect={layout === "reel" ? "portrait" : "square"} onOpen={openPost} loading={loadingId === p.id} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shown.map((p) => (
            <PostCardItem key={p.id} post={p} onOpen={openPost} loading={loadingId === p.id} />
          ))}
        </div>
      )}

      {/*
        The rest of the grid, on request. Deliberately a BUTTON and not an
        infinite scroller: this sits on a profile, where people arrive looking
        for one particular post and scroll with intent, and an auto-loader would
        keep the page growing under them and make the footer unreachable.

        It says how many are left, because "See more" with no number gives no
        sense of whether the next tap ends the list or is the first of ten.
      */}
      {remaining > 0 ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
            className="srch-press inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-secondary px-6 text-sm font-bold text-foreground ring-1 ring-inset ring-border/60 transition hover:bg-secondary/80"
          >
            See more
            <span className="text-xs font-semibold text-muted-foreground">
              {remaining} left
            </span>
          </button>
        </div>
      ) : null}

      {isVideo ? (
        <ReelsFeed initialItems={[openItem!]} initialOffset={null} startId={openItem!.id} onClose={() => setOpenItem(null)} />
      ) : isImage ? (
        <ImageViewer item={openItem} onClose={() => setOpenItem(null)} />
      ) : openItem ? (
        <PostViewer item={openItem} startWithComments={false} onClose={() => setOpenItem(null)} />
      ) : null}
    </>
  );
}

/** Edge-to-edge media tile (Videos/Photos tabs) — cover fills, minimal chrome. */
function MediaTile({
  post,
  aspect,
  onOpen,
  loading,
}: {
  post: PostCard;
  aspect: "portrait" | "square";
  onOpen: (e: React.MouseEvent, post: PostCard) => void;
  loading: boolean;
}) {
  return (
    <Link
      href={postHref(post)}
      onClick={(e) => onOpen(e, post)}
      aria-busy={loading}
      className={cn(
        "group relative overflow-hidden bg-neutral-950 sm:rounded-lg",
        aspect === "portrait" ? "aspect-[9/16]" : "aspect-square",
      )}
    >
      <PostCover post={post} className={cn("h-full w-full object-cover transition duration-300 group-hover:scale-105", loading && "opacity-60")} />
      {/* legibility gradient */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent" />
      {post.mediaKind === "video" ? (
        <Play className="absolute left-2 top-2 h-4 w-4 fill-white/90 text-white/90 drop-shadow" />
      ) : null}
      <span className="absolute bottom-1.5 left-2 inline-flex items-center gap-1 text-[11px] font-semibold text-white drop-shadow">
        <Eye className="h-3 w-3" /> {formatCompactNumber(post.viewsCount)}
      </span>
    </Link>
  );
}

function PostCardItem({
  post,
  onOpen,
  loading,
}: {
  post: PostCard;
  onOpen: (e: React.MouseEvent, post: PostCard) => void;
  loading: boolean;
}) {
  return (
    <Link
      href={postHref(post)}
      onClick={(e) => onOpen(e, post)}
      aria-busy={loading}
      className="group overflow-hidden rounded-2xl border border-border/70 bg-card shadow-soft transition hover:-translate-y-0.5 hover:shadow-card"
    >
      <div className="relative aspect-video overflow-hidden bg-neutral-950">
        <PostCover post={post} className={cn("h-full w-full object-cover opacity-90 transition group-hover:scale-105 group-hover:opacity-100", loading && "opacity-50")} />
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-md">
          <Eye className="h-3 w-3" /> {formatCompactNumber(post.viewsCount)}
        </span>
      </div>
      <div className="p-2.5">
        <p className="line-clamp-2 text-xs font-semibold leading-snug">{post.title}</p>
        {post.category ? (
          <p className="mt-1 text-[11px] capitalize text-muted-foreground">{post.category}</p>
        ) : null}
      </div>
    </Link>
  );
}
