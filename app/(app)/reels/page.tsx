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
/*
  🔴 REELS DELIBERATELY DOES NOT STREAM A SHELL (owner, 2026-08-11: "the reels
  page now loads before opening, i dont want that").

  For one commit this page was synchronous with a `<Suspense>`d child, matching
  /home and /u/[handle], so a cold document request could flush a black screen
  and a stripe instead of white. That was right for those routes and wrong for
  this one, and the reason is worth recording.

  A Suspense boundary is not only a cold-entry mechanism — it is also what Next
  paints during a CLIENT navigation. Reels is reached from the tab bar many times
  a session, and on every one of those the boundary resolved BEFORE the deck and
  showed a full-screen black loading state first. Watching a reel is meant to
  begin the instant you tap; a loading screen in front of a route someone enters
  constantly costs far more than a brief white screen on the rare cold entry
  straight to /reels.

  It is also no longer the surface that needs it: the PWA's cold entry is
  `public/launch.html`, which paints its branded loader before the origin
  answers, so the case this boundary was added for is covered somewhere it does
  not tax a hot path.

  `loading.tsx` stays for this segment — a 2px stripe under the persistent app
  bar is not a screen and costs a navigation nothing.
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
