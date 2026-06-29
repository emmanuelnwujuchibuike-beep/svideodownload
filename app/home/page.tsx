import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/features/app-shell/app-shell";
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

  const [profile, feed, suggestions] = await Promise.all([
    getHomeProfile(user.id),
    getHomeFeed({ viewerId: user.id, sort: "for_you", offset: 0, limit: 8 }),
    getSuggestedCreators(user.id, 4),
  ]);

  return (
    <AppShell handle={profile?.handle ?? null} profile={profile} suggestions={suggestions}>
      <HomeHero />
      <FeedClient initialItems={feed.items} initialNextOffset={feed.nextOffset} />
      <DownloadDock />
    </AppShell>
  );
}
