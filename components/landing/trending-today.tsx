import { Flame } from "lucide-react";
import Link from "next/link";

import { TrendingRail } from "@/components/landing/trending-rail";
import { getFeed } from "@/lib/social/feed";

/** Landing "Trending Today" — real trending feed with in-place category filtering. */
export async function TrendingToday() {
  const posts = await getFeed({ sort: "trending", viewerId: null, limit: 40 });

  return (
    <section className="container max-w-6xl py-10 sm:py-14">
      <h2 className="flex items-center gap-2 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
        <Flame className="h-6 w-6 shrink-0 text-rose-500 sm:h-7 sm:w-7" aria-hidden />
        Trending Today
      </h2>

      {posts.length > 0 ? (
        <TrendingRail posts={posts} />
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-border/70 p-10 text-center">
          <p className="text-sm text-muted-foreground">No trending posts yet.</p>
          <Link href="/#download" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
            Download something and publish it →
          </Link>
        </div>
      )}
    </section>
  );
}
