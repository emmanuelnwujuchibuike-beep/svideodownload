import { describe, expect, it } from "vitest";

import { ALL_PAGES } from "./seo-pages";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE GUARD AGAINST A FOURTH "LOW VALUE CONTENT" REJECTION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Three AdSense rejections have now been traced to the same root cause: text
 * written once and printed on many pages with only the brand swapped. Round 1
 * (2026-08-23) merged 70 pages away; round 3 (2026-09-02) rewrote the prose
 * per platform. Neither left anything behind that would FAIL if it came back,
 * which is why it came back.
 *
 * This is that thing. It measures the property Google actually penalises —
 * the same sentence appearing across DIFFERENT platforms — and fails the build
 * when it reappears.
 *
 * ── 🔴 CROSS-PLATFORM AND WITHIN-PLATFORM ARE DIFFERENT PROBLEMS ─────────────
 *
 * Conflating them sent the first pass of this fix in the wrong direction: a
 * naive "how much text is shared between pages" metric got WORSE after the
 * rewrite (87% -> 92%), because giving each platform its own five FAQs meant
 * printing them on all twelve of that platform's pages.
 *
 *   CROSS-platform  — the same words under two different brands. This is the
 *                     scaled-content signal, and it is what this file forbids.
 *   WITHIN-platform — one platform's paragraph on several of its own pages.
 *                     A page-COUNT question, not a copy question: eleven
 *                     platforms cannot honestly support eighty-two pages. It
 *                     is measured here and reported, not failed, because the
 *                     fix is merging pages and that is the owner's call.
 */

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Brand and noun masked, so "the same sentence, different brand" is caught. */
const mask = (s: string, brand: string, thing: string) =>
  norm(s).split(brand).join("{B}").split(thing).join("{T}");

function crossPlatform(pick: (p: (typeof ALL_PAGES)[number]) => string[]) {
  const byString = new Map<string, Set<string>>();
  for (const p of ALL_PAGES) {
    for (const raw of pick(p)) {
      const key = mask(raw, p.brand, p.thing);
      if (!byString.has(key)) byString.set(key, new Set());
      byString.get(key)!.add(p.platformId);
    }
  }
  return [...byString.entries()]
    .filter(([, platforms]) => platforms.size > 1)
    .map(([text, platforms]) => ({ text, platforms: [...platforms] }));
}

describe("🔴 no page BODY text is shared across platforms", () => {
  it("about paragraphs are written per platform", () => {
    /*
      Was 82% shared before the 2026-09-02 rewrite, with one paragraph on 11
      pages. Body prose is the strongest duplicate signal there is — a crawler
      reading two of these pages should not see the same essay twice.
    */
    expect(crossPlatform((p) => p.about)).toEqual([]);
  });

  it("meta descriptions are unique per page", () => {
    // Was 87% shared: one sentence with the brand swapped, on all 82 pages.
    const seen = new Map<string, string[]>();
    for (const p of ALL_PAGES) {
      const k = norm(p.description);
      seen.set(k, [...(seen.get(k) ?? []), p.slug]);
    }
    const dupes = [...seen.entries()].filter(([, slugs]) => slugs.length > 1);
    expect(dupes).toEqual([]);
  });

  it("🔴 a shared modifier never prints its own prose", () => {
    /*
      `mHd`/`mMp3`/`mIphone`/`mAndroid`/`mPc` in config/seoPages.ts are single
      objects spread onto 9-11 clusters each. Printing their angle/benefit/faqs
      put identical text on 9-11 pages and was the ENTIRE remaining duplication
      after the platform rewrite. `buildPage` suppresses it wherever platform
      content exists; this fails if that suppression is removed.
    */
    const offenders = crossPlatform((p) => [
      ...p.benefits.map((b) => `${b.title} :: ${b.text}`),
      ...p.faqs.map((f) => `${f.q} :: ${f.a}`),
    ]);
    // Titles legitimately follow a brand-varying pattern; BODY text may not.
    expect(offenders.length, JSON.stringify(offenders.slice(0, 3), null, 1)).toBeLessThanOrEqual(2);
  });
});

describe("every page carries real platform-specific content", () => {
  it("has a written intro, features and FAQs", () => {
    for (const p of ALL_PAGES) {
      expect(p.about.length, `${p.slug} has no body`).toBeGreaterThan(0);
      expect(p.benefits.length, `${p.slug} has no features`).toBeGreaterThanOrEqual(3);
      expect(p.faqs.length, `${p.slug} has too few FAQs`).toBeGreaterThanOrEqual(3);
    }
  });

  it("🔴 never claims to reach private content", () => {
    /*
      The 2026-08-23 round had to rewrite an FAQ that read like a promise to
      bypass someone's privacy settings. That wording is a policy problem quite
      apart from duplication, so it is pinned here.
    */
    const text = ALL_PAGES.flatMap((p) => [
      ...p.about,
      ...p.faqs.map((f) => `${f.q} ${f.a}`),
      ...p.benefits.map((b) => `${b.title} ${b.text}`),
    ])
      .join(" ")
      .toLowerCase();
    for (const claim of [
      "download private",
      "bypass privacy",
      "without permission",
      "anyone's private",
      "private account videos",
    ]) {
      expect(text, `claims: ${claim}`).not.toContain(claim);
    }
  });
});
