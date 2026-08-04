/**
 * Profile search intent parser (Feature 18 · Part 18).
 *
 * ── This is a parser, not a model, and that is the right call ─────────────
 * The brief asks for "AI Profile Search" understanding natural language. The
 * obvious reading is to send the query to a language model. That would be
 * slower (a network round trip against a sub-100ms target), cost money per
 * keystroke, be non-deterministic, and — the part that actually decides it —
 * would ship every search anyone types to a third party. People search for
 * their ex, their doctor, their old school. That is not a payload to hand to
 * an external API for a feature whose whole promise is "privacy always wins".
 *
 * So intent is extracted deterministically: known filter words are lifted out
 * of the query, the rest becomes the text to match. It runs in microseconds,
 * offline, identically every time — and because it is deterministic it can
 * SHOW the user how it read their query, which no black box can. "Verified
 * photographer in Lagos" visibly becomes `verified · photographer · Lagos`,
 * and any word it did not understand is still searched as text rather than
 * silently dropped.
 *
 * The honest limit: it understands vocabulary, not grammar. "The creator that
 * teaches JavaScript" resolves to creator + "teaches javascript", which finds
 * the right people through the skills and headline fields. "My friend from
 * university" is NOT interpreted as a relationship query — the parser does not
 * pretend to know who your friends are, and `friends: true` is a filter the UI
 * offers as a toggle instead of one guessed from a sentence.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export type ProfileKindFilter =
  | "creator"
  | "business"
  | "professional"
  | "developer"
  | "student"
  | "organization"
  | "community";

export interface ParsedQuery {
  /** What is left to match as free text, lowercased and de-duplicated. */
  terms: string[];
  /** The original text minus the filter words — what goes to the DB. */
  text: string;
  /** Exact phrases the user put in quotes. Matched as a unit. */
  phrases: string[];
  /** A leading @handle, if the query is clearly a handle lookup. */
  handle: string | null;
  filters: {
    verified: boolean;
    /** Near the viewer — requires the viewer's own location and their consent. */
    nearMe: boolean;
    /** A named place, from "in X" / "from X" / "near X". */
    location: string | null;
    kinds: ProfileKindFilter[];
    /** Restrict to people the viewer already knows. Never inferred from prose. */
    friendsOnly: boolean;
    /** Available for work, from `profile_details.availability`. */
    availableOnly: boolean;
  };
  /** Human-readable chips describing how the query was understood. */
  interpreted: string[];
}

const KIND_WORDS: Record<string, ProfileKindFilter> = {
  creator: "creator",
  creators: "creator",
  influencer: "creator",
  business: "business",
  businesses: "business",
  shop: "business",
  store: "business",
  company: "business",
  brand: "business",
  professional: "professional",
  professionals: "professional",
  freelancer: "professional",
  developer: "developer",
  developers: "developer",
  dev: "developer",
  engineer: "developer",
  programmer: "developer",
  student: "student",
  students: "student",
  organization: "organization",
  organisation: "organization",
  org: "organization",
  nonprofit: "organization",
  charity: "organization",
  community: "community",
  communities: "community",
};

const VERIFIED_WORDS = new Set(["verified", "official"]);
const AVAILABLE_WORDS = new Set(["available", "hiring", "freelance", "open"]);

/**
 * Filler words that carry no search meaning. Dropped so "the photographer from
 * Lagos" does not spend a term on "the".
 *
 * Kept deliberately short. An aggressive stopword list is how a search engine
 * starts failing on real names — "The Weeknd", "A Tribe Called Quest" — so
 * only words that could never be part of a name are here.
 */
const FILLER = new Set([
  "the",
  "a",
  "an",
  "that",
  "who",
  "which",
  "with",
  "and",
  "for",
  "of",
  "is",
  "are",
  "some",
  "any",
  "me",
  "my",
  "find",
  "search",
  "show",
  "people",
  "person",
  "profiles",
  "profile",
]);

