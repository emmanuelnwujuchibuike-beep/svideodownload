import { describe, expect, it } from "vitest";

import { SUPPORT_ARTICLES, getArticle, relatedArticles } from "./articles";
import { SECTIONS } from "./sections";
import { TRUST_SECTIONS } from "./types";

/**
 * Trust & Support corpus gates.
 *
 * Trust content has a failure mode worse than being unhelpful: telling someone a
 * protection exists when it does not means they believe they are safe when they
 * are not. These checks cover the structural half of that; the content half was
 * verified by reading the product before the articles were written.
 */

describe("support corpus", () => {
  it("has unique slugs", () => {
    expect(new Set(SUPPORT_ARTICLES.map((a) => a.slug)).size).toBe(SUPPORT_ARTICLES.length);
  });

  it("gives every article a plain-language summary", () => {
    /*
     * Required by the type, enforced here as non-empty. Trust content is where
     * people skim and then act on a half-understanding — someone deciding whether
     * account deletion is reversible needs the answer in the first two lines.
     */
    for (const a of SUPPORT_ARTICLES) {
      expect(a.summary.trim().length, `${a.slug} has an empty summary`).toBeGreaterThan(20);
    }
  });

  it("keeps summaries genuinely short", () => {
    // A summary that runs to a paragraph is not a summary, and it silently
    // reintroduces the skimming problem it exists to solve.
    for (const a of SUPPORT_ARTICLES) {
      expect(a.summary.length, `${a.slug} summary is too long to skim`).toBeLessThan(260);
    }
  });

  it("resolves every related link", () => {
    const broken = SUPPORT_ARTICLES.flatMap((a) =>
      a.related.filter((s) => !getArticle(s)).map((s) => `${a.slug} → ${s}`),
    );
    expect(broken, `Broken related links:\n  ${broken.join("\n  ")}`).toHaveLength(0);
  });

  it("never links an article to itself", () => {
    for (const a of SUPPORT_ARTICLES) {
      expect(a.related, `${a.slug} lists itself as related`).not.toContain(a.slug);
    }
  });

  it("points every policy reference at a real policy route", () => {
    /*
     * An article that says "this explains our formal policy" and links to a 404 is
     * worse than one that says nothing — it implies a governing document that the
     * reader cannot reach.
     */
    const routes = new Set(["/privacy", "/terms", "/dmca"]);
    for (const a of SUPPORT_ARTICLES) {
      if (!a.policyHref) continue;
      expect(routes.has(a.policyHref), `${a.slug} → unknown policy ${a.policyHref}`).toBe(true);
    }
  });

  it("declares a section that exists", () => {
    for (const a of SUPPORT_ARTICLES) {
      expect(SECTIONS[a.section], `${a.slug} → unknown section`).toBeTruthy();
    }
  });

  it("populates every Trust Center section", () => {
    // An empty section renders as a heading with nothing under it — the trust
    // equivalent of a hollow course.
    for (const id of TRUST_SECTIONS) {
      const count = SUPPORT_ARTICLES.filter((a) => a.section === id).length;
      expect(count, `Trust section "${id}" has no articles`).toBeGreaterThan(0);
    }
  });

  it("keeps related links symmetric enough to navigate", () => {
    // Not strict symmetry — a general article may point to a specific one without
    // the reverse. This only asserts related links resolve in at least one hop,
    // which is what stops the corpus fragmenting into unreachable pockets.
    for (const a of SUPPORT_ARTICLES) {
      if (a.related.length === 0) continue;
      expect(relatedArticles(a.slug).length, `${a.slug} has related links that all failed`).toBeGreaterThan(0);
    }
  });
});

describe("no fabricated reliability claims", () => {
  it("does not promise a response time we do not measure", () => {
    /*
     * The Trust brief asks for status, uptime and incident reporting. None of that
     * is measured today, so none of it is claimed. This guards the specific
     * temptation: an SLA-shaped phrase creeping into trust copy, where it would be
     * read as a commitment.
     */
    const corpus = SUPPORT_ARTICLES.flatMap((a) => [
      a.summary,
      ...a.blocks.flatMap((b) => b.body),
      ...(a.faqs ?? []).map((f) => f.a),
    ]).join(" ");

    const slaClaims = [
      /within \d+ (hours?|days?|minutes?)/i,
      /\d+(\.\d+)?%\s*uptime/i,
      /guarantee[ds]?\s+(response|availability|uptime)/i,
      /24\/7\s+(support|monitoring)/i,
    ];

    const found = slaClaims.filter((re) => re.test(corpus)).map((re) => re.source);
    expect(found, `Unmeasured commitments in trust copy:\n  ${found.join("\n  ")}`).toHaveLength(0);
  });
});
