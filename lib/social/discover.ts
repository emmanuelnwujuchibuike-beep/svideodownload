import { getTrendingTags, type TrendingTag } from "./hashtags";
import { getHomeFeed } from "./home-feed";
import { postHref } from "./post-url";
import { getSuggestedCreators, type SuggestedCreator } from "./suggest";

/**
 * The /search empty state — what the screen shows before anyone types.
 *
 * Purely an ASSEMBLER over reads that already exist (suggested creators,
 * trending tags, the trending reels feed). It adds no query of its own; its
 * whole job is to run those three concurrently and hand back the smallest
 * payload that can draw the screen.
 *
 * ── 🔴 THE SHAPES ARE NARROWED ON PURPOSE ─────────────────────────────────
 * `getHomeFeed` returns `FeedItem`, which carries ~30 fields per post
 * (stream ids, poll flags, repost badges, viewer reaction state…). None of it
 * draws a discovery card, but all of it would be serialised into the RSC flight
 * payload for ten posts. The RSC payload is already the biggest remaining lever
 * on this app's page weight, so this projects each item down to the six fields
 * the card renders — measurably cheaper for zero visible difference.
 */

export interface DiscoverVideo {
  id: string;
  /** Canonical URL via the shared `postHref` — never hand-built here. */
  href: string;
  title: string;
  thumbnailUrl: string | null;
  viewsCount: number;
  publisher: {
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    isVerified: boolean;
  };
}

/**
 * How many tags "Trending Now" shows as cards. Anything beyond this becomes
 * the one-tap "Trending searches" chips — the two blocks therefore never show
 * the same tag twice, which is what they did when both read the same top six.
 */
export const TRENDING_CARD_COUNT = 6;

export interface SearchDiscover {
  /** Powers BOTH the circular discovery row and the "Suggested for you" rail. */
  creators: SuggestedCreator[];
  /** Ranked by exact post count. The first `TRENDING_CARD_COUNT` are the cards. */
  tags: TrendingTag[];
  videos: DiscoverVideo[];
}

export async function getSearchDiscover(viewerId: string | null): Promise<SearchDiscover> {
  const [creators, tags, feed] = await Promise.all([
    getSuggestedCreators(viewerId, 12),
    getTrendingTags(TRENDING_CARD_COUNT * 2),
    // `format: "reel"` because these cards are 9:16 — the Feed product's own
    // format would put landscape covers into portrait tiles.
    getHomeFeed({ viewerId, sort: "trending", format: "reel", limit: 10 }),
  ]);

  return {
    creators,
    tags,
    videos: feed.items.map((item) => ({
      id: item.id,
      href: postHref(item),
      title: item.title,
      thumbnailUrl: item.thumbnailUrl,
      viewsCount: item.viewsCount,
      publisher: {
        handle: item.publisher.handle,
        displayName: item.publisher.displayName,
        avatarUrl: item.publisher.avatarUrl,
        isVerified: item.publisher.isVerified,
      },
    })),
  };
}
