import { describe, expect, it } from "vitest";

import { LESSON_CATALOG } from "@/lib/learning/catalog";
import { SEO_SLUGS } from "@/lib/seo/seo-pages";

import {
  PILLAR_MIN_LESSONS,
  PILLAR_MIN_MEMBERS,
  TOPICS,
  allClusters,
  clusterFor,
  getTopic,
  getTopicBySlug,
  isPublishable,
  pillarForLesson,
  publishableClusters,
  seoPagesAcrossPlatforms,
  topicHref,
} from "./topics";

/**
 * Topic clusters — the subject axis.
 *
 * Two failure modes drive everything here, and neither is visible on a rendered
 * page:
 *
 *  1. A SECOND TAXONOMY. `LessonTopic` and this registry describe the same
 *     thing. The moment one gains a value the other lacks, lessons start
 *     silently belonging to no cluster and their pillar back-link disappears —
 *     with no error anywhere.
 *  2. A PILLAR THAT LINKS TO A 404. `pillarForLesson` must agree with
 *     `generateStaticParams` about which pillars exist. If it does not, every
 *     lesson in an unpublished cluster renders a confident link to nothing.
 */

describe("Topics — one taxonomy, not two", () => {
  it("has exactly one topic record per LessonTopic in use", () => {
    /*
     * Checked from the lesson corpus rather than from the type, because a union
     * member with no lesson is harmless while a LESSON with no topic record is
     * the bug. This is the direction that actually breaks.
     */
    const used = new Set(LESSON_CATALOG.map((l) => l.topic));
    const missing = [...used].filter((t) => !getTopic(t));
    expect(missing, `Lesson topics with no cluster record: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("places every lesson in exactly one cluster", () => {
    for (const lesson of LESSON_CATALOG) {
      const owning = allClusters().filter((c) => c.lessons.some((l) => l.slug === lesson.slug));
      expect(owning.length, `${lesson.slug} is in ${owning.length} clusters`).toBe(1);
    }
  });

  it("has unique ids, slugs and ordering", () => {
    expect(new Set(TOPICS.map((t) => t.id)).size).toBe(TOPICS.length);
    expect(new Set(TOPICS.map((t) => t.slug)).size).toBe(TOPICS.length);
    expect(new Set(TOPICS.map((t) => t.order)).size).toBe(TOPICS.length);
  });

  it("never collides with an existing SEO page slug", () => {
    // Pillars live at /topics/<slug> and keyword pages at /<slug>, so a clash is
    // not a routing conflict — but it is two pages competing for one phrase,
    // which is the canonical split this project has already been bitten by.
    const seo = new Set(SEO_SLUGS);
    const clashes = TOPICS.filter((t) => seo.has(t.slug)).map((t) => t.slug);
    expect(clashes, `Topic slugs shadowing SEO pages: ${clashes.join(", ")}`).toHaveLength(0);
  });
});

describe("Topics — vocabulary quality", () => {
  it("matches on word boundaries, not substrings", () => {
    /*
     * The bug this prevents: a bare `includes` makes "api" match "capability",
     * "rapid" and "apart", quietly filling the developer cluster with unrelated
     * pages so it looks healthy while being wrong. The mirror of the
     * `"deleting".includes("delete")` failure the search index already hit.
     */
    const developer = clusterFor(getTopic("developer")!);
    const falsePositives = developer.seoPages.filter((p) =>
      /capability|rapid|apart|therapist/i.test(`${p.slug} ${p.primaryKeyword}`),
    );
    expect(falsePositives.map((p) => p.slug)).toHaveLength(0);
  });

  it("uses terms specific enough to mean something", () => {
    // A term matching most of the corpus produces a cluster that carries no
    // information. "video" on a video site is the canonical example.
    const TOO_GENERAL = ["video", "file", "app", "online", "free", "web", "media"];
    for (const topic of TOPICS) {
      for (const term of topic.terms) {
        expect(
          TOO_GENERAL.includes(term.toLowerCase()),
          `${topic.id} uses the near-universal term "${term}"`,
        ).toBe(false);
        expect(term.trim().length, `${topic.id} has a trivially short term`).toBeGreaterThan(1);
      }
    }
  });

  it("gives every topic a distinct intent written from the reader's situation", () => {
    const intents = TOPICS.map((t) => t.intent.trim());
    expect(new Set(intents).size, "two topics share an intent line").toBe(TOPICS.length);
    for (const topic of TOPICS) {
      expect(topic.intent.length, `${topic.id} has no intent`).toBeGreaterThan(30);
      expect(topic.description.length, `${topic.id} description too long for meta`).toBeLessThan(200);
    }
  });
});

describe("Topics — the pillar gate", () => {
  it("requires an authored lesson and enough destinations", () => {
    for (const cluster of publishableClusters()) {
      expect(cluster.lessons.length, `${cluster.topic.id}`).toBeGreaterThanOrEqual(
        PILLAR_MIN_LESSONS,
      );
      expect(cluster.size, `${cluster.topic.id}`).toBeGreaterThanOrEqual(PILLAR_MIN_MEMBERS);
    }
  });

  it("withholds a pillar from a cluster built only of keyword matches", () => {
    // The gate that matters: membership for everything except lessons is a
    // heuristic, so a cluster with no lesson has no human-authored anchor and
    // must not become a page no matter how many pages happen to match.
    const noLesson = { ...clusterFor(TOPICS[0]!), lessons: [], size: 40 };
    expect(isPublishable(noLesson)).toBe(false);
  });

  it("publishes at least one pillar, or the feature is inert", () => {
    // Guards against a gate so strict nothing ships — which would pass every
    // other test in this file while delivering nothing.
    expect(publishableClusters().length).toBeGreaterThan(0);
  });

  it("reports unpublished clusters as a backlog of real topics", () => {
    // Not asserted empty: a subject with too little written about it is an
    // editorial state, not a fault. It should be visible, not fatal.
    const held = allClusters().filter((c) => !isPublishable(c));
    for (const cluster of held) {
      expect(getTopicBySlug(cluster.topic.slug), "backlog names a real topic").toBeTruthy();
    }
  });
});

describe("Topics — the platform sample", () => {
  const biggest = allClusters().sort((a, b) => b.seoPages.length - a.seoPages.length)[0]!;

  it("spans platforms instead of returning one platform's pages", () => {
    /*
     * The regression this locks down: the SEO corpus is grouped by platform, so
     * `.slice(0, 12)` returned twelve TikTok pages under a heading promising the
     * subject "specific to where your media came from". Every link was correct
     * and the set was useless — only visible on the rendered page.
     */
    const sample = seoPagesAcrossPlatforms(biggest, 12);
    const platforms = new Set(sample.map((p) => p.platformId));
    expect(sample.length).toBe(12);
    expect(
      platforms.size,
      `sample covers only ${[...platforms].join(", ")}`,
    ).toBeGreaterThan(1);
  });

  it("takes one from each platform before taking a second from any", () => {
    const available = new Set(biggest.seoPages.map((p) => p.platformId)).size;
    const sample = seoPagesAcrossPlatforms(biggest, available);
    expect(new Set(sample.map((p) => p.platformId)).size).toBe(available);
  });

  it("returns everything it has when the cluster is smaller than the limit", () => {
    const small = allClusters().find((c) => c.seoPages.length > 0 && c.seoPages.length < 50)!;
    const sample = seoPagesAcrossPlatforms(small, 9999);
    expect(sample.length).toBe(small.seoPages.length);
    // No duplicates — the round-robin must not revisit a page it already took.
    expect(new Set(sample.map((p) => p.slug)).size).toBe(sample.length);
  });

  it("terminates on an empty cluster", () => {
    const empty = { ...biggest, seoPages: [] };
    expect(seoPagesAcrossPlatforms(empty, 12)).toEqual([]);
  });
});

describe("Topics — back-links can never 404", () => {
  it("only returns a pillar for lessons whose cluster is published", () => {
    /*
     * The invariant that keeps `/learn/[slug]` honest. `pillarForLesson` and
     * `generateStaticParams` must agree exactly, or lessons in a held-back
     * cluster render a link to a page that was never generated.
     */
    const published = new Set(publishableClusters().map((c) => c.topic.slug));
    for (const lesson of LESSON_CATALOG) {
      const pillar = pillarForLesson(lesson.slug);
      if (pillar) {
        expect(published.has(pillar.slug), `${lesson.slug} links to unpublished ${pillar.slug}`).toBe(
          true,
        );
      } else {
        const topic = getTopic(lesson.topic);
        expect(
          topic ? published.has(topic.slug) : false,
          `${lesson.slug} has no pillar link but its cluster IS published`,
        ).toBe(false);
      }
    }
  });

  it("returns nothing for a lesson that does not exist", () => {
    expect(pillarForLesson("no-such-lesson")).toBeUndefined();
  });

  it("derives hrefs from one place", () => {
    for (const topic of TOPICS) {
      expect(topicHref(topic)).toBe(`/topics/${topic.slug}`);
    }
  });
});
