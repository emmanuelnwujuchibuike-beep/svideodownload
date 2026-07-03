import type { Metadata } from "next";

import { AppContent } from "@/features/app-shell/app-content";
import { SearchResults } from "@/features/search/search-results";
import { searchAll } from "@/lib/social/search";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: false },
};

/** /search — universal search across reels, posts, audio, hashtags and people. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const initial = query ? await searchAll(query, "all") : { people: [], posts: [] };

  return (
    <AppContent>
      <div className="mx-auto max-w-2xl pt-2">
        <SearchResults initialQuery={query} initial={initial} />
      </div>
    </AppContent>
  );
}
