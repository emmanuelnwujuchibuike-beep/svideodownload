import { describe, expect, it } from "vitest";

import {
  HELP_ARTICLES,
  SUPPORT_ARTICLES,
  TRUST_ARTICLES,
  articleHref,
  getArticle,
  relatedArticles,
} from "./articles";
import { GLOSSARY, getTerm } from "./glossary";
import { SECTIONS } from "./sections";
import { HELP_SECTIONS, TRUST_SECTIONS } from "./types";

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

  it("populates every section of both centres", () => {
    // An empty section renders as a heading with nothing under it — the support
    // equivalent of a hollow course. This caught the real state the Help Center
    // shipped from: `getting-started` and `troubleshooting` existed as section
    // metadata, in the search index's group labels and in the section ordering,
    // with zero articles behind them and no route to render them on.
    for (const id of [...TRUST_SECTIONS, ...HELP_SECTIONS]) {
      const count = SUPPORT_ARTICLES.filter((a) => a.section === id).length;
      expect(count, `Section "${id}" has no articles`).toBeGreaterThan(0);
    }
  });

  it("gives every article exactly one canonical URL", () => {
    /*
     * One corpus, two centres, one URL each.
     *
     * Before `articleHref` existed, every consumer assumed `/trust/<slug>`: the
     * article route generated static params for the whole corpus, the sitemap
     * listed every slug under /trust, the search index built /trust hrefs and the
     * assistant cited them. The first help article would therefore have been
     * published at two canonical URLs and advertised at the wrong one — search
     * engines pick a winner, ranking splits, and nothing looks broken in the UI
     * because both URLs render a perfectly good page.
     */
    for (const a of SUPPORT_ARTICLES) {
      const href = articleHref(a);
      const expected = HELP_SECTIONS.includes(a.section) ? "/help" : "/trust";
      expect(href, `${a.slug} is not under ${expected}`).toBe(`${expected}/${a.slug}`);
    }

    expect(new Set(SUPPORT_ARTICLES.map(articleHref)).size).toBe(SUPPORT_ARTICLES.length);
  });

  it("splits the corpus between the centres with nothing lost or shared", () => {
    // The two route-param lists must partition the corpus: an article in both
    // gets two pages, an article in neither has no page at all and is reachable
    // only by typing a URL that does not exist.
    const help = new Set(HELP_ARTICLES.map((a) => a.slug));
    const trust = new Set(TRUST_ARTICLES.map((a) => a.slug));

    expect(help.size + trust.size).toBe(SUPPORT_ARTICLES.length);
    for (const slug of help) {
      expect(trust.has(slug), `${slug} would render under both centres`).toBe(false);
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

/* ---------------------------------- glossary --------------------------------- */

describe("glossary", () => {
  it("has unique slugs and terms", () => {
    expect(new Set(GLOSSARY.map((t) => t.slug)).size).toBe(GLOSSARY.length);
    expect(new Set(GLOSSARY.map((t) => t.term.toLowerCase())).size).toBe(GLOSSARY.length);
  });

  it("resolves every related term", () => {
    const broken = GLOSSARY.flatMap((t) =>
      t.related.filter((s) => !getTerm(s)).map((s) => `${t.slug} → ${s}`),
    );
    expect(broken, `Broken glossary links:\n  ${broken.join("\n  ")}`).toHaveLength(0);
  });

  it("never relates a term to itself", () => {
    for (const t of GLOSSARY) {
      expect(t.related, `${t.slug} lists itself`).not.toContain(t.slug);
    }
  });

  it("gives every term aliases people would actually type", () => {
    /*
     * Aliases are the search terms. Somebody types "srt" far more often than
     * "sidecar captions", and a term with no aliases is findable only by people
     * who already know its name — i.e. the people who did not need the glossary.
     */
    for (const t of GLOSSARY) {
      expect(t.aliases.length, `${t.slug} has no aliases`).toBeGreaterThan(0);
    }
  });

  it("keeps definitions self-contained", () => {
    /*
     * A definition may not require another definition to parse. Jargon defined by
     * more jargon is the failure mode of every glossary ever written, and it is
     * worse than no glossary because it looks like help.
     *
     * Checked narrowly: a definition may MENTION another term (that is what
     * `related` is for) but must not open by leaning on one, which is the shape
     * that leaves a reader circling.
     */
    const terms = GLOSSARY.map((t) => t.term.toLowerCase());
    for (const t of GLOSSARY) {
      const opening = t.definition.toLowerCase().slice(0, 40);
      const leansOn = terms.filter((other) => other !== t.term.toLowerCase() && opening.includes(other));
      expect(leansOn, `${t.slug} opens by relying on: ${leansOn.join(", ")}`).toHaveLength(0);
    }
  });

  it("keeps definitions short enough to read", () => {
    for (const t of GLOSSARY) {
      expect(t.definition.length, `${t.slug} is too long for a definition`).toBeLessThan(320);
    }
  });
});
