/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FEED DE-DUPLICATION — one video, one entry
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner brief (2026-08-11): "make every feed entry to never show one video
 * twice just like we implemented on the reels."
 *
 * ── Why de-duplicating by post id was never enough ─────────────────────────
 *
 * The feed already skipped a repeated `id` when merging pages, and that is the
 * only duplicate a normal social app can produce. This is not a normal social
 * app: it is a DOWNLOADER whose users publish what they downloaded. So the same
 * clip legitimately exists as several different posts —
 *
 *   • two people download the same TikTok and both publish it → two post ids,
 *     one video, both in For You;
 *   • a post is reposted and the original also ranks organically on a later
 *     page → the repost is injected on page 0, the original arrives at offset
 *     24, and the id check never sees them as the same thing;
 *   • the same person re-publishes after an edit or a failed upload.
 *
 * In every case a viewer scrolls and meets a clip they just watched. The id was
 * doing its job; it was simply the wrong identity.
 *
 * ── The identity used instead ──────────────────────────────────────────────
 *
 * The strongest available handle on "the same bytes", in order:
 *
 *   1. `streamUid` — Cloudflare's id for a transcoded video. Two posts backed by
 *      the same Stream asset are unambiguously the same video.
 *   2. `sourceUrl` — where it came from.
 *   3. `mediaUrl` — the stored file.
 *   4. `id` — no media identity available (a text post); fall back to the post
 *      itself so nothing is ever wrongly collapsed.
 *
 * 🔴 `sourceUrl` outranks `mediaUrl`, and getting that backwards defeats the
 * whole feature — the first draft here had it the other way round and a test
 * caught it. Two people who downloaded the same TikTok each uploaded their OWN
 * copy, so their `mediaUrl`s differ and only the source says they are the same
 * clip. Ranking `mediaUrl` first means the headline case never collapses.
 *
 * This is safe in the other direction because a direct upload stores its own URL
 * as its source (`sourceUrl ?? mediaUrl` at publish time), so two unrelated
 * uploads still get two different keys — and `posts.source_url_hash` is unique
 * per publisher, so one account cannot hold two posts with the same source
 * anyway.
 *
 * 🔴 Applied to VIDEO only. Two photo posts that share a source URL are usually
 * a person posting to two places, and collapsing images by source would quietly
 * hide real, distinct posts to solve a problem nobody reported. The brief says
 * video; the code says video.
 */

/** The minimum shape this needs — kept structural so tests need no fixtures. */
export interface DedupableItem {
  id: string;
  mediaKind?: string | null;
  streamUid?: string | null;
  mediaUrl?: string | null;
  sourceUrl?: string | null;
}

/**
 * The key two entries must share to count as the same video.
 *
 * Prefixed per source so a `mediaUrl` can never collide with a `sourceUrl` that
 * happens to be the same string — which is exactly what a directly-uploaded post
 * looks like, since it stores its own URL in both.
 */
export function mediaIdentity(item: DedupableItem): string {
  if (item.mediaKind !== "video") return `id:${item.id}`;
  const uid = item.streamUid?.trim();
  if (uid) return `stream:${uid}`;
  const source = item.sourceUrl?.trim();
  if (source) return `source:${source}`;
  const media = item.mediaUrl?.trim();
  if (media) return `media:${media}`;
  return `id:${item.id}`;
}

/**
 * Filter a freshly-fetched page against everything already on screen, and
 * record what survives.
 *
 * MUTATES `seen`, deliberately: every caller in the feed keeps one long-lived
 * set per tab and appends pages to it, and returning a new set each time would
 * make it the caller's job to remember to merge — which is the bug this
 * replaces, in a new costume.
 *
 * Both identities go into the set: the post id AND the media identity. The id
 * still matters on its own, because a text post has no media identity and two
 * different posts must never collapse just because neither has one.
 */
export function acceptFeedItems<T extends DedupableItem>(items: T[] | undefined, seen: Set<string>): T[] {
  const out: T[] = [];
  for (const item of items ?? []) {
    const key = mediaIdentity(item);
    if (seen.has(item.id) || seen.has(key)) continue;
    seen.add(item.id);
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** A `seen` set primed from items already rendered. */
export function seenFromItems(items: DedupableItem[]): Set<string> {
  const seen = new Set<string>();
  for (const item of items) {
    seen.add(item.id);
    seen.add(mediaIdentity(item));
  }
  return seen;
}

/**
 * De-duplicate a list in place of building one — used for the FIRST page, which
 * arrives from the server already assembled (organic posts plus injected
 * reposts) and can therefore contain a collision before any merging happens.
 */
export function dedupeFeedItems<T extends DedupableItem>(items: T[]): T[] {
  return acceptFeedItems(items, new Set<string>());
}
