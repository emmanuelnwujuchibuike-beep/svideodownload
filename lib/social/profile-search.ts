import { flagsOf, isAccountVisibleTo, relationTo } from "@/lib/social/account-visibility";
import {
  DEFAULT_DISCOVERY,
  normalizeFields,
  searchableColumns,
  type DiscoverySettings,
  type SearchFieldKey,
} from "@/lib/discovery/fields";
import { isEmptyQuery, parseQuery, type ParsedQuery } from "@/lib/discovery/query";
import { friendIdSet } from "@/lib/social/friend-ids";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Universal Profile Search™ (Feature 18 · Part 18).
 *
 * ── What was actually missing ────────────────────────────────────────────
 * `searchPeople` matched `handle` and `display_name` and nothing else, so a
 * member who filled in a headline, a category and a list of skills was
 * findable by none of them. Everything the brief asks to search by already
 * existed as data (migration 0107) — it simply was not being read.
 *
 * ── Privacy is applied per MEMBER, not per query ─────────────────────────
 * Each candidate's own discovery settings decide which of their fields may
 * match. That is stricter than filtering the query, and it has to be: a
 * search for "Lagos" must not surface someone whose city says Lagos but who
 * never opted into location search. So the SQL casts a wide net over the
 * fields, and every row is then re-checked against that member's settings
 * before it can be returned. A candidate whose settings could not be read is
 * treated as having the defaults, which exclude location.
 *
 * ── Two queries, never N ─────────────────────────────────────────────────
 * One query over profiles+details, one over the discovery settings for the
 * ids that came back. A per-candidate settings read would turn a search into
 * dozens of round trips and miss the sub-100ms target by an order of
 * magnitude.
 */

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface ProfileSearchResult {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  followersCount: number;
  headline: string | null;
  category: string | null;
  /** Only present when this member allows location search. */
  location: string | null;
  /** Which of their fields the query actually hit — powers the "why" line. */
  matchedOn: SearchFieldKey[];
  score: number;
}

export interface ProfileSearchOptions {
  viewerId?: string | null;
  limit?: number;
}

/**
 * PostgREST `.or()` takes a filter string, so any user text inside it has to be
 * neutralised. Commas and parentheses are the grammar; `%` and `*` are
 * wildcards. Stripping them (rather than escaping) keeps the filter a filter —
 * the same discipline `lib/social/search.ts` already uses.
 */
function safeTerm(term: string): string {
  return term.replace(/[,%()*\\"']/g, " ").trim().slice(0, 40);
}

interface ProfileRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_verified: boolean | null;
  followers_count: number | null;
  is_suspended: boolean | null;
  is_hidden: boolean | null;
}

interface DetailRow {
  user_id: string;
  headline: string | null;
  category: string | null;
  skills: unknown;
  languages: unknown;
  city: string | null;
  country: string | null;
  availability: string | null;
}

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && !!s.trim()) : [];

/** Every candidate's discovery settings, in one read. Missing = defaults. */
async function discoveryFor(ids: readonly string[]): Promise<Map<string, DiscoverySettings>> {
  const out = new Map<string, DiscoverySettings>();
  if (!ids.length) return out;
  try {
    const { data, error } = await createAdminClient()
      .from("profile_discovery")
      .select("user_id, discoverable, search_fields, directory_listed")
      .in("user_id", ids.slice(0, 200));
    if (error) return out;
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const id = typeof r.user_id === "string" ? r.user_id : null;
      if (!id) continue;
      out.set(id, {
        discoverable: r.discoverable !== false,
        fields: normalizeFields(r.search_fields),
        directoryListed: r.directory_listed === true,
      });
    }
  } catch {
    /* 0113 unapplied — everyone keeps the defaults, which exclude location */
  }
  return out;
}

/** Does `haystack` contain any of the terms? */
function hits(haystack: string | null | undefined, terms: readonly string[]): boolean {
  if (!haystack) return false;
  const lower = haystack.toLowerCase();
  return terms.some((t) => lower.includes(t));
}

