import { describe, expect, it } from "vitest";

import { SCHOOLS, isTeachable } from "@/lib/academy/schools";

import { SEARCH_INDEX, search } from "./index";

/**
 * Unified search gates.
 *
 * Two classes of failure. The first is quality — a result set that puts a lesson
 * above the tool someone is trying to use. The second is truth: search is a back
 * door into the corpus, and an index built without inheriting availability would
 * happily surface a school for a product that does not exist.
 */

describe("search index", () => {
  it("indexes every corpus", () => {
    const kinds = new Set(SEARCH_INDEX.map((d) => d.kind));
    expect(kinds).toContain("trust");
    expect(kinds).toContain("lesson");
    expect(kinds).toContain("school");
    expect(kinds).toContain("downloader");
  });

  it("has unique ids", () => {
    expect(new Set(SEARCH_INDEX.map((d) => d.id)).size).toBe(SEARCH_INDEX.length);
  });

  it("gives every document a title, summary and href", () => {
    for (const doc of SEARCH_INDEX) {
      expect(doc.title.trim(), doc.id).toBeTruthy();
      expect(doc.summary.trim(), doc.id).toBeTruthy();
      expect(doc.href.startsWith("/"), `${doc.id} href: ${doc.href}`).toBe(true);
    }
  });

  it("never indexes a school that may not teach", () => {
    /*
     * Search is a back door into the corpus. Everything else can gate correctly
     * and a naive index would still surface AI School to someone typing "ai".
     */
    const planned = SCHOOLS.filter((s) => !isTeachable(s)).map((s) => `school:${s.id}`);
    const indexed = new Set(SEARCH_INDEX.map((d) => d.id));
    const leaked = planned.filter((id) => indexed.has(id));

    expect(leaked, `Planned schools in the search index:\n  ${leaked.join("\n  ")}`).toHaveLength(0);
  });

  it("contains no personal data", () => {
    // The index ships to the browser as a static chunk. Progress, bookmarks and
    // anything else viewer-dependent must never enter it — the personal plane
    // stays on the server behind RLS.
    const forbidden = /progress|bookmark|note:|user:|viewer/i;
    const leaked = SEARCH_INDEX.filter((d) => forbidden.test(d.id)).map((d) => d.id);
    expect(leaked, `Personal-looking entries in a public index:\n  ${leaked.join("\n  ")}`).toHaveLength(0);
  });
});

describe("ranking", () => {
  it("returns nothing for an empty query", () => {
    expect(search("")).toHaveLength(0);
    expect(search("   ")).toHaveLength(0);
  });

  it("ranks the tool above writing about the tool", () => {
    // Someone typing a platform name wants to download, not to read.
    const results = search("tiktok");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.kind).toBe("downloader");
  });

  it("surfaces trust content for a problem-shaped query", () => {
    const results = search("delete my account");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.kind).toBe("trust");
  });

  it("narrows rather than broadens on a second word", () => {
    /*
     * The bug this prevents: with any-term matching, "tiktok audio" returns every
     * TikTok page — a two-word query becomes broader than a one-word one, which
     * is the opposite of what the person typing it expects.
     */
    const one = search("tiktok", 50);
    const two = search("tiktok audio", 50);
    expect(two.length).toBeLessThanOrEqual(one.length);
  });

  it("matches a query word against its inflected form in the prose", () => {
    /*
     * The bug this pins: `"deleting".includes("delete")` is FALSE — the shared
     * part stops at "delet". So "delete my account" scored zero against the
     * article whose summary says "Deleting your account starts a 30-day
     * countdown". The most important query in the trust corpus matched nothing,
     * and nothing about the code looked wrong.
     */
    for (const query of ["delete account", "deleting account", "deleted account"]) {
      const results = search(query);
      expect(results.length, `"${query}" found nothing`).toBeGreaterThan(0);
      expect(results[0]!.kind, `"${query}" ranked a non-trust result first`).toBe("trust");
    }
  });

  it("does not over-stem short words into false matches", () => {
    // A stemmer with no length guard turns "does" into "do" and "us" into "u",
    // which quietly makes short queries match almost everything.
    expect(search("zzqq us")).toHaveLength(0);
  });

  it("ignores diacritics and case", () => {
    // A visitor on a keyboard without accents must still find accented titles.
    expect(search("FRANCAIS").length).toBe(search("français").length);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(search("zzzzqqqxyz")).toHaveLength(0);
  });

  it("respects the limit", () => {
    expect(search("download", 3).length).toBeLessThanOrEqual(3);
  });
});
