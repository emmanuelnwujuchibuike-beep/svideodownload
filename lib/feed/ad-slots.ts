/**
 * Feed ad-slot composition — where an advertisement goes, and nothing else.
 *
 * Owner, 2026-08-24: "Frenzsave's server must construct the feed sequence and
 * insert an advertisement SLOT after every 4 content posts... The ad network
 * should only be responsible for filling the ad slot."
 *
 * The division of responsibility this file exists to enforce:
 *
 *   THE SERVER decides WHERE a slot exists   → this module
 *   THE BROWSER decides WHEN it may load     → FeedAdSlot's IntersectionObserver
 *   THE NETWORK decides WHAT fills it        → the existing AdSlot/zone stack
 *
 * Pure, synchronous and dependency-free on purpose: it runs during server
 * render, so it must not import anything that touches the database, the ad
 * network, or the DOM. Nothing here can block, fail, or make a request.
 */

/**
 * 🔴 THE ONE PLACE THE INTERVAL IS DEFINED.
 *
 * "Do not hard-code 4 in multiple components. This allows the interval to
 * later be changed to 3, 5, 6, etc. without rewriting the Feed."
 *
 * To change the cadence, change this number and nothing else. Every surface
 * reads it from here, and the server passes the resolved value down in the
 * feed payload so a future operator-facing setting only has to feed this one
 * variable rather than hunt down call sites.
 */
export const FEED_AD_INTERVAL = 4;

/**
 * How far ahead of the viewport a slot starts loading its ad.
 *
 * Roughly one screen of lead time on a phone: enough for a network round trip
 * to finish before the slot is actually looked at, without fetching ads for
 * content the reader may never scroll to. Read by FeedAdSlot; kept here so the
 * cadence and the lead time are configured side by side.
 */
export const FEED_AD_ROOT_MARGIN = "600px 0px";

/**
 * Lower bound on the interval.
 *
 * Not a style preference — AdSense's own policies prohibit layouts where ads
 * outweigh content, and one ad per two posts in an infinite feed is how a page
 * gets flagged. This project has already been rejected twice for content
 * quality; a misconfigured constant must not be able to make that worse.
 */
export const FEED_AD_MIN_INTERVAL = 3;

/** A composed feed position: either a real post, or a slot for an ad. */
export type FeedEntry<TPost> =
  | { type: "post"; data: TPost }
  | {
      type: "ad";
      /**
       * Human-readable ordinal id — `feed-ad-1`, `feed-ad-2` — for analytics
       * and debugging. NOT used as a React key; see `anchorId`.
       */
      slotId: string;
      /**
       * 🔴 THE REACT KEY, and the reason ads do not re-initialise.
       *
       * Derived from the id of the post this slot follows, so it survives the
       * one thing an ordinal cannot: a post being removed from the loaded feed
       * (hide, mute, "not interested" — all of which this feed supports). If
       * the key were `feed-ad-2`, removing any post above would renumber every
       * slot below it, React would unmount and remount each one, and every
       * visible ad would reload — the exact behaviour §10 of the brief
       * prohibits. Anchored to a post id, the slot's identity is unaffected by
       * anything happening above it.
       */
      anchorId: string;
    };

/**
 * Insert an ad slot after every `interval` posts.
 *
 * `startIndex` is the absolute position of `posts[0]` in the overall feed, so
 * that paginated batches keep one continuous rhythm: if page 1 ended two posts
 * into a group, page 2's slot lands two posts in, not four. Passing the whole
 * accumulated array (which is what the feed does) simply means `startIndex` is
 * 0 and the maths is the same.
 *
 * 🔴 Never emits a trailing slot. A slot appended after the last loaded post
 * would sit directly on top of the infinite-scroll sentinel, so it would be
 * inside the observer's root margin the moment it mounted — every batch would
 * load an ad the reader had not reached yet, which is precisely what the lazy
 * loading elsewhere exists to prevent. It also means the very bottom of the
 * feed is an ad rather than content, right where "load more" happens.
 */
export function insertAdSlots<TPost>(
  posts: TPost[],
  opts: {
    /** Post id, for the anchored key — see `anchorId`. */
    idOf: (post: TPost) => string;
    interval?: number;
    startIndex?: number;
    /** When false, returns posts only. The premium/disabled path. */
    enabled?: boolean;
  },
): FeedEntry<TPost>[] {
  const { idOf, startIndex = 0 } = opts;
  const interval = Math.max(FEED_AD_MIN_INTERVAL, Math.floor(opts.interval ?? FEED_AD_INTERVAL));
  const entries: FeedEntry<TPost>[] = [];

  posts.forEach((post, i) => {
    entries.push({ type: "post", data: post });

    const absolute = startIndex + i + 1; // 1-based count of posts emitted so far
    const isLast = i === posts.length - 1;
    if (absolute % interval === 0 && !isLast) {
      entries.push({
        type: "ad",
        slotId: `feed-ad-${absolute / interval}`,
        anchorId: idOf(post),
      });
    }
  });

  return entries;
}

/**
 * How many posts a given number of composed entries contains.
 *
 * 🔴 THE PAGINATION GUARD. "The cursor must continue to represent the actual
 * post dataset. Do NOT count an advertisement as a database post."
 *
 * Any code that turns a rendered length back into a database offset has to go
 * through this, or the cursor drifts forward by one for every ad shown and the
 * feed silently skips real posts — a bug that would look like "posts are
 * missing" and would never be traced back to advertising.
 */
export function countPosts<TPost>(entries: FeedEntry<TPost>[]): number {
  return entries.reduce((n, e) => n + (e.type === "post" ? 1 : 0), 0);
}
