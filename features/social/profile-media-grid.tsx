"use client";

import { Eye, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PostCover } from "@/components/social/post-grid";
import { ProfileVideoPlayer } from "@/features/social/profile-video-player";
import type { PostCard } from "@/lib/social/posts";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * Profile content grid. Videos play right here (a fullscreen in-profile player
 * over the profile's videos) instead of navigating away; photos/other tiles open
 * their post page. Two layouts: "reel" (9:16 tiles) and "card" (titled cards).
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
      <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  const openVideo = (p: PostCard) => {
    const idx = videos.findIndex((v) => v.id === p.id);
    setPlayIndex(idx < 0 ? 0 : idx);
  };
  const isPlayable = (p: PostCard) => p.mediaKind === "video" && !!p.mediaUrl;

  const grid =
    layout === "reel" ? (
      <div className="grid grid-cols-3 gap-1 sm:gap-1.5 md:grid-cols-4 lg:grid-cols-5">
        {posts.map((p) =>
          isPlayable(p) ? (
            <button key={p.id} type="button" onClick={() => openVideo(p)} className="group relative aspect-[9/16] overflow-hidden bg-neutral-950 text-left sm:rounded-lg">
              <ReelTileInner post={p} />
            </button>
          ) : (
            <Link key={p.id} href={`/p/${p.id}`} className="group relative aspect-[9/16] overflow-hidden bg-neutral-950 sm:rounded-lg">
              <ReelTileInner post={p} />
            </Link>
          ),
        )}
      </div>
    ) : (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {posts.map((p) =>
          isPlayable(p) ? (
            <button key={p.id} type="button" onClick={() => openVideo(p)} className="group overflow-hidden rounded-2xl border border-border/70 bg-card text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-card">
              <CardTileInner post={p} />
            </button>
          ) : (
            <Link key={p.id} href={`/p/${p.id}`} className="group overflow-hidden rounded-2xl border border-border/70 bg-card shadow-soft transition hover:-translate-y-0.5 hover:shadow-card">
              <CardTileInner post={p} />
            </Link>
          ),
        )}
      </div>
    );

  return (
    <>
      {grid}
      <ProfileVideoPlayer
        posts={playIndex !== null ? videos : null}
        startIndex={playIndex ?? 0}
        onClose={() => setPlayIndex(null)}
      />
    </>
  );
}

function ReelTileInner({ post }: { post: PostCard }) {
  return (
    <>
      <PostCover post={post} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent" />
      {post.mediaKind === "video" ? <Play className="absolute left-2 top-2 h-4 w-4 fill-white/90 text-white/90 drop-shadow" /> : null}
      <span className="absolute bottom-1.5 left-2 inline-flex items-center gap-1 text-[11px] font-semibold text-white drop-shadow">
        <Eye className="h-3 w-3" /> {formatCompactNumber(post.viewsCount)}
      </span>
    </>
  );
}

function CardTileInner({ post }: { post: PostCard }) {
  return (
    <>
      <div className="relative aspect-video overflow-hidden bg-neutral-950">
        <PostCover post={post} className={cn("h-full w-full object-cover opacity-90 transition group-hover:scale-105 group-hover:opacity-100")} />
        {post.mediaKind === "video" ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 backdrop-blur">
              <Play className="h-5 w-5 fill-white text-white" />
            </span>
          </span>
        ) : null}
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-md">
          <Eye className="h-3 w-3" /> {formatCompactNumber(post.viewsCount)}
        </span>
      </div>
      <div className="p-2.5">
        <p className="line-clamp-2 text-xs font-semibold leading-snug">{post.title}</p>
        {post.category ? <p className="mt-1 text-[11px] capitalize text-muted-foreground">{post.category}</p> : null}
      </div>
    </>
  );
}