/** Words that introduce a place. */
const LOCATION_PREPOSITIONS = new Set(["in", "from", "near", "around", "at"]);

const MAX_QUERY = 120;
const MAX_TERMS = 8;

function stripPunctuation(word: string): string {
  return word.replace(/^[^\p{L}\p{N}@#+]+|[^\p{L}\p{N}+#]+$/gu, "");
}

export function parseQuery(raw: string): ParsedQuery {
  const input = (raw ?? "").slice(0, MAX_QUERY);

  // Quoted phrases are lifted out first so a filter word inside quotes stays
  // literal — searching for "verified" the word, not the badge.
  const phrases: string[] = [];
  const withoutPhrases = input.replace(/"([^"]{1,60})"/g, (_m, phrase: string) => {
    const cleaned = phrase.trim().toLowerCase();
    if (cleaned) phrases.push(cleaned);
    return " ";
  });

  const words = withoutPhrases.split(/\s+/).map(stripPunctuation).filter(Boolean);

  const filters: ParsedQuery["filters"] = {
    verified: false,
    nearMe: false,
    location: null,
    kinds: [],
    friendsOnly: false,
    availableOnly: false,
  };
  const interpreted: string[] = [];
  const terms: string[] = [];

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    const lower = word.toLowerCase();

    // A leading @handle short-circuits everything else.
    if (lower.startsWith("@") && lower.length > 1) {
      terms.push(lower.slice(1));
      continue;
    }

    if (VERIFIED_WORDS.has(lower)) {
      filters.verified = true;
      interpreted.push("Verified");
      continue;
    }

    if (AVAILABLE_WORDS.has(lower)) {
      filters.availableOnly = true;
      interpreted.push("Available");
      continue;
    }

    const kind = KIND_WORDS[lower];
    if (kind) {
      if (!filters.kinds.includes(kind)) {
        filters.kinds.push(kind);
        interpreted.push(kind[0]!.toUpperCase() + kind.slice(1));
      }
      continue;
    }

    // "near me" — the only phrase that means the viewer's own location.
    if (LOCATION_PREPOSITIONS.has(lower)) {
      const next = words[i + 1];
      if (!next) continue;
      const nextLower = next.toLowerCase();
      if (lower === "near" && nextLower === "me") {
        filters.nearMe = true;
        interpreted.push("Near you");
        i += 1;
        continue;
      }
      if (FILLER.has(nextLower)) continue;
      // Take up to two words as the place ("New York", "Port Harcourt").
      const second = words[i + 2];
      const place = second && !FILLER.has(second.toLowerCase()) && !KIND_WORDS[second.toLowerCase()] && /^\p{Lu}/u.test(second)
        ? `${next} ${second}`
        : next;
      filters.location = place;
      interpreted.push(place);
      i += place.includes(" ") ? 2 : 1;
      continue;
    }

    if (FILLER.has(lower)) continue;
    if (!terms.includes(lower)) terms.push(lower);
  }

  const trimmedTerms = terms.slice(0, MAX_TERMS);

  return {
    terms: trimmedTerms,
    text: trimmedTerms.join(" "),
    phrases,
    handle: detectHandle(input),
    filters,
    interpreted,
  };
}

/**
 * A query that is unambiguously one handle — "@emily", or a bare word that
 * looks like a handle and nothing else. Used to jump straight to a profile
 * instead of showing a one-result list.
 */
function detectHandle(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^@?[a-z0-9_.]{2,30}$/i.test(trimmed)) return null;
  return trimmed.replace(/^@/, "").toLowerCase();
}

/** True when there is nothing to search on — no text, no filters. */
export function isEmptyQuery(parsed: ParsedQuery): boolean {
  return (
    parsed.terms.length === 0 &&
    parsed.phrases.length === 0 &&
    !parsed.filters.verified &&
    !parsed.filters.nearMe &&
    !parsed.filters.location &&
    parsed.filters.kinds.length === 0 &&
    !parsed.filters.availableOnly
  );
}
