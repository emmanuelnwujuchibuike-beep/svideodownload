"use client";

import { Clapperboard } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { ReelDeck } from "@/features/feed/reel-viewer";
import type { FeedItem } from "@/lib/social/home-feed";

/**
 * Full-screen /reels experience — a fixed, vertical snap-scrolling column of
 * reels (TikTok-style). Never scrolls sideways (the deck owns a vertical scroll
 * only), and it loads more reels as you approach the end so the scroll feels
 * endless. Sits below the mobile nav so you can always navigate away.
 */
export function ReelsFeed({ initialItems, initialOffset }: { initialItems: FeedItem[]; initialOffset: number | null }) {
  const router = useRouter();
  const seen = useRef<Set<string>>(new Set(initialItems.map((i) => i.id)));
  const [items, setItems] = useState<FeedItem[]>(initialItems);
  const [offset, setOffset] = useState<number | null>(initialOffset);
  const loading = useRef(false);

  const loadMore = useCallback(async () => {
    if (loading.current || offset === null) return;
    loading.current = true;
    try {
      // Pull a wide page and keep the videos (reels), deduped.
      const res = await fetch(`/api/home-feed?sort=recent&offset=${offset}&limit=24`);
      if (res.ok) {
        const d = (await res.json()) as { items: FeedItem[]; nextOffset: number | null };
        const fresh = (d.items ?? []).filter((i) => i.mediaKind === "video" && !seen.current.has(i.id));
        for (const i of fresh) seen.current.add(i.id);
        if (fresh.length) setItems((prev) => [...prev, ...fresh]);
        setOffset(d.nextOffset);
      } else {
        setOffset(null);
      }
    } catch {
      /* keep what we have */
    } finally {
      loading.current = false;
    }
  }, [offset]);

  if (items.length === 0) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
        <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-500/15 to-violet-500/15 text-primary">
          <Clapperboard className="h-6 w-6" />
        </span>
        <p className="font-semibold">No reels yet</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">Follow creators or publish a video to see reels here.</p>
        <Link href="/explore" className="mt-4 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/25">
          Discover creators
        </Link>
      </div>
    );
  }

  return <ReelDeck items={items} startIndex={0} variant="page" onEndReached={loadMore} onClose={() => router.push("/home")} />;
}
