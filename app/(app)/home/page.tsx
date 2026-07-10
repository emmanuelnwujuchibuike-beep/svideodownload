import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppContent } from "@/features/app-shell/app-content";
import { BrandSplash } from "@/features/app-shell/brand-splash";
import { ContinueWatching } from "@/features/app-shell/dashboard/continue-watching";
import { FriendActivity } from "@/features/app-shell/dashboard/friend-activity";
import { HomeRail } from "@/features/app-shell/dashboard/home-rail";
import { StoriesRow } from "@/features/app-shell/dashboard/stories-row";
import { TrendingReels } from "@/features/app-shell/dashboard/trending-reels";
import { FeedSkeleton } from "@/features/feed/feed-skeleton";
import { SmartFeed } from "@/features/feed/smart-feed";
import { Skeleton } from "@/features/ui/skeleton";
import { getFriendActivity } from "@/lib/social/friend-activity";
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
        <Suspense fallback={<StoriesSkeleton />}>
          <StoriesSection
            viewerId={viewerId}
            avatarUrl={profile.avatarUrl}
            name={profile.displayName}
            handle={profile.handle}
          />
        </Suspense>

        {/* Relationship-first, above the global Trending rail — the spec's own
            "most important module". Renders nothing for viewers with no
            friends or no recent friend activity (no fake placeholder rows). */}
        <Suspense fallback={<FriendActivitySkeleton />}>
          <FriendActivitySection viewerId={viewerId} />
        </Suspense>

        <Suspense fallback={<ReelsSkeleton />}>
          <ReelsSection viewerId={viewerId} />
        </Suspense>

        {/* Client-only, no server data dependency (reads live download/history
            state) — renders nothing when there's nothing to resume, so it
            never needs a Suspense boundary or a skeleton. */}
        <ContinueWatching />

        {/* Smart Feed — the intelligent, blended, endless heart of the home
            experience. Rendered last because it never ends. */}
        <Suspense fallback={<FeedSkeleton count={3} />}>
          <SmartFeedSection viewerId={viewerId} />
        </Suspense>
      </div>
    </AppContent>
  );
}

/* ── Streamed sections: each awaits only its own slice ─────────────────────── */

async function StoriesSection({
  viewerId,
  avatarUrl,
  name,
  handle,
}: {
  viewerId: string;
  avatarUrl: string | null;
  name: string;
  handle: string;
}) {
  const groups = await getActiveStories(viewerId, 24);
  return <StoriesRow initialGroups={groups} viewerAvatarUrl={avatarUrl} viewerName={name} viewerHandle={handle} />;
}

async function FriendActivitySection({ viewerId }: { viewerId: string }) {
  const items = await getFriendActivity(viewerId, 8);
  return <FriendActivity items={items} />;
}

async function ReelsSection({ viewerId }: { viewerId: string }) {
  // The home rail previews the Reels product — its own format, not feed posts.
  // Genuinely hot (not just newest) — see the `sort: "trending"` doc in
  // lib/social/home-feed.ts for why "recent" was the wrong sort here.
  const hot = await getHomeFeed({ viewerId, sort: "trending", limit: 15, format: "reel" });
  const reelItems = hot.items.filter((i) => i.mediaKind === "video").slice(0, 8);
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

function FriendActivitySkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      <Skeleton className="h-5 w-36" />
      {Array.from({ length: 2 }).map((_, i) => (
        <Skeleton key={i} className="h-[52px] w-full rounded-2xl" />
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
