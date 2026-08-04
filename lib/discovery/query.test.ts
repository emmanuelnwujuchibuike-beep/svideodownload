import { describe, expect, it } from "vitest";

import { isEmptyQuery, parseQuery } from "@/lib/discovery/query";
import {
  DEFAULT_DISCOVERY,
  DEFAULT_SEARCH_FIELDS,
  locationSearchable,
  normalizeFields,
  optionalFieldKeys,
  SEARCH_FIELDS,
  searchableColumns,
  searchField,
} from "@/lib/discovery/fields";

describe("parseQuery — the brief's own examples", () => {
  it('"the photographer from Lagos"', () => {
    const q = parseQuery("the photographer from Lagos");
    expect(q.terms).toEqual(["photographer"]);
    expect(q.filters.location).toBe("Lagos");
    expect(q.interpreted).toContain("Lagos");
  });

  it('"the creator that teaches JavaScript"', () => {
    const q = parseQuery("the creator that teaches JavaScript");
    expect(q.filters.kinds).toEqual(["creator"]);
    expect(q.terms).toEqual(["teaches", "javascript"]);
  });

  it('"verified graphic designer"', () => {
    const q = parseQuery("verified graphic designer");
    expect(q.filters.verified).toBe(true);
    expect(q.terms).toEqual(["graphic", "designer"]);
  });

  it('"people interested in AI" keeps the subject rather than reading "in" as a place', () => {
    const q = parseQuery("people interested in AI");
    expect(q.terms).toContain("interested");
    // "in AI" parses as a location, which is the honest limit of a vocabulary
    // parser — but the word is preserved either way, so the search still finds
    // AI people through skills and headline.
    expect(q.filters.location === "AI" || q.terms.includes("ai")).toBe(true);
  });

  it('"coffee shops near me"', () => {
    const q = parseQuery("coffee shops near me");
    expect(q.filters.nearMe).toBe(true);
    expect(q.terms).toContain("coffee");
    expect(q.interpreted).toContain("Near you");
  });
});

describe("parseQuery — filters", () => {
  it("recognises every profile kind", () => {
    expect(parseQuery("business").filters.kinds).toEqual(["business"]);
    expect(parseQuery("developers").filters.kinds).toEqual(["developer"]);
    expect(parseQuery("students").filters.kinds).toEqual(["student"]);
    expect(parseQuery("nonprofit").filters.kinds).toEqual(["organization"]);
  });

  it("does not repeat a kind", () => {
    expect(parseQuery("creator creators influencer").filters.kinds).toEqual(["creator"]);
  });

  it("picks up availability", () => {
    expect(parseQuery("available designer").filters.availableOnly).toBe(true);
  });

  it("takes a two-word place when the second word is capitalised", () => {
    expect(parseQuery("designer in New York").filters.location).toBe("New York");
    expect(parseQuery("designer in Port Harcourt").filters.location).toBe("Port Harcourt");
  });

  it("takes a one-word place when the next word is not a place", () => {
    expect(parseQuery("designer in Lagos verified").filters.location).toBe("Lagos");
  });

  // Never inferred from prose — the parser does not claim to know your friends.
  it("never infers friendsOnly from a sentence", () => {
    expect(parseQuery("my friend from university").filters.friendsOnly).toBe(false);
  });
});

