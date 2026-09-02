/**
 * Hashtag performance for a creator's own work (Feature 15 · Part 9).
 *
 * ── Where tags come from ─────────────────────────────────────────────────
 * The same place `lib/social/hashtags.ts` gets them: INSIDE the caption. There
 * is no `post_hashtags` table and this Part did not add one, for the reason
 * that file already documents — a tag table means a migration, a backfill of
 * every caption ever written, and a second write path on publish, all to
 * duplicate something the caption already says.
 *
 * The important consequence, and the reason the Studio's hashtag editor writes
 * back into the caption rather than into a field of its own: the tags a creator
 * edits here are the SAME STRING search, trending and the discovery engine
 * read. An edit changes real reach, immediately. A parallel `hashtags` column
 * would have been tidier and would have affected nothing.
 *
 * ── Averages, not totals ─────────────────────────────────────────────────
 * A tag on twenty posts will out-total a tag on two whatever it does for
 * reach. So the ranking metric is views PER POST carrying the tag, and the
 * post count is shown beside it so a creator can see how thin the evidence is.
 *
 * Pure: no React, no Supabase, no I/O.
 */

/** Unicode-aware, identical to lib/social/hashtags.ts — a tag that search can
 *  find must be a tag this can score, and two regexes would eventually drift. */
const HASHTAG_RE = /#([\p{L}\p{N}_]{2,40})/gu;

export interface TaggedPost {
  id: string;
  /** Caption. Description is scanned too when supplied — both are searched by
   *  `lib/social/hashtags.ts`, so both must count here. */
  title: string;
  description?: string | null;
  views: number;
  engagement: number;
}

export interface TagPerformance {
  /** Lower-cased key used for grouping. */
  tag: string;
  /** First-seen casing, so "#SummerVibes" is not flattened for display. */
  display: string;
  posts: number;
  totalViews: number;
  /** The ranking metric: views per post carrying this tag. */
  averageViews: number;
  averageEngagement: number;
}

/** Extract a post's distinct tags, de-duped per post so a caption that repeats
 *  one tag five times counts once — same rule the trending scanner applies. */
export function extractTags(text: string): { key: string; display: string }[] {
  const seen = new Set<string>();
  const out: { key: string; display: string }[] = [];
  for (const m of text.matchAll(HASHTAG_RE)) {
    const raw = m[1];
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, display: raw });
  }
  return out;
}

/**
 * Rank a creator's own tags by average views per tagged post.
 * Ties break on the tag key so the order is stable across loads.
 */
export function rankTagPerformance(posts: TaggedPost[]): TagPerformance[] {
  const acc = new Map<string, { display: string; posts: number; views: number; engagement: number }>();

  for (const post of posts) {
    const text = `${post.title ?? ""} ${post.description ?? ""}`;
    for (const { key, display } of extractTags(text)) {
      const prev = acc.get(key);
      if (prev) {
        prev.posts += 1;
        prev.views += post.views;
        prev.engagement += post.engagement;
      } else {
        acc.set(key, { display, posts: 1, views: post.views, engagement: post.engagement });
      }
    }
  }

  return [...acc.entries()]
    .map(([tag, v]) => ({
      tag,
      display: v.display,
      posts: v.posts,
      totalViews: v.views,
      averageViews: v.views / v.posts,
      averageEngagement: v.engagement / v.posts,
    }))
    .sort((a, b) => b.averageViews - a.averageViews || a.tag.localeCompare(b.tag));
}

/**
 * Replace the tag set of a caption, preserving the words around it.
 *
 * Existing tags are stripped wherever they sit — a creator who wrote them
 * mid-sentence gets their sentence back without them — and the new set is
 * appended on its own line, which is where captions in this product put them.
 * Whitespace left behind by a removed tag is collapsed so the caption does not
 * accumulate gaps every time the tags are edited.
 */
export function applyTags(caption: string, tags: string[]): string {
  const body = caption
    .replace(HASHTAG_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const clean = tags
    .map((t) => t.replace(/^#+/, "").trim())
    .filter((t) => /^[\p{L}\p{N}_]{2,40}$/u.test(t));

  // De-dupe case-insensitively, keeping the creator's own casing.
  const seen = new Set<string>();
  const unique = clean.filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (unique.length === 0) return body;
  return body.length > 0 ? `${body}\n\n${unique.map((t) => `#${t}`).join(" ")}` : unique.map((t) => `#${t}`).join(" ");
}
