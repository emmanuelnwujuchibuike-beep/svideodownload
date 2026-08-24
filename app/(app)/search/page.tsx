import type { Metadata } from "next";
import { Suspense } from "react";

import { AppContent } from "@/features/app-shell/app-content";
import { DiscoverSections, DiscoveryRow } from "@/features/search/discover-sections";
import { SearchExperience } from "@/features/search/search-experience";
import { LoadingStripe } from "@/features/ui/page-loader";
import { getSearchDiscover, TRENDING_CARD_COUNT } from "@/lib/social/discover";
import { emptySearchResult, searchAll, type SearchType } from "@/lib/social/search";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: false },
};

const TYPES: SearchType[] = ["all", "people", "video", "image", "audio", "sound", "hashtag", "place"];

/*
  🔴 SYNCHRONOUS SHELL, STREAMED DATA. The page function itself awaits nothing:
  a top-level `await` here means the route sends no HTML at all until every
  query has returned, which on a cold PWA launch is the white screen this app
  has already fixed twice (see app/(app)/home/page.tsx and the cold-entry
  loader). `loading.tsx` does not cover it — that is the Suspense boundary for
  NAVIGATION, and it cannot help a document that has not started streaming.
*/
export default function SearchPage(props: { searchParams: Promise<{ q?: string; type?: string }> }) {
  return (
    <Suspense
      fallback={
        <AppContent canvas>
          <LoadingStripe />
        </AppContent>
      }
    >
      <SearchData {...props} />
    </Suspense>
  );
}

async function SearchData({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const { q, type: typeParam } = await searchParams;
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
    /* guest — the discovery screen is public, and the page never redirects */
  }

  /*
    The discovery payload is fetched even when the URL carries a query, because
    the moment the field is cleared it has to be there instantly — a second
    round trip at that point is a blank screen where a full one was. It is three
    cached reads (60s suggestions, 600s tags, 20s feed), so the common case is
    served warm; only the query itself is uncached work.
  */
  const [initialResult, discover, viewerHandle] = await Promise.all([
    query ? searchAll(query, type, viewerId) : Promise.resolve(emptySearchResult()),
    getSearchDiscover(viewerId),
    handleOf(viewerId),
  ]);

  return (
    <AppContent canvas>
      <SearchExperience
        initialQuery={query}
        initialType={type}
        initialResult={initialResult}
        /*
          Real tags, never invented terms — and specifically the ones BEYOND
          the six "Trending Now" renders as cards, so the chip row adds
          something rather than repeating the section under it.
        */
        trendingTerms={discover.tags.slice(TRENDING_CARD_COUNT).map((t) => `#${t.tag}`)}
        canFollow={!!viewerId}
        discoveryRow={<DiscoveryRow creators={discover.creators} viewerHandle={viewerHandle} />}
        discover={<DiscoverSections discover={discover} canFollow={!!viewerId} />}
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
