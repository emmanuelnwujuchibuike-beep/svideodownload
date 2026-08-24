import {
  DEFAULT_DISCOVERY,
  normalizeFields,
  searchableColumns,
  type DiscoverySettings,
} from "@/lib/discovery/fields";
import { createAdminClient } from "@/lib/supabase/admin";

import { flagsOf, isAccountVisibleTo, relationTo } from "./account-visibility";
import { friendIdSet } from "./friend-ids";

/**
 * Places, as a search type (Search & Explore, 2026-08-24).
 *
 * A "place" here is a city/country that real, findable members have put on
 * their profile — so searching "Lagos" answers "who is here?", which is the
 * only question this data can honestly answer.
 *
 * ── 🔴 LOCATION IS OPT-IN, AND THE CHECK HAPPENS PER MEMBER ────────────────
 * Migration 0113 is explicit: city and country are NOT in the default
 * searchable-field set, because "a member who filled in their city so their
 * business hours made sense never agreed to be enumerable by proximity". This
 * module therefore casts a wide net in SQL and then re-checks every candidate
 * against THEIR OWN discovery settings before they can count towards a place —
 * the same discipline `lib/social/profile-search.ts` uses, reusing the same
 * `searchableColumns` helper rather than re-deriving the rule.
 *
 * `profiles.location` (migration 0024, used by the friends discovery deck) is
 * deliberately NOT read here. It predates the opt-in and carries no consent
 * signal, so enumerating it would route around the control 0113 introduced.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface PlaceResult {
  /** "Lagos, Nigeria" — what the row shows and what tapping it searches for. */
  label: string;
  /** Members who opted into location search, are visible to the viewer, and are here. */
  creatorCount: number;
  /** Up to three avatars for the stacked preview. */
  avatars: (string | null)[];
}

/** Strip characters that would break a PostgREST `or(...ilike...)` filter. */
function clean(q: string): string {
  return q.replace(/[,%()*\\"']/g, " ").trim().slice(0, 40);
}

interface DetailRow {
  user_id: string;
  city: string | null;
  country: string | null;
}

interface ProfileRow {
  id: string;
  handle: string | null;
  avatar_url: string | null;
  is_suspended: boolean | null;
  is_hidden: boolean | null;
}

/** Every candidate's discovery settings, in one read. Missing row = defaults. */
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

/** "Lagos, Nigeria" from whichever of the two parts this member filled in. */
function labelOf(city: string | null, country: string | null): string {
  return [city?.trim(), country?.trim()].filter(Boolean).join(", ");
}

/**
 * The Places search tab. Returns the distinct places matching the query, each
 * with the number of members who are searchable there.
 */
export async function searchPlaces(
  query: string,
  viewerId: string | null = null,
  limit = 20,
): Promise<PlaceResult[]> {
  if (!hasSupabase) return [];
  const term = clean(query);
  if (!term) return [];

  try {
    const db = createAdminClient();
    const { data: detailData } = await db
      .from("profile_details")
      .select("user_id, city, country")
      .or(`city.ilike.%${term}%,country.ilike.%${term}%`)
      .limit(200);

    const details = ((detailData ?? []) as DetailRow[]).filter((d) => d.user_id && labelOf(d.city, d.country));
    if (details.length === 0) return [];

    const ids = details.map((d) => d.user_id);
    const [{ data: profileData }, settings, friends] = await Promise.all([
      db.from("profiles").select("id, handle, avatar_url, is_suspended, is_hidden").in("id", ids.slice(0, 200)),
      discoveryFor(ids),
      friendIdSet(viewerId),
    ]);

    const profiles = new Map(
      ((profileData ?? []) as ProfileRow[]).filter((p) => p.id && p.handle).map((p) => [p.id, p]),
    );

    const places = new Map<string, { label: string; count: number; avatars: (string | null)[] }>();
    for (const d of details) {
      const profile = profiles.get(d.user_id);
      if (!profile) continue;
      // A suspended account is invisible to everyone; an admin-hidden one stays
      // visible to its own friends (0082).
      if (!isAccountVisibleTo(flagsOf(profile), relationTo(profile.id, viewerId, friends))) continue;

      const own = settings.get(d.user_id) ?? DEFAULT_DISCOVERY;
      const allowed = new Set(searchableColumns(own).map((c) => c.key));
      // Only the part they actually opted into may place them.
      const cityOk = allowed.has("city") && !!d.city?.trim();
      const countryOk = allowed.has("country") && !!d.country?.trim();
      if (!cityOk && !countryOk) continue;

      const label = labelOf(cityOk ? d.city : null, countryOk ? d.country : null);
      if (!label.toLowerCase().includes(term.toLowerCase())) continue;

      const key = label.toLowerCase();
      const entry = places.get(key) ?? { label, count: 0, avatars: [] };
      entry.count += 1;
      if (entry.avatars.length < 3) entry.avatars.push(profile.avatar_url);
      places.set(key, entry);
    }

    return [...places.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map((p) => ({ label: p.label, creatorCount: p.count, avatars: p.avatars }));
  } catch {
    return [];
  }
}
