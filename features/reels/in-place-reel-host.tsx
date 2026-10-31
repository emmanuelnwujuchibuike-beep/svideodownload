"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { setReelOpener } from "@/features/reels/reel-open-store";
import type { FeedItem } from "@/lib/social/home-feed";
import { reelsViewHref } from "@/lib/social/post-url";

const ReelsFeed = dynamic(() => import("@/features/reels/reels-feed").then((m) => m.ReelsFeed), { ssr: false });

/** A brief wait is just black; only a slow one shows the spinner. */
const SPINNER_AFTER_MS = 250;

/**
 * The in-place Reels deck for video tiles (features/reels/reel-open-store.ts). One mount in the signed-in shell's
 * deferred island. A tap fetches the ONE tapped item (/api/posts/:id/feed-item — the same read the profile grid
 * uses), then opens ReelsFeed on it with For You continuing after it, exactly like /reels?start=<id> — minus the
 * server-rendered page and its loading screen. If the item can't be read, it navigates to that link instead.
 */
export function InPlaceReelHost() {
  const router = useRouter();
  const [item, setItem] = useState<FeedItem | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const busy = useRef(false);

  useEffect(
    () =>
      setReelOpener((id) => {
        if (busy.current) return;
        busy.current = true;
        setPending(id);
        setSlow(false);
        void fetch(`/api/posts/${encodeURIComponent(id)}/feed-item`)
          .then((r) => (r.ok ? (r.json() as Promise<{ item?: FeedItem }>) : null))
          .catch(() => null)
          .then((j) => {
            busy.current = false;
            setPending(null);
            if (j?.item && j.item.mediaKind === "video") setItem(j.item);
            else router.push(reelsViewHref(id));
          });
      }),
    [router],
  );

  useEffect(() => {
    if (!pending) return;
    const t = window.setTimeout(() => setSlow(true), SPINNER_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [pending]);

  if (item) return <ReelsFeed key={item.id} initialItems={[item]} initialOffset={0} startId={item.id} onClose={() => setItem(null)} />;
  if (!pending) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black" role="status" aria-label="Opening video">
      {slow ? <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/25 border-t-white motion-reduce:animate-none" /> : null}
    </div>
  );
}
