import { Eye, Image as ImageIcon, Music, Play } from "lucide-react";
import Link from "next/link";

import type { PostCard } from "@/lib/social/posts";
import { formatCompactNumber } from "@/lib/utils";

const KIND_ICON = { video: Play, image: ImageIcon, audio: Music } as const;

/** Responsive grid of post cards (profile posts, related, explore). */
export function PostGrid({ posts, emptyText = "No posts yet." }: { posts: PostCard[]; emptyText?: string }) {
  if (posts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground">
        {emptyText}
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

function PostCardItem({ post }: { post: PostCard }) {
  const KindIcon = KIND_ICON[post.mediaKind] ?? Play;
  return (
    <Link
      href={`/p/${post.id}`}
      className="group overflow-hidden rounded-2xl border border-border/70 bg-card shadow-soft transition hover:-translate-y-0.5 hover:shadow-card"
    >
      <div className="relative aspect-video overflow-hidden bg-neutral-950">
        {post.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover opacity-90 transition group-hover:scale-105 group-hover:opacity-100"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/25">
            <KindIcon className="h-8 w-8" />
          </div>
        )}
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-md">
          <Eye className="h-3 w-3" /> {formatCompactNumber(post.viewsCount)}
        </span>
      </div>
      <div className="p-2.5">
        <p className="line-clamp-2 text-xs font-semibold leading-snug">{post.title}</p>
        <p className="mt-1 text-[11px] capitalize text-muted-foreground">
          {post.platform}
          {post.category ? ` · ${post.category}` : ""}
        </p>
      </div>
    </Link>
  );
}
