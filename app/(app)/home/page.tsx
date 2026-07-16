import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppContent } from "@/features/app-shell/app-content";
import { BrandSplash } from "@/features/app-shell/brand-splash";
import { ContinueWatching } from "@/features/app-shell/dashboard/continue-watching";
import { HiddenModulesNotice } from "@/features/app-shell/dashboard/hidden-modules-notice";
import { HomeModuleGate, HomeModulesProvider } from "@/features/app-shell/dashboard/home-modules-store";
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
        {/* Every optional module is RENDERED here in the viewer's chosen order;
            whether it's DISPLAYED is decided on the client by HomeModuleGate.
            That split is deliberate — it's what lets hiding and restoring a
            section happen instantly on the tap instead of only on the next Home
            load (owner, 2026-07-16: the restore button "just loads and
            disappears"). See home-modules-store.tsx. The main feed below is
            never a module — it's infinite and always renders last. */}
        <HomeModulesProvider initialHidden={prefs.hiddenModules}>
          {prefs.moduleOrder.map((key) => (
            <HomeModuleGate key={key} module={key}>
              {renderModule(key, {
                viewerId,
                profile: { avatarUrl: profile.avatarUrl, displayName: profile.displayName, handle },
              })}
            </HomeModuleGate>
          ))}

          {/* Renders NOTHING unless this viewer currently has something hidden,
              so it never becomes clutter for the common case. It exists because
              hiding a module had no visible path back — the only route to
              restore was /account → "Home & feed", buried down a long settings
              page (owner: "i dont even see the toggle"). Sits where the missing
              section would have been, and now reacts live to a hide made right
              above it. */}
          <HiddenModulesNotice />
        </HomeModulesProvider>

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
      // Client-rendered, seeded from the on-disk story cache — NO Suspense and
      // no server fetch (owner, 2026-07-16: "make the stories in homepage to
      // not reload on every entry ... it reloads for long").
      //
      // This used to await `getActiveStories` inside a <Suspense
      // fallback={<StoriesSkeleton/>}>, so EVERY server render of /home painted
      // a row of grey story circles before the real rings arrived. That's the
      // "reload on every entry", and it was structural: a server-awaited
      // section cannot paint instantly, no matter how fast the query is.
      //
      // The row now behaves exactly like the inbox's: it paints the last-known
      // rings from localStorage on the first frame and revalidates silently
      // behind that (see lib/social/story-cache.ts, which self-expires at 24h
      // so a stale entry can never show a phantom ring). Only a first-ever
      // visit with an empty disk cache sees an empty strip, and it fills
      // without a skeleton. Bonus: /home no longer runs this query at all.
      return (
        <StoriesRow
          key={key}
          viewerAvatarUrl={ctx.profile.avatarUrl}
          viewerName={ctx.profile.displayName}
          viewerHandle={ctx.profile.handle}
        />
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
