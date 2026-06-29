import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/features/app-shell/app-shell";
import { ExploreCategories } from "@/features/app-shell/dashboard/explore-categories";
import { JoinCommunities } from "@/features/app-shell/dashboard/join-communities";
import { LatestNewsTabs } from "@/features/app-shell/dashboard/latest-news";
import { TrendingReels } from "@/features/app-shell/dashboard/trending-reels";
import { DownloadDock } from "@/features/app-shell/download-dock";
import { HomeHero } from "@/features/app-shell/home-hero";
import { FeedClient } from "@/features/feed/feed-client";
import { getHomeProfile } from "@/lib/social/home";
import { getHomeFeed } from "@/lib/social/home-feed";
import { getSuggestedCreators } from "@/lib/social/suggest";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Home",
  robots: { index: false, follow: false },
};

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/home");

  const profile = await getHomeProfile(user.id);
  // Onboarding gate: a username must be claimed before using the app.
  if (!profile?.handle) redirect("/welcome");

  const [feed, suggestions] = await Promise.all([
    getHomeFeed({ viewerId: user.id, sort: "for_you", offset: 0, limit: 8 }),
    getSuggestedCreators(user.id, 4),
  ]);

  return (
    <AppShell handle={profile?.handle ?? null} profile={profile} suggestions={suggestions}>
      <HomeHero />
      <TrendingReels />
      <ExploreCategories />
      <LatestNewsTabs />
      <JoinCommunities />
      <div className="mt-6">
        <FeedClient initialItems={feed.items} initialNextOffset={feed.nextOffset} />
      </div>
      <DownloadDock />
    </AppShell>
  );
}
