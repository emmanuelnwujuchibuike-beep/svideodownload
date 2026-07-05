"use client";

import { Clapperboard } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { BrandLoader } from "@/features/app-shell/brand-loader";
import { ReelDeck } from "@/features/feed/reel-viewer";
import type { FeedItem } from "@/lib/social/home-feed";
import { cn } from "@/lib/utils";

type Tab = "for_you" | "following";

/**
 * Full-screen /reels with a For You / Following toggle. "For You" is the
 * personalized deck (seeded from the server); "Following" refetches to reels only
 * from people you follow. Each tab keeps its own infinite scroll.
 */
export function ReelsFeed({ initialItems, initialOffset }: { initialItems: FeedItem[]; initialOffset: number | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Deep-linked from a "Comment" tap elsewhere (?start=<id>&comments=1) — the
  // seeded item sits at index 0 of the initial deck, so open its sheet on entry.
  const autoOpenCommentsId = searchParams.get("comments") === "1" ? searchParams.get("start") : null;
  // Prefer going back (Next reuses the cached render of wherever we came from —
  // instant, no server round-trip) and only push to /home when there's nowhere
  // to go back to (e.g. /reels was opened directly in a fresh tab).
  const close = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/home");
  }, [router]);
  const [tab, setTab] = useState<Tab>("for_you");
  const [items, setItems] = useState<FeedItem[]>(initialItems);
  const [offset, setOffset] = useState<number | null>(initialOffset);
  const [switching, setSwitching] = useState(false);
  const seen = useRef<Set<string>>(new Set(initialItems.map((i) => i.id)));
  const loading = useRef(false);

  const fetchPage = useCallback(async (sort: Tab, off: number) => {
    try {
      const res = await fetch(`/api/home-feed?sort=${sort}&offset=${off}&limit=24`);
      if (!res.ok) return { items: [] as FeedItem[], nextOffset: null as number | null };
      return (await res.json()) as { items: FeedItem[]; nextOffset: number | null };
    } catch {
      return { items: [] as FeedItem[], nextOffset: null as number | null };
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loading.current || offset === null) return;
    loading.current = true;
    try {
      const d = await fetchPage(tab, offset);
      const fresh = (d.items ?? []).filter((i) => i.mediaKind === "video" && !seen.current.has(i.id));
      for (const i of fresh) seen.current.add(i.id);
      if (fresh.length) setItems((prev) => [...prev, ...fresh]);
      setOffset(d.nextOffset);
    } finally {
      loading.current = false;
    }
  }, [offset, tab, fetchPage]);

  const switchTab = useCallback(
    async (next: Tab) => {
      if (next === tab || switching) return;
      setTab(next);
      setSwitching(true);
      seen.current = new Set();
      setItems([]);
      setOffset(null);
      const d = await fetchPage(next, 0);
      const fresh = (d.items ?? []).filter((i) => i.mediaKind === "video" && !seen.current.has(i.id));
      for (const i of fresh) seen.current.add(i.id);
      setItems(fresh);
      setOffset(d.nextOffset);
      setSwitching(false);
    },
    [tab, switching, fetchPage],
  );

  return (
    <>
      {/* For You / Following toggle — floating glass pill */}
      <div className="fixed left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/35 p-1 ring-1 ring-inset ring-white/15 backdrop-blur-md lg:top-[4.75rem]">
        {([
          { id: "for_you" as const, label: "For You" },
          { id: "following" as const, label: "Following" },
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => switchTab(t.id)}
            aria-pressed={tab === t.id}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-bold transition active:scale-95",
              tab === t.id ? "bg-white text-black shadow-sm" : "text-white/85 hover:text-white",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {switching ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black" aria-hidden>
          <BrandLoader size={60} delayMs={0} overlay={false} />
        </div>
      ) : items.length === 0 ? (
        <div className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center">
          <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-3xl bg-secondary text-muted-foreground">
            <Clapperboard className="h-6 w-6" />
          </span>
          <p className="font-semibold">{tab === "following" ? "No reels from people you follow" : "No reels yet"}</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            {tab === "following"
              ? "Follow more creators to fill your Following reels."
              : "Follow creators or publish a video to see reels here."}
          </p>
          <Link href="/explore" className="mt-4 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white shadow-md brand-glow">
            Discover creators
          </Link>
        </div>
      ) : (
        <ReelDeck
          key={tab}
          items={items}
          startIndex={0}
          variant="page"
          onEndReached={loadMore}
          onClose={close}
          autoOpenCommentsId={tab === "for_you" ? autoOpenCommentsId : null}
        />
      )}
    </>
  );
}
