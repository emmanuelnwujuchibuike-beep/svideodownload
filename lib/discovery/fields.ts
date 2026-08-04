/**
 * What a profile can be FOUND by, and who decides (Feature 18 · Part 18).
 *
 * ── Discoverability is per-field, and location is opt-in ──────────────────
 * The brief lists location as searchable "(Optional)". That parenthesis is
 * the most important word in this part. Being findable by name is what a
 * social profile is for; being findable by WHERE YOU ARE is a different thing
 * entirely, and a member who filled in their city so their business hours
 * made sense never agreed to be enumerable by proximity.
 *
 * So the default for every field here is the least surprising one: the things
 * a member obviously published to be found by (name, handle, headline, skills,
 * category) are on, and the two that describe a person rather than their work
 * (city, country) are OFF until switched on. `defaultOn: false` is not a
 * nudge — the reader treats an absent settings row as the defaults, so
 * existing members are opted OUT of location search the day this ships rather
 * than in.
 *
 * ── `discoverable` is the master switch and it fails CLOSED ───────────────
 * A failed settings read must resolve to "not discoverable by the optional
 * fields", never to "everything on". The direction matters: a database blip
 * that makes people harder to find is an inconvenience; one that publishes a
 * location someone opted out of is a harm that cannot be undone.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export type SearchFieldKey =
  | "handle"
  | "display_name"
  | "headline"
  | "category"
  | "skills"
  | "city"
  | "country"
  | "languages";

export interface SearchFieldSpec {
  key: SearchFieldKey;
  label: string;
  blurb: string;
  /** The column this reads. `profile_details` unless noted. */
  source: "profiles" | "profile_details";
  column: string;
  /** On for a member who has never opened the settings screen. */
  defaultOn: boolean;
  /**
   * True when the member cannot turn it off. Handle and display name are how
   * a profile is addressed at all — a profile nobody can find by name is not
   * a profile, it is a hidden account, and that is a different control
   * (`is_hidden`, friends-only) which already exists.
   */
  required: boolean;
  /** Describes the person rather than their work — needs deliberate consent. */
  sensitive: boolean;
}

export const SEARCH_FIELDS: readonly SearchFieldSpec[] = [
  {
    key: "handle",
    label: "Username",
    blurb: "People can find you by @handle.",
    source: "profiles",
    column: "handle",
    defaultOn: true,
    required: true,
    sensitive: false,
  },
  {
    key: "display_name",
    label: "Name",
    blurb: "The name shown on your profile.",
    source: "profiles",
    column: "display_name",
    defaultOn: true,
    required: true,
    sensitive: false,
  },
  {
    key: "headline",
    label: "Headline",
    blurb: "The one line under your name.",
    source: "profile_details",
    column: "headline",
    defaultOn: true,
    required: false,
    sensitive: false,
  },
  {
    key: "category",
    label: "Category",
    blurb: "What you do — “Coffee roaster”, “Civil engineering”.",
    source: "profile_details",
    column: "category",
    defaultOn: true,
    required: false,
    sensitive: false,
  },
  {
    key: "skills",
    label: "Skills",
    blurb: "The skills listed on your profile.",
    source: "profile_details",
    column: "skills",
    defaultOn: true,
    required: false,
    sensitive: false,
  },
  {
    key: "languages",
    label: "Languages",
    blurb: "Languages you speak.",
    source: "profile_details",
    column: "languages",
    defaultOn: true,
    required: false,
    sensitive: false,
  },
  {
    key: "city",
    label: "City",
    blurb: "Let people find you by the city on your profile.",
    source: "profile_details",
    column: "city",
    defaultOn: false,
    required: false,
    sensitive: true,
  },
  {
    key: "country",
    label: "Country",
    blurb: "Let people find you by country.",
    source: "profile_details",
    column: "country",
    defaultOn: false,
    required: false,
    sensitive: true,
  },
] as const;

const BY_KEY = new Map(SEARCH_FIELDS.map((f) => [f.key, f]));

export function searchField(key: string): SearchFieldSpec | undefined {
  return BY_KEY.get(key as SearchFieldKey);
}

export function isSearchField(key: string): key is SearchFieldKey {
  return BY_KEY.has(key as SearchFieldKey);
}

/** The keys a member may actually toggle. */
export function optionalFieldKeys(): SearchFieldKey[] {
  return SEARCH_FIELDS.filter((f) => !f.required).map((f) => f.key);
}

export const DEFAULT_SEARCH_FIELDS: SearchFieldKey[] = SEARCH_FIELDS.filter((f) => f.defaultOn).map((f) => f.key);

export interface DiscoverySettings {
  /** Master switch. False = findable only by exact @handle. */
  discoverable: boolean;
  /** Which optional fields are searchable. Required fields are always in. */
  fields: SearchFieldKey[];
  /** Listed in the public directory for their category. */
  directoryListed: boolean;
}

/**
 * What a member who has never opened the screen gets. Note `city` and
 * `country` are absent — see the header.
 */
export const DEFAULT_DISCOVERY: DiscoverySettings = {
  discoverable: true,
  fields: DEFAULT_SEARCH_FIELDS,
  directoryListed: false,
};

/**
 * The columns to actually search for a given member's settings.
 *
 * Required fields are always included: a member who switched everything off is
 * still findable by the handle someone already knows, which is what makes
 * "search for my friend" work without making them enumerable.
 */
export function searchableColumns(settings: DiscoverySettings): SearchFieldSpec[] {
  if (!settings.discoverable) return SEARCH_FIELDS.filter((f) => f.required);
  const enabled = new Set(settings.fields);
  return SEARCH_FIELDS.filter((f) => f.required || enabled.has(f.key));
}

/** Normalise a stored list, dropping anything unrecognised. */
export function normalizeFields(raw: unknown): SearchFieldKey[] {
  if (!Array.isArray(raw)) return DEFAULT_SEARCH_FIELDS;
  const out = raw.filter((v): v is SearchFieldKey => typeof v === "string" && isSearchField(v));
  return [...new Set(out)];
}

/**
 * Whether a location filter may be applied to this member at all.
 *
 * Checked at MATCH time, not just at query time: someone searching "in Lagos"
 * must not surface a member who never opted into location search, even though
 * their city column holds "Lagos".
 */
export function locationSearchable(settings: DiscoverySettings): boolean {
  if (!settings.discoverable) return false;
  return settings.fields.includes("city") || settings.fields.includes("country");
}
