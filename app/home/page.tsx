import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/features/app-shell/app-shell";
import { ContinueWatching } from "@/features/app-shell/dashboard/continue-watching";
import { FeaturedHero } from "@/features/app-shell/dashboard/featured-hero";
import { HomeDownloadBar } from "@/features/app-shell/dashboard/home-download-bar";
import { HomeGreeting } from "@/features/app-shell/dashboard/home-greeting";
import { HomeRail } from "@/features/app-shell/dashboard/home-rail";
import { LatestNewsTabs } from "@/features/app-shell/dashboard/latest-news";
import { StoriesRow } from "@/features/app-shell/dashboard/stories-row";
import { TrendingReels } from "@/features/app-shell/dashboard/trending-reels";
import { getHomeProfile } from "@/lib/social/home";
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

  // Fetch profile + suggestions in parallel (one round trip, not two) so the
  // page's HTML starts streaming sooner on first load.
  const [profile, suggestions] = await Promise.all([
    getHomeProfile(user.id),
    getSuggestedCreators(user.id, 5),
  ]);
  if (!profile?.handle) redirect("/welcome");

  const firstName = profile.displayName.split(" ")[0] ?? "there";

  return (
    <AppShell handle={profile.handle} rightRail={<HomeRail suggestions={suggestions} />}>
      <div className="space-y-6">
        <HomeGreeting name={firstName} />
        <StoriesRow />
        <FeaturedHero />
        <TrendingReels />
        <ContinueWatching />
        <LatestNewsTabs />
      </div>
      <HomeDownloadBar />
    </AppShell>
  );
}
