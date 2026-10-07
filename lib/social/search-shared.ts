import type { SearchResult } from "./search";

/** The "nothing matched" shape, so no call site has to spell out five keys.
 *  Lives apart from `search.ts` so a client component can use it without
 *  pulling that module's service-role queries into a browser bundle. */
export function emptySearchResult(): SearchResult {
  return { people: [], posts: [], sounds: [], tags: [], places: [] };
}
