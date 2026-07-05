"use client";

import { BadgeCheck, ChevronRight, Heart, MessageCircle, Play } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

import { useQuery } from "@/features/data";
import { PostViewer } from "@/features/feed/post-viewer";
import { getApi } from "@/lib/sdk/browser";
import type { FeedItem } from "@/lib/social/home-feed";
import { cn, formatCompactNumber } from "@/lib/utils";

/** Featured carousel of top trending video posts. */
export function FeaturedHero({ initialItems }: { initialItems?: FeedItem[] }) {
  const { data, isLoading } = useQuery<FeedItem[]>(
    "home-feed:featured",
    async () => {
      try {
        const d = await getApi().action<{ items: FeedItem[] }>("/api/home-feed", { method: "GET", query: { sort: "trending", limit: 10 } });
        return (d.items ?? []).filter((i) => i.thumbnailUrl).slice(0, 6);
      } catch {
        return [];
      }
    },
    { initialData: initialItems },
  );
  const [idx, setIdx] = useState(0);
  const [viewer, setViewer] = useState<FeedItem | null>(null);

  // Cached-first: instant on return visits, silently revalidated in the background.
  const items = isLoading ? null : data ?? [];

  useEffect(() => {
    if (!items || items.length < 2) return;
    let t: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (t) return;
      t = setInterval(() => setIdx((n) => (n + 1) % items.length), 6000);
    };
    const stop = () => {
      if (t) clearInterval(t);
      t = null;
    };
    // Only advance while the tab is visible — no background wakeups (battery).
    const onVis = () => (document.hidden ? stop() : start());
    onVis();
    document.addEventListener("visibilitychange", onVis, { passive: true });
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [items]);

  if (items !== null && items.length === 0) return null;
  if (items === null) return <div className="aspect-[16/9] w-full rounded-3xl bg-secondary shimmer sm:aspect-[21/9]" />;

  // Clamp in case a background refresh returns fewer items than the current index.
  const post = items[idx % items.length]!;

  return (
    <section className="relative overflow-hidden rounded-3xl shadow-card">
      <button type="button" onClick={() => setViewer(post)} className="relative block aspect-[16/10] w-full text-left sm:aspect-[21/9]">
        <Image key={post.id} src={post.thumbnailUrl!} alt="" fill priority sizes="(min-width: 1024px) 66vw, 100vw" className="object-cover" />
        <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/10" />
        <span className="absolute inset-x-5 bottom-5 text-white sm:inset-x-7 sm:bottom-7">
          {post.category ? (
            <span className="inline-block rounded-md bg-violet-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">{post.category}</span>
          ) : null}
          <h2 className="mt-2 line-clamp-1 text-2xl font-extrabold tracking-[-0.02em] sm:text-3xl">{post.title}</h2>
          {post.description ? <p className="mt-1 line-clamp-1 max-w-lg text-sm text-white/80">{post.description}</p> : null}
          <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="flex items-center gap-1 font-medium">
              @{post.publisher.handle}
              {post.publisher.isVerified ? <BadgeCheck className="h-3.5 w-3.5" /> : null}
            </span>
            <span className="flex items-center gap-1 text-white/80"><Play className="h-3.5 w-3.5 fill-white" /> {formatCompactNumber(post.viewsCount)}</span>
            <span className="flex items-center gap-1 text-white/80"><Heart className="h-3.5 w-3.5" /> {formatCompactNumber(post.likesCount)}</span>
            <span className="flex items-center gap-1 text-white/80"><MessageCircle className="h-3.5 w-3.5" /> {formatCompactNumber(post.commentsCount)}</span>
          </span>
        </span>
      </button>

      {/* Next */}
      {items.length > 1 ? (
        <button type="button" onClick={() => setIdx((n) => (n + 1) % items.length)} aria-label="Next" className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white text-slate-900 shadow-lg transition hover:scale-105">
          <ChevronRight className="h-5 w-5" />
        </button>
      ) : null}

      {/* Dots */}
      {items.length > 1 ? (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5">
          {items.map((_, i) => (
            <button key={i} type="button" aria-label={`Slide ${i + 1}`} onClick={() => setIdx(i)} className={cn("h-1.5 rounded-full transition-all", i === idx ? "w-5 bg-white" : "w-1.5 bg-white/50")} />
          ))}
        </div>
      ) : null}

      <PostViewer item={viewer} onClose={() => setViewer(null)} />
    </section>
  );
}
