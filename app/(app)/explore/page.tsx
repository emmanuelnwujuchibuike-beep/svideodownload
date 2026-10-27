import type { Metadata } from "next";
import { Suspense } from "react";

import { AppContent } from "@/features/app-shell/app-content";
import { CollectionsRail } from "@/features/explore/collections-rail";
import { ExploreBrowser } from "@/features/explore/explore-browser";
import { DiscoverSections, DiscoveryRow } from "@/features/search/discover-sections";
import { DiscoverSkeleton } from "@/features/search/discover-skeleton";
import { SearchExperience } from "@/features/search/search-experience";
import { isCategory, type Category } from "@/lib/social/categories";
import { getVideoCollections } from "@/lib/social/discovery-collections";
import { getSearchDiscover, TRENDING_CARD_COUNT } from "@/lib/social/discover";
import { getFeed, type FeedSort } from "@/lib/social/feed";
import { emptySearchResult, searchAll, type SearchType } from "@/lib/social/search";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/*
  🔴 `robots: index:true` made explicit (2026-08-16 SEO audit): genuinely public, signed-out-accessible community
  content, in the sitemap. `sort`/`category`/`q` vary the results but canonical stays this one static path.
*/
export const metadata: Metadata = {
  title: "Explore — trending downloads",
  description: "Discover trending and recent downloads shared by the FrenzSave community.",
  alternates: { canonical: "/explore" },
  robots: { index: true, follow: true },
};

const TYPES: SearchType[] = ["all", "people", "video", "image", "audio", "sound", "hashtag", "place"];

/*
  /explore on the Discover design (owner, 2026-10-27: "use same design for the explore page too"). The same screen
  as /search — the title (here "Explore", the page's own h1), the field, the circles, Trending now, Trending
  searches, Creators to follow — and in the place of Discover's short video grid, this page's own Explore videos:
  Trending · Recent and the categories over the 3-column grid. Searching from here stays on /explore.

  Removed in the redesign: the "Creators" Discovery Orbit rail (its job is Creators to follow now — the same people,
  one section instead of two). Kept: Video Collections, on the default view only.

  🔴 Synchronous shell, streamed data — the cold-entry white-screen fix (owner, 2026-08-11). See
  app/(app)/home/page.tsx for why `loading.tsx` alone cannot fix a page that awaits at its top level.
*/
export default function ExplorePage(props: { searchParams: Promise<{ sort?: string; category?: string; q?: string; type?: string }> }) {
  return (
    <Suspense
      fallback={
        <AppContent>
          <DiscoverSkeleton title="Explore" />
        </AppContent>
      }
    >
      <ExploreData {...props} />
    </Suspense>
  );
}

async function ExploreData({ searchParams }: { searchParams: Promise<{ sort?: string; category?: string; q?: string; type?: string }> }) {
  const { sort: sortParam, category: catParam, q, type: typeParam } = await searchParams;
  const sort: FeedSort = sortParam === "recent" ? "recent" : "trending";
  const category: Category | null = catParam && isCategory(catParam) ? catParam : null;
  const query = (q ?? "").trim();
  const type: SearchType = TYPES.includes(typeParam as SearchType) ? (typeParam as SearchType) : "all";

  let viewerId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewerId = user?.id ?? null;
  } catch {
    /* anon */
  }

  const [posts, discover, collections, viewerHandle, initialResult] = await Promise.all([
    getFeed({ sort, category, viewerId }),
    // the same cached reads /search uses (60 s suggestions, 600 s tags, 20 s feed)
    getSearchDiscover(viewerId),
    // a filtered view is the visitor's own choice — curated rails stay off it
    !sortParam && !category ? getVideoCollections(viewerId) : Promise.resolve([]),
    handleOf(viewerId),
    query ? searchAll(query, type, viewerId) : Promise.resolve(emptySearchResult()),
  ]);

  return (
    <AppContent>
      <SearchExperience
        title="Explore"
        path="/explore"
        initialQuery={query}
        initialType={type}
        initialResult={initialResult}
        trendingTerms={discover.tags.slice(TRENDING_CARD_COUNT).map((t) => `#${t.tag}`)}
        canFollow={!!viewerId}
        discoveryRow={<DiscoveryRow creators={discover.creators} viewerHandle={viewerHandle} loginNext="/explore" />}
        discover={
          <>
            <DiscoverSections discover={discover} canFollow={!!viewerId} showVideos={false} />
            <CollectionsRail collections={collections} />
            <ExploreBrowser initialPosts={posts} initialSort={sort} initialCategory={category} />
          </>
        }
      />
    </AppContent>
  );
}

/** The viewer's own @handle, for the "Your story" circle. Guests get null. */
async function handleOf(viewerId: string | null): Promise<string | null> {
  if (!viewerId) return null;
  try {
    const { data } = await createAdminClient().from("profiles").select("handle").eq("id", viewerId).maybeSingle();
    return ((data?.handle as string | null) ?? null) || null;
  } catch {
    return null;
  }
}
