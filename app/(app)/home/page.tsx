import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AppContent } from "@/features/app-shell/app-content";
import { BrandSplash } from "@/features/app-shell/brand-splash";
import { ContinueWatching } from "@/features/app-shell/dashboard/continue-watching";
import { FeaturedHero } from "@/features/app-shell/dashboard/featured-hero";
import { HomeDownloadBar } from "@/features/app-shell/dashboard/home-download-bar";
import { HomeGreeting } from "@/features/app-shell/dashboard/home-greeting";
import { HomeRail } from "@/features/app-shell/dashboard/home-rail";
import { LatestNewsTabs } from "@/features/app-shell/dashboard/latest-news";
import { StoriesRow } from "@/features/app-shell/dashboard/stories-row";
import { TrendingReels } from "@/features/app-shell/dashboard/trending-reels";
import { getHomeProfile } from "@/lib/social/home";
import { getHomeFeed } from "@/lib/social/home-feed";
import { getActiveStories } from "@/lib/social/stories";
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

  // Fetch everything the page needs in parallel and SEED the feed surfaces server
  // side, so stories/featured/reels render in the initial HTML instead of after a
  // client round-trip. All cached (20s) so this stays cheap.
  const [profile, suggestions, forYou, recent, storyGroups] = await Promise.all([
    getHomeProfile(user.id),
    getSuggestedCreators(user.id, 5),
    getHomeFeed({ viewerId: user.id, sort: "for_you", limit: 10 }),
    getHomeFeed({ viewerId: user.id, sort: "recent", limit: 15 }),
    getActiveStories(user.id, 24),
  ]);
  if (!profile?.handle) redirect("/welcome");

  const firstName = profile.displayName.split(" ")[0] ?? "there";
  // Match each component's own client-side filter exactly, so the seed equals what
  // the background revalidation returns (no visible swap).
  const featuredItems = forYou.items.filter((i) => i.thumbnailUrl).slice(0, 6);
  const reelItems = recent.items.filter((i) => i.mediaKind === "video").slice(0, 8);
  // Brand splash only on the very first home open (cookie-gated so it never
  // flashes on repeat visits or other pages).
  const firstVisit = !(await cookies()).get("frenz_welcomed");

  return (
    <AppContent rightRail={<HomeRail suggestions={suggestions} />}>
      {firstVisit ? <BrandSplash /> : null}
      <div className="space-y-6">
        <HomeGreeting name={firstName} />
        <StoriesRow initialGroups={storyGroups} />
        <FeaturedHero initialItems={featuredItems} />
        <TrendingReels initialItems={reelItems} />
        <ContinueWatching />
        <LatestNewsTabs />
      </div>
      <HomeDownloadBar />
    </AppContent>
  );
}
