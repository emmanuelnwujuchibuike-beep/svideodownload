import { Flame } from "lucide-react";
import Link from "next/link";

import { TrendingRail } from "@/components/landing/trending-rail";
import { getFeed } from "@/lib/social/feed";

/** Landing "Trending Today" — real trending feed with in-place category filtering. */
/**
 * Minimum covered posts before we drop the cover-less ones entirely. Below this
 * the rail would look sparse, so a gradient tile beats an empty row.
 */
const MIN_COVERED = 6;

export async function TrendingToday() {
  const posts = await getFeed({ sort: "trending", viewerId: null, limit: 40 });

  /*
   * COVER-FIRST ordering.
   *
   * Not every post has a `thumbnailUrl` — a handful predate the poster re-hosting
   * fix (`lib/media/poster-host.ts`) and were never repaired. The rail falls back
   * to a flat gradient for those, and trending order was putting three of them at
   * the FRONT: the first thing anyone saw of "Trending Today" was three blank
   * colour blocks, which reads as broken images rather than as a design.
   *
   * This is a cover carousel — showing artwork is its entire job — so posts that
   * have artwork lead. Cover-less posts are dropped only when enough covered ones
   * remain to fill the rail; otherwise they still appear, at the end. Nothing is
   * hidden from the platform, only de-prioritised in one visual surface.
   *
   * The ordering is stable within each group, so genuine trending rank is
   * preserved among the covered posts.
   */
  const covered = posts.filter((p) => !!p.thumbnailUrl);
  const uncovered = posts.filter((p) => !p.thumbnailUrl);
  const ordered = covered.length >= MIN_COVERED ? covered : [...covered, ...uncovered];

  return (
    <section className="container max-w-6xl py-10 sm:py-14">
      <h2 className="flex items-center gap-2 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
        <Flame className="h-6 w-6 shrink-0 text-rose-500 sm:h-7 sm:w-7" aria-hidden />
        Trending Today
      </h2>

      {ordered.length > 0 ? (
        <TrendingRail posts={ordered} />
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