export async function searchProfiles(
  rawQuery: string,
  options: ProfileSearchOptions = {},
): Promise<{ results: ProfileSearchResult[]; parsed: ParsedQuery }> {
  const parsed = parseQuery(rawQuery);
  const viewerId = options.viewerId ?? null;
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));

  if (!hasSupabase || isEmptyQuery(parsed)) return { results: [], parsed };

  const terms = parsed.terms.map(safeTerm).filter((t) => t.length >= 1);
  const phraseTerms = parsed.phrases.map(safeTerm).filter(Boolean);
  const allTerms = [...new Set([...terms, ...phraseTerms])];

  try {
    const db = createAdminClient();

    // ── 1. Candidates from `profiles` (handle / display name) ────────────
    let base = db
      .from("profiles")
      .select("id, handle, display_name, avatar_url, is_verified, followers_count, is_suspended, is_hidden")
      .limit(limit * 6);
    if (allTerms.length) {
      base = base.or(allTerms.map((t) => `handle.ilike.%${t}%,display_name.ilike.%${t}%`).join(","));
    }
    if (parsed.filters.verified) base = base.eq("is_verified", true);

    // ── 2. Candidates from `profile_details` (the fields that were missing) ─
    let detailIds: string[] = [];
    let detailRows: DetailRow[] = [];
    if (allTerms.length || parsed.filters.location || parsed.filters.availableOnly) {
      try {
        let q = db
          .from("profile_details")
          .select("user_id, headline, category, skills, languages, city, country, availability")
          .limit(limit * 6);
        const clauses: string[] = [];
        for (const t of allTerms) {
          clauses.push(`headline.ilike.%${t}%`, `category.ilike.%${t}%`);
        }
        if (parsed.filters.location) {
          const loc = safeTerm(parsed.filters.location);
          if (loc) clauses.push(`city.ilike.%${loc}%`, `country.ilike.%${loc}%`);
        }
        if (clauses.length) q = q.or(clauses.join(","));
        if (parsed.filters.availableOnly) q = q.eq("availability", "open");
        const { data } = await q;
        detailRows = ((data ?? []) as DetailRow[]).filter((r) => r.user_id);
        detailIds = detailRows.map((r) => r.user_id);
      } catch {
        /* 0107 unapplied — fall back to name-only matching */
      }
    }

    const [{ data: baseData }, extraProfiles] = await Promise.all([
      base,
      detailIds.length
        ? db
            .from("profiles")
            .select("id, handle, display_name, avatar_url, is_verified, followers_count, is_suspended, is_hidden")
            .in("id", detailIds.slice(0, 200))
        : Promise.resolve({ data: [] as ProfileRow[] }),
    ]);

    const byId = new Map<string, ProfileRow>();
    for (const r of [...((baseData ?? []) as ProfileRow[]), ...(((extraProfiles.data ?? []) as ProfileRow[]))]) {
      if (r?.id && r.handle) byId.set(r.id, r);
    }
    if (byId.size === 0) return { results: [], parsed };

    // ── 3. Visibility: a hidden account stays findable by its own friends ──
    const friends = await friendIdSet(viewerId);
    const visible = [...byId.values()].filter((p) =>
      isAccountVisibleTo(flagsOf(p), relationTo(p.id, viewerId, friends)),
    );
    if (visible.length === 0) return { results: [], parsed };

    // ── 4. Each member's own discovery settings gate their own fields ─────
    const settings = await discoveryFor(visible.map((p) => p.id));
    const details = new Map(detailRows.map((d) => [d.user_id, d]));

    // Skills and languages are jsonb, so they are matched in code rather than
    // in SQL — a `cs`/`ilike` over jsonb would need a GIN index this schema
    // does not have, and the candidate set is already small by this point.
    const results: ProfileSearchResult[] = [];
    for (const p of visible) {
      const own = settings.get(p.id) ?? DEFAULT_DISCOVERY;
      const allowed = new Set(searchableColumns(own).map((c) => c.key));
      const d = details.get(p.id);

      const matchedOn: SearchFieldKey[] = [];
      if (allowed.has("handle") && hits(p.handle, allTerms)) matchedOn.push("handle");
      if (allowed.has("display_name") && hits(p.display_name, allTerms)) matchedOn.push("display_name");
      if (d) {
        if (allowed.has("headline") && hits(d.headline, allTerms)) matchedOn.push("headline");
        if (allowed.has("category") && hits(d.category, allTerms)) matchedOn.push("category");
        if (allowed.has("skills") && asStrings(d.skills).some((s) => hits(s, allTerms))) matchedOn.push("skills");
        if (allowed.has("languages") && asStrings(d.languages).some((s) => hits(s, allTerms))) {
          matchedOn.push("languages");
        }
      }

      // Location is a MATCH-time check, not a query-time one: someone who
      // never opted in must not be surfaced by "in Lagos" even though their
      // city column says Lagos.
      const locationAllowed = allowed.has("city") || allowed.has("country");
      let locationMatched = false;
      if (parsed.filters.location && d) {
        const loc = parsed.filters.location.toLowerCase();
        const cityHit = allowed.has("city") && hits(d.city, [loc]);
        const countryHit = allowed.has("country") && hits(d.country, [loc]);
        locationMatched = cityHit || countryHit;
        if (cityHit) matchedOn.push("city");
        if (countryHit) matchedOn.push("country");
        // A location filter that this member cannot satisfy excludes them.
        if (!locationMatched) continue;
      }

      // Nothing matched at all — they came back only because of a filter.
      if (matchedOn.length === 0 && allTerms.length > 0) continue;
      if (parsed.filters.verified && !p.is_verified) continue;

      results.push({
        id: p.id,
        handle: p.handle!,
        displayName: p.display_name || `@${p.handle}`,
        avatarUrl: p.avatar_url ?? null,
        isVerified: !!p.is_verified,
        followersCount: p.followers_count ?? 0,
        headline: allowed.has("headline") ? (d?.headline ?? null) : null,
        category: allowed.has("category") ? (d?.category ?? null) : null,
        location: locationAllowed ? [d?.city, d?.country].filter(Boolean).join(", ") || null : null,
        matchedOn,
        score: scoreResult(p, matchedOn, locationMatched),
      });
    }

    results.sort((a, b) => b.score - a.score || b.followersCount - a.followersCount || a.handle.localeCompare(b.handle));
    return { results: results.slice(0, limit), parsed };
  } catch {
    return { results: [], parsed };
  }
}

/**
 * Ranking. A handle match beats everything — someone typing a handle wants
 * that person, not the most popular account that mentions them in a bio.
 * Popularity is a tiebreak with a hard cap, never a driver, so search does not
 * quietly become a leaderboard.
 */
function scoreResult(p: ProfileRow, matchedOn: readonly SearchFieldKey[], locationMatched: boolean): number {
  let score = 0;
  const WEIGHT: Record<SearchFieldKey, number> = {
    handle: 50,
    display_name: 40,
    headline: 18,
    category: 16,
    skills: 14,
    languages: 6,
    city: 10,
    country: 6,
  };
  for (const key of matchedOn) score += WEIGHT[key];
  if (locationMatched) score += 8;
  if (p.is_verified) score += 6;
  score += Math.min(10, Math.round(Math.log10(Math.max(1, p.followers_count ?? 0)) * 3));
  return score;
}
