"use client";

import { BadgeCheck, Flame, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { useQuery } from "@/features/data";
import { ReelsFeed } from "@/features/reels/reels-feed";
import { getApi } from "@/lib/sdk/browser";
import type { FeedItem } from "@/lib/social/home-feed";
import { formatCompactNumber } from "@/lib/utils";

const FALLBACK = ["from-rose-500 to-fuchsia-600", "from-sky-500 to-blue-600", "from-violet-500 to-purple-600", "from-amber-500 to-orange-600", "from-emerald-500 to-teal-600"];

/** Trending Reels rail — real recent video posts; tap to play inline. */
export function TrendingReels({ initialItems }: { initialItems?: FeedItem[] }) {
  const { data, isLoading } = useQuery<FeedItem[]>(
    "home-feed:reels",
    async () => {
      try {
        const d = await getApi().action<{ items: FeedItem[] }>("/api/home-feed", { method: "GET", query: { sort: "recent", limit: 15 } });
        return (d.items ?? []).filter((i) => i.mediaKind === "video").slice(0, 8);
      } catch {
        return [];
      }
    },
    { initialData: initialItems },
  );
  const [startId, setStartId] = useState<string | null>(null);
  // Cached-first: instant on return visits, silently revalidated in the background.
  const items = isLoading ? null : data ?? [];
  if (items !== null && items.length === 0) return null;

  return (
    <section className="mt-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-secondary text-foreground">
            <Flame className="h-3.5 w-3.5" />
          </span>
          Trending Reels
        </h2>
        <Link href="/reels" className="text-xs font-semibold text-primary hover:underline">View all</Link>
      </div>

      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items === null
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="aspect-[9/14] w-36 shrink-0 rounded-2xl bg-secondary shimmer" />
            ))
          : items.map((item, i) => (
              // Opens the full tabbed reels instantly in place (no navigation lag).
              <button
                key={item.id}
                type="button"
                onClick={() => setStartId(item.id)}
                className="group relative aspect-[9/14] w-36 shrink-0 overflow-hidden rounded-2xl text-left shadow-soft ring-1 ring-border/60 transition hover:-translate-y-1 hover:shadow-card"
              >
                {item.thumbnailUrl ? (
                  <Image src={item.thumbnailUrl} alt="" fill sizes="144px" className="object-cover transition duration-300 group-hover:scale-105" />
                ) : item.mediaUrl ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video src={`${item.mediaUrl}#t=0.5`} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                ) : (
                  <span className={`absolute inset-0 bg-gradient-to-br ${FALLBACK[i % FALLBACK.length]}`} />
                )}
                <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/25 backdrop-blur"><Play className="h-5 w-5 fill-white text-white" /></span>
                </span>
                <span className="absolute inset-x-2 bottom-2 text-white">
                  <span className="flex items-center gap-1 text-xs font-semibold">
                    <span className="truncate">@{item.publisher.handle}</span>
                    {item.publisher.isVerified ? <BadgeCheck className="h-3 w-3 shrink-0" /> : null}
                  </span>
                  <span className="mt-0.5 line-clamp-1 text-[10px] text-white/80">{item.title}</span>
                  <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-white/70"><Play className="h-2.5 w-2.5 fill-white" /> {formatCompactNumber(item.viewsCount)}</span>
                </span>
              </button>
            ))}
      </div>

      {startId && items ? (
        <ReelsFeed initialItems={items} initialOffset={null} startId={startId} onClose={() => setStartId(null)} />
      ) : null}
    </section>
  );
}
