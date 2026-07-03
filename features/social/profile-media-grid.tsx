"use client";

import { Heart, Images, MessageCircle, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PostCover } from "@/components/social/post-grid";
import { ProfileVideoPlayer } from "@/features/social/profile-video-player";
import type { PostCard } from "@/lib/social/posts";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * Profile content grid — a high-class, Instagram/TikTok-style grid. Photos/posts
 * use a seamless square grid; reels use 9:16 tiles. Every tile is edge-to-edge
 * cover art (no casual bordered "card" chrome), with a hover overlay that reveals
 * likes + comments, an always-on view count, and a media-type badge. Videos play
 * in-profile (fullscreen player over the profile's videos); other tiles open the
 * post page.
 */
export function ProfileMediaGrid({
  posts,
  layout = "card",
  emptyText = "Nothing here yet.",
}: {
  posts: PostCard[];
  layout?: "reel" | "card";
  emptyText?: string;
}) {
  const videos = posts.filter((p) => p.mediaKind === "video" && p.mediaUrl);
  const [playIndex, setPlayIndex] = useState<number | null>(null);

  if (posts.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-border/70 bg-card/40 p-12 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  const openVideo = (p: PostCard) => {
    const idx = videos.findIndex((v) => v.id === p.id);
    setPlayIndex(idx < 0 ? 0 : idx);
  };
  const isPlayable = (p: PostCard) => p.mediaKind === "video" && !!p.mediaUrl;

  const aspect = layout === "reel" ? "aspect-[9/16]" : "aspect-square";
  const cols =
    layout === "reel"
      ? "grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
      : "grid-cols-3 lg:grid-cols-4";

  return (
    <>
      <div className={cn("grid gap-1 sm:gap-1.5", cols)}>
        {posts.map((p) =>
          isPlayable(p) ? (
            <button
              key={p.id}
              type="button"
              onClick={() => openVideo(p)}
              className={cn("group relative block overflow-hidden rounded-xl bg-neutral-950 text-left", aspect)}
            >
              <Tile post={p} />
            </button>
          ) : (
            <Link
              key={p.id}
              href={`/p/${p.id}`}
              className={cn("group relative block overflow-hidden rounded-xl bg-neutral-950", aspect)}
            >
              <Tile post={p} />
            </Link>
          ),
        )}
      </div>
      <ProfileVideoPlayer
        posts={playIndex !== null ? videos : null}
        startIndex={playIndex ?? 0}
        onClose={() => setPlayIndex(null)}
      />
    </>
  );
}

function Tile({ post }: { post: PostCard }) {
  const isVideo = post.mediaKind === "video";
  const isImage = post.mediaKind === "image";
  return (
    <>
      <PostCover post={post} className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-[1.05]" />

      {/* Type badge (top-right) */}
      <span className="absolute right-2 top-2 text-white/95 drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
        {isVideo ? <Play className="h-[18px] w-[18px] fill-white/95" /> : isImage ? <Images className="h-[18px] w-[18px]" /> : null}
      </span>

      {/* Always-on bottom scrim + view count (TikTok style) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
      <span className="absolute bottom-1.5 left-2 inline-flex items-center gap-1 text-[11px] font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
        <Play className="h-3 w-3 fill-white" /> {formatCompactNumber(post.viewsCount)}
      </span>

      {/* Hover reveal (desktop): likes + comments centered (Instagram style) */}
      <div className="absolute inset-0 flex items-center justify-center gap-5 bg-black/45 opacity-0 backdrop-blur-[1px] transition-opacity duration-200 group-hover:opacity-100">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-white">
          <Heart className="h-4 w-4 fill-white" /> {formatCompactNumber(post.likesCount)}
        </span>
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-white">
          <MessageCircle className="h-4 w-4 fill-white" /> {formatCompactNumber(post.commentsCount)}
        </span>
      </div>
    </>
  );
}
