import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AppContent } from "@/features/app-shell/app-content";
import { FeedSkeleton } from "@/features/feed/feed-skeleton";
import { SmartFeed } from "@/features/feed/smart-feed";
import { LoadingStripe } from "@/features/ui/page-loader";
import { friendsCount } from "@/lib/social/friends";
import { getHomeFeed } from "@/lib/social/home-feed";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Feed",
  robots: { index: false, follow: false },
};

/**
 * /feed — the guest-accessible entry point into the feed (owner, 2026-08-18:
 * "users who haven't signed in can click on it from the landing page and
 * enter feed without loading... users who haven't signed in can watch feed
 * but can't interact").
 *
 * Deliberately NOT /home: /home is the signed-in, personalized dashboard
 * (Stories, Continue Watching, suggested creators, per-viewer module order)
 * and hard-redirects a signed-out visitor to /login. This route is the SAME
 * underlying feed (`getHomeFeed`/`SmartFeed`, unchanged) with none of that —
 * just the endless feed itself, reachable by anyone. A signed-in visitor who
 * lands here (e.g. via the Reels tray's Feed button) still gets their own
 * real feed and can interact normally; only a SIGNED-OUT visitor hits the
 * guest gate, enforced in feed-post-card.tsx per action, not by blocking the
 * route.
 *
 * Streams like /home (a synchronous shell + a Suspense-streamed feed, not
 * a blocking await) so a cold visit never holds the whole response on the
 * feed query — the shell + FeedSkeleton (the shared "global skeleton") paint
 * immediately, matching the sub-2s budget every cold-entry surface in this
 * app is held to.
 */
export default function FeedPage() {
  return (
    <Suspense
      fallback={
        <AppContent>
          <LoadingStripe />
          <FeedSkeleton count={3} />
        </AppContent>
      }
    >
      <FeedData />
    </Suspense>
  );
}

async function FeedData() {
  let viewerId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewerId = user?.id ?? null;
  } catch {
    /* anon — this route is deliberately public */
  }

  // Same reshuffle-per-open contract as /home and /reels — see either's own
  // note on why this is minted here AND re-detected client-side.
  const seed = randomUUID().slice(0, 8);
  const [page, friends] = await Promise.all([
    getHomeFeed({ viewerId, sort: "for_you", offset: 0, limit: 8, seed }),
    viewerId ? friendsCount(viewerId) : Promise.resolve(0),
  ]);

  return (
    <AppContent>
      {/* `initialAdInterval` is the server's own decision about ad cadence —
          see lib/feed/ad-slots.ts. This route is the PUBLIC feed and renders
          for logged-out visitors too; the slots are composed identically, and
          FeedAdSlot's own premium check is what suppresses them for
          subscribers. Posts never depend on an ad resolving. */}
      <SmartFeed
        initialItems={page.items}
        initialNextOffset={page.nextOffset}
        initialSeed={seed}
        friendCount={friends}
        initialAdInterval={page.adInterval}
      />
    </AppContent>
  );
}
