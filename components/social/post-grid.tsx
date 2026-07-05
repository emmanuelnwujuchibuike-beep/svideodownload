import { Eye, Image as ImageIcon, Music, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import type { PostCard } from "@/lib/social/posts";
import { cn, formatCompactNumber } from "@/lib/utils";

const KIND_ICON = { video: Play, image: ImageIcon, audio: Music } as const;

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
 */
export function PostGrid({
  posts,
  emptyText = "No posts yet.",
  layout = "card",
}: {
  posts: PostCard[];
  emptyText?: string;
  layout?: "card" | "reel" | "photo";
}) {
  if (posts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  if (layout === "reel" || layout === "photo") {
    return (
      <div className="grid grid-cols-3 gap-1 sm:gap-1.5 md:grid-cols-4 lg:grid-cols-5">
        {posts.map((p) => (
          <MediaTile key={p.id} post={p} aspect={layout === "reel" ? "portrait" : "square"} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {posts.map((p) => (
        <PostCardItem key={p.id} post={p} />
      ))}
    </div>
  );
}

/** Edge-to-edge media tile (Videos/Photos tabs) — cover fills, minimal chrome. */
function MediaTile({ post, aspect }: { post: PostCard; aspect: "portrait" | "square" }) {
  return (
    <Link
      href={`/p/${post.id}`}
      className={cn(
        "group relative overflow-hidden bg-neutral-950 sm:rounded-lg",
        aspect === "portrait" ? "aspect-[9/16]" : "aspect-square",
      )}
    >
      <PostCover post={post} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
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

function PostCardItem({ post }: { post: PostCard }) {
  return (
    <Link
      href={`/p/${post.id}`}
      className="group overflow-hidden rounded-2xl border border-border/70 bg-card shadow-soft transition hover:-translate-y-0.5 hover:shadow-card"
    >
      <div className="relative aspect-video overflow-hidden bg-neutral-950">
        <PostCover post={post} className="h-full w-full object-cover opacity-90 transition group-hover:scale-105 group-hover:opacity-100" />
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
