import { getCached } from "@/lib/cache";
import { createAdminClient } from "@/lib/supabase/admin";

import { CATEGORIES } from "./categories";

/**
 * Hashtags, as a first-class search type (Search & Explore, 2026-08-24).
 *
 * ── There is no hashtag TABLE, and this does not invent one ────────────────
 * Tags live inside captions (`components/social/rich-text.tsx` already links
 * them) and in the fixed `category` taxonomy. A `post_hashtags` table would be
 * the "correct" schema, but it would also mean a migration, a backfill of every
 * existing caption, and a second write path on publish — for a read that runs
 * a handful of times a minute behind a 10-minute cache. So this derives tags
 * from the data that already exists.
 *
 * ── 🔴 EVERY NUMBER HERE IS A REAL COUNT ──────────────────────────────────
 * The candidate tags are discovered by scanning a bounded window of trending
 * posts, but the "N posts" a card shows is NEVER the count within that window —
 * a windowed count would be a truncated number wearing a complete number's
 * label, which is exactly the class of bug that produced the "returning
 * visitors = 0" incident. Each surfaced tag gets its own exact `count` query
 * against the whole table, and that is the only figure the UI is given.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface TrendingTag {
  /** Without the leading "#" — the UI adds it. */
  tag: string;
  /** Exact number of published, public posts carrying this tag. */
  postCount: number;
  /** Cover art from the tag's hottest post — the small thumb on the card. */
  thumbnailUrl: string | null;
  /** A caption `#hashtag`, or one of the fixed content categories. */
  source: "hashtag" | "category";
}

/**
 * How many trending posts get scanned to DISCOVER candidate tags. Bounded on
 * purpose: this is a sample used for ranking, never for counting (see above),
 * and it must stay far below PostgREST's 1000-row ceiling so the request can
 * never be silently truncated (lib/supabase/paginate.ts exists for the cases
 * that genuinely need every row — this is not one).
 */
const CORPUS_LIMIT = 400;

/** Unicode-aware, so `#عيد` and `#夏` are tags too, not just ASCII words. */
const HASHTAG_RE = /#([\p{L}\p{N}_]{2,40})/gu;

