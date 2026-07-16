import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppContent } from "@/features/app-shell/app-content";
import { BrandSplash } from "@/features/app-shell/brand-splash";
import { ContinueWatching } from "@/features/app-shell/dashboard/continue-watching";
import { HiddenModulesNotice } from "@/features/app-shell/dashboard/hidden-modules-notice";
import { HomeRail } from "@/features/app-shell/dashboard/home-rail";
import { StoriesRow } from "@/features/app-shell/dashboard/stories-row";
import { TrendingReels } from "@/features/app-shell/dashboard/trending-reels";
import { FeedSkeleton } from "@/features/feed/feed-skeleton";
import { SmartFeed } from "@/features/feed/smart-feed";
import { Skeleton } from "@/features/ui/skeleton";
import { friendsCount } from "@/lib/social/friends";
import { getHomeProfile } from "@/lib/social/home";
import { getHomeFeed } from "@/lib/social/home-feed";
import { getHomePreferences, type HomeModuleKey } from "@/lib/social/home-preferences";
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
  //
  // profile, prefs and the cookie store are fetched IN PARALLEL (each only
  // needs user.id, none depends on another) — they used to run as three
  // sequential awaits, stacking three round-trips onto the one path that gates
  // /home's first paint. On a slow connection that stacked latency was a real
  // part of "home is slow to come up at all" (owner report 2026-07-16). getUser
  // above must still resolve first (it decides the auth redirect + owns user.id).
  const viewerId = user.id;
  const [profile, prefs, cookieStore] = await Promise.all([
    getHomeProfile(user.id),
    // Feature 17 Part 13 — the viewer's own Home Module Editor choices
    // (reorder/hide Stories, Friend Activity, Trending Reels, Continue
    // Watching) + Quiet Mode. Best-effort: defaults if the table's unmigrated
    // or the row doesn't exist yet.
    getHomePreferences(user.id),
    cookies(),
  ]);
  if (!profile?.handle) redirect("/welcome");
  const handle = profile.handle; // narrowed to `string` here; `profile.handle`'s own
  // type stays `string | null` inside closures (e.g. the module-order .map()
  // below), so this local binding is what those closures should reference.

  const firstVisit = !cookieStore.get("frenz_welcomed");
  const visibleModules = prefs.moduleOrder.filter((k) => !prefs.hiddenModules.includes(k));

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
        {/* Home Module Editor order (account settings), optional sections only
            — the main feed below is never reorderable, it's infinite. */}
        {visibleModules.map((key) =>
          renderModule(key, {
            viewerId,
            profile: { avatarUrl: profile.avatarUrl, displayName: profile.displayName, handle },
          }),
        )}

        {/* Renders NOTHING unless this viewer has actually hidden something, so
            it never becomes clutter for the common case. It exists because
            hiding a module was one accidental tap away with no visible path
            back — the only route to restore was /account → "Home & feed",
            buried down a long settings page (owner: "i dont even see the
            toggle"). Sits where the missing section would have been. */}
        <HiddenModulesNotice hidden={prefs.hiddenModules} />

        {/* Smart Feed — the intelligent, blended, endless heart of the home
            experience. Rendered last because it never ends. */}
        <Suspense fallback={<FeedSkeleton count={3} />}>
          <SmartFeedSection viewerId={viewerId} quietMode={prefs.quietMode} />
        </Suspense>
      </div>
    </AppContent>
  );
}

/* ── Module order/visibility dispatch (Feature 17 Part 13) ─────────────────── */

function renderModule(
  key: HomeModuleKey,
  ctx: {
    viewerId: string;
    profile: { avatarUrl: string | null; displayName: string; handle: string };
  },
) {
  switch (key) {
    case "stories":
      return (
        <Suspense key={key} fallback={<StoriesSkeleton />}>
          <StoriesSection
            viewerId={ctx.viewerId}
            avatarUrl={ctx.profile.avatarUrl}
            name={ctx.profile.displayName}
            handle={ctx.profile.handle}
          />
        </Suspense>
      );
    case "trending_reels":
      // Desktop/tablet only — CSS-hidden on mobile so the skeleton never even
      // flashes there (the Reels nav button is the mobile entry point
      // instead; see TrendingReels' own doc comment for the client-side
      // fetch/video-mount skip that backs this up).
      return (
        <div key={key} className="hidden lg:block">
          <Suspense fallback={<ReelsSkeleton />}>
            <ReelsSection viewerId={ctx.viewerId} />
          </Suspense>
        </div>
      );
    case "continue_watching":
      // Client-only, no server data dependency (reads live download/history
      // state) — renders nothing when there's nothing to resume, so it never
      // needs a Suspense boundary or a skeleton.
      return <ContinueWatching key={key} />;
  }
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

async function SmartFeedSection({ viewerId, quietMode }: { viewerId: string; quietMode: boolean }) {
  // A fresh reshuffle token per REQUEST — this is what makes "every refresh
  // reshuffles the feed like TikTok" true from the very first painted frame.
  // Minting it on the client instead would mean SSR always rendered one fixed
  // order that then visibly re-jumped when the client revalidated. It's handed
  // to SmartFeed so its own pagination keeps asking for THIS refresh's
  // arrangement (see rankForYou's note on why page 2 must agree with page 1).
  const seed = randomUUID().slice(0, 8);
  const [page, friends] = await Promise.all([
    getHomeFeed({ viewerId, sort: "for_you", offset: 0, limit: 8, seed }),
    friendsCount(viewerId),
  ]);
  return (
    <SmartFeed
      initialItems={page.items}
      initialNextOffset={page.nextOffset}
      initialSeed={seed}
      friendCount={friends}
      quietMode={quietMode}
    />
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
