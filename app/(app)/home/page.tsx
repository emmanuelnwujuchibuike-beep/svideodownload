import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

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
import { Skeleton } from "@/features/ui/skeleton";
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

  // Only the identity check blocks the first paint (it decides the redirects and
  // the greeting name). Every content rail streams in behind its own Suspense
  // boundary, so the shell + greeting appear instantly instead of waiting on the
  // slowest feed query — the "instant, then fill" feel.
  const profile = await getHomeProfile(user.id);
  if (!profile?.handle) redirect("/welcome");

  const firstName = profile.displayName.split(" ")[0] ?? "there";
  const firstVisit = !(await cookies()).get("frenz_welcomed");
  const viewerId = user.id;

  return (
    <AppContent
      rightRail={
        <div className="hidden w-80 shrink-0 py-4 xl:block">
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-2xl" />}>
            <RailSection viewerId={viewerId} />
          </Suspense>
        </div>
      }
    >
      {firstVisit ? <BrandSplash /> : null}
      <div className="space-y-6">
        <HomeGreeting name={firstName} />

        <Suspense fallback={<StoriesSkeleton />}>
          <StoriesSection viewerId={viewerId} />
        </Suspense>

        <Suspense fallback={<Skeleton className="aspect-[16/10] w-full rounded-3xl sm:aspect-[21/9]" />}>
          <FeaturedSection viewerId={viewerId} />
        </Suspense>

        <Suspense fallback={<ReelsSkeleton />}>
          <ReelsSection viewerId={viewerId} />
        </Suspense>

        <ContinueWatching />
        <LatestNewsTabs />
      </div>
      <HomeDownloadBar />
    </AppContent>
  );
}

/* ── Streamed sections: each awaits only its own slice ─────────────────────── */

async function StoriesSection({ viewerId }: { viewerId: string }) {
  const groups = await getActiveStories(viewerId, 24);
  return <StoriesRow initialGroups={groups} />;
}

async function FeaturedSection({ viewerId }: { viewerId: string }) {
  const forYou = await getHomeFeed({ viewerId, sort: "for_you", limit: 10 });
  const featuredItems = forYou.items.filter((i) => i.thumbnailUrl).slice(0, 6);
  return <FeaturedHero initialItems={featuredItems} />;
}

async function ReelsSection({ viewerId }: { viewerId: string }) {
  const recent = await getHomeFeed({ viewerId, sort: "recent", limit: 15 });
  const reelItems = recent.items.filter((i) => i.mediaKind === "video").slice(0, 8);
  return <TrendingReels initialItems={reelItems} />;
}

async function RailSection({ viewerId }: { viewerId: string }) {
  const suggestions = await getSuggestedCreators(viewerId, 5);
  return <HomeRail suggestions={suggestions} />;
}

/* ── Section skeletons ─────────────────────────────────────────────────────── */

function StoriesSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
          <Skeleton className="h-16 w-16 rounded-full" />
          <Skeleton className="h-2.5 w-12" />
        </div>
      ))}
    </div>
  );
}

function ReelsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-5 w-40" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[9/14] w-36 shrink-0 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
