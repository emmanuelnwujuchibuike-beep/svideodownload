import type { Metadata } from "next";

import { ReelsFeed } from "@/features/reels/reels-feed";
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
export default async function ReelsPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
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

  // Pull a wide first page (personalized "For You") and keep the videos so the
  // deck opens full. The Following tab is fetched client-side on demand.
  const page = await getHomeFeed({ viewerId, sort: "for_you", offset: 0, limit: 24 });
  let reels = page.items.filter((i) => i.mediaKind === "video");

  if (start) {
    const seed = reels.find((r) => r.id === start) ?? (await getFeedItemById(start, viewerId));
    if (seed) reels = [seed, ...reels.filter((r) => r.id !== seed.id)];
  }

  return <ReelsFeed initialItems={reels} initialOffset={page.nextOffset} />;
}