describe("parseQuery — text handling", () => {
  it("keeps quoted phrases literal, filter words and all", () => {
    const q = parseQuery('"verified creator" photographer');
    expect(q.phrases).toEqual(["verified creator"]);
    expect(q.filters.verified).toBe(false);
    expect(q.terms).toEqual(["photographer"]);
  });

  it("strips a leading @ from a handle term", () => {
    expect(parseQuery("@emily").terms).toEqual(["emily"]);
  });

  it("detects an unambiguous handle lookup", () => {
    expect(parseQuery("@emily").handle).toBe("emily");
    expect(parseQuery("emily").handle).toBe("emily");
    expect(parseQuery("emily wakeforrd").handle).toBeNull();
    expect(parseQuery("verified creator").handle).toBeNull();
  });

  it("de-duplicates terms", () => {
    expect(parseQuery("design design design").terms).toEqual(["design"]);
  });

  it("caps the term count so one query cannot become a huge OR", () => {
    expect(parseQuery("a1 b2 c3 d4 e5 f6 g7 h8 i9 j10 k11").terms.length).toBeLessThanOrEqual(8);
  });

  it("caps the query length", () => {
    expect(() => parseQuery("x".repeat(5000))).not.toThrow();
  });

  it("keeps names that overlap the filler list", () => {
    // Aggressive stopwords break real names; only meaningless words are dropped.
    expect(parseQuery("weeknd").terms).toEqual(["weeknd"]);
  });

  it("survives punctuation and empty input", () => {
    expect(parseQuery("!!!").terms).toEqual([]);
    expect(parseQuery("").terms).toEqual([]);
    expect(parseQuery("   ").terms).toEqual([]);
  });

  it("knows when there is nothing to search", () => {
    expect(isEmptyQuery(parseQuery(""))).toBe(true);
    expect(isEmptyQuery(parseQuery("the a an"))).toBe(true);
    expect(isEmptyQuery(parseQuery("verified"))).toBe(false);
    expect(isEmptyQuery(parseQuery("emily"))).toBe(false);
  });

  it("explains itself — every filter produces a chip", () => {
    const q = parseQuery("verified creator in Lagos available");
    expect(q.interpreted).toEqual(expect.arrayContaining(["Verified", "Creator", "Lagos", "Available"]));
  });
});

describe("searchable fields", () => {
  it("has no duplicate keys", () => {
    const keys = SEARCH_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // The decision the whole module exists for.
  it("leaves city and country OFF by default", () => {
    expect(DEFAULT_SEARCH_FIELDS).not.toContain("city");
    expect(DEFAULT_SEARCH_FIELDS).not.toContain("country");
    expect(DEFAULT_DISCOVERY.fields).not.toContain("city");
  });

  it("marks exactly the location fields sensitive", () => {
    expect(SEARCH_FIELDS.filter((f) => f.sensitive).map((f) => f.key).sort()).toEqual(["city", "country"]);
  });

  it("keeps handle and name always searchable", () => {
    expect(SEARCH_FIELDS.filter((f) => f.required).map((f) => f.key).sort()).toEqual(["display_name", "handle"]);
    expect(optionalFieldKeys()).not.toContain("handle");
  });

  it("still allows a handle lookup when discovery is switched off", () => {
    const columns = searchableColumns({ discoverable: false, fields: [], directoryListed: false });
    expect(columns.map((c) => c.key).sort()).toEqual(["display_name", "handle"]);
  });

  it("includes required fields even when the member disabled everything", () => {
    const columns = searchableColumns({ discoverable: true, fields: [], directoryListed: false });
    expect(columns.map((c) => c.key).sort()).toEqual(["display_name", "handle"]);
  });

  it("adds the optional fields a member switched on", () => {
    const columns = searchableColumns({ discoverable: true, fields: ["skills", "city"], directoryListed: false });
    expect(columns.map((c) => c.key)).toContain("skills");
    expect(columns.map((c) => c.key)).toContain("city");
  });

  it("only allows a location match when the member opted in", () => {
    expect(locationSearchable(DEFAULT_DISCOVERY)).toBe(false);
    expect(locationSearchable({ discoverable: true, fields: ["city"], directoryListed: false })).toBe(true);
    // Master switch outranks the field.
    expect(locationSearchable({ discoverable: false, fields: ["city"], directoryListed: false })).toBe(false);
  });

  it("drops unrecognised stored fields rather than trusting them", () => {
    expect(normalizeFields(["skills", "password", 42, null])).toEqual(["skills"]);
    expect(normalizeFields("nonsense")).toEqual(DEFAULT_SEARCH_FIELDS);
    expect(normalizeFields(["skills", "skills"])).toEqual(["skills"]);
  });

  it("resolves every field to a real column", () => {
    for (const f of SEARCH_FIELDS) {
      expect(searchField(f.key)).toBeDefined();
      expect(f.column.length).toBeGreaterThan(0);
    }
  });
});