/** Strip characters that would break a PostgREST `or(...ilike...)` filter. */
function clean(q: string): string {
  return q.replace(/[,%()*\\"']/g, " ").replace(/#/g, "").trim().slice(0, 40);
}

interface CorpusRow {
  title: string | null;
  description: string | null;
  category: string | null;
  thumbnail_url: string | null;
}

interface Candidate {
  /** First-seen casing, so "#SummerVibes" isn't flattened to "#summervibes". */
  display: string;
  /** Occurrences inside the trending window — RANKING ONLY, never displayed. */
  weight: number;
  thumbnailUrl: string | null;
}

/**
 * Candidate tags from the current trending window, ranked by how often they
 * appear in it. Cached for 10 minutes: trending tags are a shared, non-personal
 * read, so every visitor to /search hits one warm entry.
 */
async function tagCandidates(): Promise<Candidate[]> {
  if (!hasSupabase) return [];
  return getCached("tags:candidates", 600, async () => {
    try {
      const { data } = await createAdminClient()
        .from("posts")
        .select("title, description, category, thumbnail_url")
        .eq("status", "published")
        .eq("visibility", "public")
        .order("hot_score", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(CORPUS_LIMIT);

      const found = new Map<string, Candidate>();
      for (const row of (data ?? []) as CorpusRow[]) {
        const text = `${row.title ?? ""} ${row.description ?? ""}`;
        // Per-post de-dupe: a caption that spams the same tag five times gets
        // one vote, not five.
        const seen = new Set<string>();
        for (const m of text.matchAll(HASHTAG_RE)) {
          const raw = m[1];
          if (!raw) continue;
          const key = raw.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const prev = found.get(key);
          if (prev) {
            prev.weight += 1;
            prev.thumbnailUrl ??= row.thumbnail_url;
          } else {
            found.set(key, { display: raw, weight: 1, thumbnailUrl: row.thumbnail_url });
          }
        }
      }
      return [...found.values()].sort((a, b) => b.weight - a.weight);
    } catch {
      return [];
    }
  });
}

/**
 * The exact number of published, public posts whose caption carries `#tag`.
 *
 * `head: true` means PostgREST returns the count and NO rows, so this stays a
 * counting query rather than a page of data thrown away.
 */
async function countTag(tag: string): Promise<number> {
  const term = clean(tag);
  if (!term) return 0;
  return getCached(`tags:count:${term.toLowerCase()}`, 600, async () => {
    try {
      const { count } = await createAdminClient()
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("status", "published")
        .eq("visibility", "public")
        .or(`title.ilike.%#${term}%,description.ilike.%#${term}%`);
      return count ?? 0;
    } catch {
      return 0;
    }
  });
}

/** The exact number of published, public posts in a fixed content category. */
async function countCategory(category: string): Promise<number> {
  return getCached(`tags:cat:${category}`, 600, async () => {
    try {
      const { count } = await createAdminClient()
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("status", "published")
        .eq("visibility", "public")
        .eq("category", category);
      return count ?? 0;
    } catch {
      return 0;
    }
  });
}

/** One representative cover for a category, for the card's thumbnail. */
async function categoryCover(category: string): Promise<string | null> {
  return getCached(`tags:catcover:${category}`, 600, async () => {
    try {
      const { data } = await createAdminClient()
        .from("posts")
        .select("thumbnail_url")
        .eq("status", "published")
        .eq("visibility", "public")
        .eq("category", category)
        .not("thumbnail_url", "is", null)
        .order("hot_score", { ascending: false })
        .limit(1);
      return ((data ?? [])[0]?.thumbnail_url as string | undefined) ?? null;
    } catch {
      return null;
    }
  });
}

/**
 * "Trending Now" — the tags the community is actually posting under.
 *
 * Caption hashtags come first (they're what people wrote); the fixed
 * categories fill any remaining slots, so a young library with few hashtagged
 * captions still shows a real, populated section instead of an empty card.
 */
export async function getTrendingTags(limit = 6): Promise<TrendingTag[]> {
  if (!hasSupabase) return [];
  const candidates = (await tagCandidates()).slice(0, limit);

  const tags: TrendingTag[] = (
    await Promise.all(
      candidates.map(async (c) => ({
        tag: c.display,
        postCount: await countTag(c.display),
        thumbnailUrl: c.thumbnailUrl,
        source: "hashtag" as const,
      })),
    )
  ).filter((t) => t.postCount > 0);

  /*
    🔴 THE FINAL ORDER IS BY EXACT POST COUNT, NOT BY WINDOW WEIGHT.

    Candidate DISCOVERY is ranked by heat inside the trending window — that is
    what decides which tags are worth showing at all. But the card also prints
    a rank number NEXT TO the count, and ranking by one number while displaying
    another produced exactly what you would expect: "2 · #news · 7 posts" sitting
    above "3 · #viral · 9 posts". A visible ranking that contradicts the visible
    figure reads as a bug no matter which ordering is technically defensible, so
    the number on screen is the number that sorts.
  */
  const byCount = (a: TrendingTag, b: TrendingTag) => b.postCount - a.postCount;
  if (tags.length >= limit) return tags.sort(byCount).slice(0, limit);

  // Fill from the taxonomy, skipping anything already surfaced as a hashtag.
  const taken = new Set(tags.map((t) => t.tag.toLowerCase()));
  const fillers = (
    await Promise.all(
      CATEGORIES.filter((c) => !taken.has(c)).map(async (c) => ({
        tag: c,
        postCount: await countCategory(c),
        thumbnailUrl: await categoryCover(c),
        source: "category" as const,
      })),
    )
  ).filter((t) => t.postCount > 0);

  return [...tags, ...fillers].sort(byCount).slice(0, limit);
}

/**
 * The Hashtags search tab. Matches the query against the tags people are
 * actually posting under, then — so a tag outside the trending window is still
 * findable — falls back to counting the query itself as a tag.
 */
export async function searchTags(query: string, limit = 20): Promise<TrendingTag[]> {
  if (!hasSupabase) return [];
  const term = clean(query).toLowerCase();
  if (!term) return [];

  const matches = (await tagCandidates())
    .filter((c) => c.display.toLowerCase().includes(term))
    .slice(0, limit);

  const results: TrendingTag[] = (
    await Promise.all(
      matches.map(async (c) => ({
        tag: c.display,
        postCount: await countTag(c.display),
        thumbnailUrl: c.thumbnailUrl,
        source: "hashtag" as const,
      })),
    )
  ).filter((t) => t.postCount > 0);

  // Categories match by name too — "mus" should find #music.
  for (const c of CATEGORIES) {
    if (results.length >= limit) break;
    if (!c.includes(term)) continue;
    if (results.some((r) => r.tag.toLowerCase() === c)) continue;
    const postCount = await countCategory(c);
    if (postCount > 0) results.push({ tag: c, postCount, thumbnailUrl: await categoryCover(c), source: "category" });
  }

  // Nothing known — is the query itself a tag someone used?
  if (results.length === 0) {
    const postCount = await countTag(term);
    if (postCount > 0) results.push({ tag: term, postCount, thumbnailUrl: null, source: "hashtag" });
  }

  return results.sort((a, b) => b.postCount - a.postCount).slice(0, limit);
}
