import { describe, expect, it } from "vitest";

import { LESSON_SLUGS } from "@/lib/learning/catalog";
import { LESSON_DATES } from "@/lib/learning/dates";
import { articleJsonLd } from "@/lib/seo/article-ld";
import { BLOG_POSTS, BLOG_REDIRECTS, BLOG_SLUGS } from "@/lib/seo/blog";

/**
 * Every blog post and /learn guide carries Article JSON-LD with an author, datePublished and dateModified
 * (owner, 2026-10-29). These assert on the real records the pages read — and on the builder refusing a bad one.
 */
describe("Article JSON-LD", () => {
  it("has real dates for every /learn guide, and none for a guide that does not exist", () => {
    for (const slug of LESSON_SLUGS) expect(LESSON_DATES[slug], `${slug} has no dates in lib/learning/dates.ts`).toBeDefined();
    for (const slug of Object.keys(LESSON_DATES)) expect(LESSON_SLUGS, `${slug} is dated but is not a lesson`).toContain(slug);
  });

  it("builds a valid Article for every blog post and guide", () => {
    const pages = [
      ...BLOG_POSTS.map((p) => ({ path: `/blog/${p.slug}`, headline: p.title, description: p.description, published: p.date, updated: p.updated })),
      ...LESSON_SLUGS.map((slug) => ({ path: `/learn/${slug}`, headline: slug, description: slug, ...LESSON_DATES[slug]! })),
    ];
    for (const page of pages) {
      const ld = articleJsonLd(page);
      expect(ld["@type"]).toBe("Article");
      expect(ld.author["@type"]).toBe("Person");
      expect(ld.author.name.length).toBeGreaterThan(0);
      expect(ld.datePublished).toBe(page.published);
      expect(ld.dateModified >= ld.datePublished, page.path).toBe(true);
      expect(ld.url.endsWith(page.path)).toBe(true);
    }
  });

  it("refuses a date that is not ISO, and an edit dated before publication (teeth)", () => {
    const base = { path: "/blog/x", headline: "x", description: "x" };
    expect(() => articleJsonLd({ ...base, published: "June 10, 2026" })).toThrow(/not an ISO date/);
    expect(() => articleJsonLd({ ...base, published: "2026-06-10", updated: "2026-06-01" })).toThrow(/before datePublished/);
    expect(articleJsonLd({ ...base, published: "2026-06-10" }).dateModified).toBe("2026-06-10");
  });

  it("redirects the renamed TikTok guide to a post that exists, and never from a live slug", () => {
    expect(BLOG_REDIRECTS.length).toBeGreaterThan(0);
    for (const { from, to } of BLOG_REDIRECTS) {
      expect(BLOG_SLUGS, `${to} is not a post`).toContain(to);
      expect(BLOG_SLUGS, `${from} still exists, so the redirect would shadow it`).not.toContain(from);
    }
  });

  it("keeps the reposting language out of every post", () => {
    const text = JSON.stringify(BLOG_POSTS).toLowerCase();
    for (const phrase of ["repost", "repurpose", "without a watermark", "watermark-free", "trending sound"]) {
      expect(text.includes(phrase), `a blog post says "${phrase}"`).toBe(false);
    }
  });
});
