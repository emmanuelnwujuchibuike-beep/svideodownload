import type { Metadata } from "next";
import { IoSparklesSharp } from "react-icons/io5";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppContent } from "@/features/app-shell/app-content";
import { BrandSplash } from "@/features/app-shell/brand-splash";
import { HomeGreeting } from "@/features/app-shell/dashboard/home-greeting";
import { HomeRail } from "@/features/app-shell/dashboard/home-rail";
import { StoriesRow } from "@/features/app-shell/dashboard/stories-row";
import { TrendingReels } from "@/features/app-shell/dashboard/trending-reels";
import { FeedSkeleton } from "@/features/feed/feed-skeleton";
import { SuggestionsLauncher } from "@/features/friends/suggestions-launcher";
import { SmartFeed } from "@/features/feed/smart-feed";
import { Skeleton } from "@/features/ui/skeleton";
import { friendsCount } from "@/lib/social/friends";
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
        <div className="hidden w-80 shrink-0 xl:block">
          {/* Fixed rail (Instagram-style): stays put while the feed scrolls, so
              there's never empty space beside a long feed. */}
          <div className="sticky top-16 max-h-[calc(100vh-4.5rem)] overflow-y-auto py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Suspense fallback={<Skeleton className="h-64 w-full rounded-2xl" />}>
              <RailSection viewerId={viewerId} />
            </Suspense>
          </div>
        </div>
      }
    >
      {firstVisit ? <BrandSplash /> : null}
      <div className="space-y-6">
        <div className="flex">
          <SuggestionsLauncher />
        </div>
        <HomeGreeting name={firstName} />

        <Suspense fallback={<StoriesSkeleton />}>
          <StoriesSection viewerId={viewerId} avatarUrl={profile.avatarUrl} name={profile.displayName} />
        </Suspense>

        <Suspense fallback={<ReelsSkeleton />}>
          <ReelsSection viewerId={viewerId} />
        </Suspense>

        {/* Smart Feed — the intelligent, blended, endless heart of the home
            experience. Rendered last because it never ends. */}
        <div className="pt-2">
          <h2 className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/30">
              <IoSparklesSharp className="h-4 w-4" />
            </span>
            <span className="text-gradient">Your Smart Feed</span>
          </h2>
          <Suspense fallback={<FeedSkeleton count={3} />}>
            <SmartFeedSection viewerId={viewerId} />
          </Suspense>
        </div>
      </div>
    </AppContent>
  );
}

/* ── Streamed sections: each awaits only its own slice ─────────────────────── */

async function StoriesSection({
  viewerId,
  avatarUrl,
  name,
}: {
  viewerId: string;
  avatarUrl: string | null;
  name: string;
}) {
  const groups = await getActiveStories(viewerId, 24);
  return <StoriesRow initialGroups={groups} viewerAvatarUrl={avatarUrl} viewerName={name} />;
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

async function SmartFeedSection({ viewerId }: { viewerId: string }) {
  const [page, friends] = await Promise.all([
    getHomeFeed({ viewerId, sort: "for_you", offset: 0, limit: 8 }),
    friendsCount(viewerId),
  ]);
  return (
    <SmartFeed initialItems={page.items} initialNextOffset={page.nextOffset} friendCount={friends} />
  );
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
