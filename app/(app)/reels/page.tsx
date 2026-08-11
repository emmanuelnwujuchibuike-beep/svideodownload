import type { Metadata } from "next";
import { Suspense } from "react";

import { ReelsFeed } from "@/features/reels/reels-feed";
import { LoadingStripe } from "@/features/ui/page-loader";
import { getFeedItemById, getHomeFeed } from "@/lib/social/home-feed";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reels",
  robots: { index: false, follow: false },
};

/**
 * /reels — the full-screen, infinite, TikTok-style reels experience. Tapping a
 * video anywhere in the app (feed, trending rail) lands here via `?start=<id>`
 * so every entry point opens the same rich deck (tabs, scrubber, double-tap
 * like, infinite scroll) instead of only being reachable through "View all".
 */
/*
  🔴 Synchronous shell, streamed data — the cold-entry white-screen fix
  (owner, 2026-08-11). Same structural change as /home and /downloads: this
  awaited `searchParams`, `auth.getUser()` and a 24-item feed query at the top
  level, so Next held the whole HTML response and the visitor saw a white
  document instead of the shell plus the stripe. See the long note in
  app/(app)/home/page.tsx for why `loading.tsx` alone cannot fix this.

  The fallback is BLACK rather than the usual page ground: this route paints a
  full-screen black deck, and a white flash before it would be worse than the
  white screen being fixed. The stripe sits at the very top where the reel's own
  chrome will be.
*/
export default function ReelsPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-30 bg-black" aria-busy="true">
          <div className="pt-[var(--frenz-safe-top)]">
            <LoadingStripe />
          </div>
        </div>
      }
    >
      <ReelsData searchParams={searchParams} />
    </Suspense>
  );
}

async function ReelsData({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const { start } = await searchParams;

  let viewerId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewerId = user?.id ?? null;
  } catch {
    /* anon — reels are public discovery */
  }

  // Pull a wide first page of the Reels product's OWN feed (format='reel'
  // posts only). The Following tab is fetched client-side on demand.
  const page = await getHomeFeed({ viewerId, sort: "for_you", offset: 0, limit: 24, format: "reel" });
  let reels = page.items.filter((i) => i.mediaKind === "video");

  if (start) {
    const seed = reels.find((r) => r.id === start) ?? (await getFeedItemById(start, viewerId));
    if (seed) reels = [seed, ...reels.filter((r) => r.id !== seed.id)];
  }

  return <ReelsFeed initialItems={reels} initialOffset={page.nextOffset} />;
}
