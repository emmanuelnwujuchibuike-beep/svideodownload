import { LESSON_CATALOG, type LessonMeta } from "@/lib/learning/catalog";
import type { LessonTopic } from "@/lib/learning/types";
import { ALL_PAGES, type SeoPage } from "@/lib/seo/seo-pages";
import { SUPPORT_ARTICLES, articleHref } from "@/lib/support/articles";
import { GLOSSARY } from "@/lib/support/glossary";
import type { GlossaryTerm, SupportArticle } from "@/lib/support/types";

/**
 * Topic clusters — the SUBJECT axis over the whole corpus.
 *
 * ── What was already here, and what was missing ───────────────────────────────
 *
 * `config/seoPages.ts` already clusters by PLATFORM: TikTok × modifiers,
 * Instagram × modifiers, ~148 pages. `lib/content/graph` already has `topic`
 * nodes — also one per platform. Both are the same axis, and it is the axis a
 * visitor is NOT usually on: someone searching "why does my video look worse
 * after uploading" has no platform in mind at all.
 *
 * The missing axis is the subject. Lessons, help articles, glossary terms and
 * keyword pages all discuss the same handful of subjects and none of them knew
 * it, so the corpus was ~200 pages deep on platforms and structurally silent on
 * what it is actually about. That is the difference between a site that is
 * indexed and one that is understood.
 *
 * ── ONE taxonomy, not a second one ────────────────────────────────────────────
 *
 * `LessonTopic` already enumerates the subjects, it is already load-bearing on
 * every lesson, and it is already rendered. Declaring a parallel `TopicId` here
 * would create two lists that mean the same thing and drift within a month —
 * the failure `resolveAvailability` was extracted to fix. So `Topic.id` IS a
 * `LessonTopic`, and `topics.test.ts` pins that every value has exactly one
 * topic record.
 *
 * ── Membership is DERIVED, and the derivation is not the same everywhere ──────
 *
 * Lessons carry `topic` explicitly, so for them membership is a lookup and is
 * authoritative. Nothing else in the corpus has a subject field, and adding one
 * to four more content types would mean four editorial lists to keep in sync.
 *
 * So the other corpora are matched on VOCABULARY — the `terms` below — exactly
 * as `graph/build.ts` already matches SEO pages to capabilities. This is honest
 * about what it is: a heuristic. It is therefore constrained in two ways. Terms
 * are specific enough to be about the subject rather than about video in general
 * ("bitrate", not "video"), and the pillar gate below requires a human-authored
 * lesson before a cluster may become a page, so no pillar can be built purely
 * out of keyword matches.
 */

export interface Topic {
  /** A `LessonTopic`. Deliberately the same axis, never a parallel one. */
  id: LessonTopic;
  slug: string;
  /** Pillar page H1. */
  title: string;
  /** Meta description and card subtitle. Under ~158 chars. */
  description: string;
  /**
   * What someone is actually trying to do when they land here — written from
   * the reader's situation, not from our feature list. This is the line the
   * pillar page opens with, and getting it from search intent rather than
   * product capability is the whole reason these pages can be honest about
   * things we do not ship.
   */
  intent: string;
  /**
   * Vocabulary used to derive membership for corpora with no subject field.
   *
   * Specific over general, on purpose. "video" would match the entire corpus
   * and produce a cluster that means nothing; "generation loss" matches the
   * pages genuinely about it.
   */
  terms: string[];
  order: number;
}

export const TOPICS: Topic[] = [
  {
    id: "downloading",
    slug: "saving-video",
    title: "Saving video from the web",
    description:
      "How saving a video actually works, why some links will never resolve, and what having a copy does and does not permit you to do with it.",
    intent:
      "You have a link and you want the file — and, sooner or later, you want to know where the limits are.",
    terms: [
      "download",
      "downloader",
      "save video",
      "share link",
      "extract",
      "rendition",
      "private content",
      "copyright",
      "fair use",
      "watermark",
    ],
    order: 1,
  },
  {
    id: "quality",
    slug: "video-quality",
    title: "Video quality, and what cannot be recovered",
    description:
      "Resolution against bitrate, what upscaling really does, and the quality decisions that are made once and cannot be undone afterwards.",
    intent:
      "Something looks worse than you expected and you want to know whether it can be fixed or whether it was lost at capture.",
    terms: [
      "quality",
      "resolution",
      "bitrate",
      "upscale",
      "upscaling",
      "hd",
      "4k",
      "1080p",
      "compression",
      "frame rate",
      "sharpness",
    ],
    order: 2,
  },
  {
    id: "editing",
    slug: "editing-video",
    title: "Editing without destroying the footage",
    description:
      "Trimming, cropping, aspect ratio and thumbnails — and generation loss, the mechanic behind most quality people lose without noticing.",
    intent:
      "You want to cut something down or reframe it, and you would rather not degrade it in the process.",
    terms: [
      "edit",
      "trim",
      "crop",
      "aspect ratio",
      "re-encode",
      "generation loss",
      "thumbnail",
      "export",
      "stream copy",
      "keyframe",
    ],
    order: 3,
  },
  {
    id: "captions",
    slug: "captions-and-subtitles",
    title: "Captions and subtitles",
    description:
      "Burned-in against sidecar captions, timing and line length, and why most social video is watched with the sound off.",
    intent:
      "You want the words on screen, and you want them readable rather than technically present.",
    terms: [
      "caption",
      "captions",
      "subtitle",
      "subtitles",
      "srt",
      "vtt",
      "transcribe",
      "transcription",
      "translate captions",
      "burned-in",
      "sidecar",
    ],
    order: 4,
  },
  {
    id: "organising",
    slug: "organising-media",
    title: "Organising a media library",
    description:
      "Naming and folder systems that still work at scale, why sorting by date fails first, and what actually counts as a backup.",
    intent:
      "Finding something in your own library has started taking longer than fetching it again.",
    terms: [
      "organise",
      "organize",
      "library",
      "filename",
      "folder",
      "naming",
      "backup",
      "archive",
      "storage",
      "sort",
    ],
    order: 5,
  },
  {
    id: "publishing",
    slug: "publishing-workflow",
    title: "Publishing on a repeatable schedule",
    description:
      "The capture → organise → edit → caption → publish → review loop, batching, and why reviewing retention beats reviewing likes.",
    intent:
      "You can publish once. You want to be able to publish next week too, on a day when you do not feel like it.",
    terms: [
      "workflow",
      "pipeline",
      "publish",
      "publishing",
      "schedule",
      "batching",
      "consistency",
      "retention",
      "creator workflow",
    ],
    order: 6,
  },
  {
    id: "community",
    slug: "audience-and-sharing",
    title: "Audience, feeds and sharing",
    description:
      "Who actually sees what you post, how a ranked feed differs from a chronological one, and the real reach of each sharing surface.",
    intent:
      "You are about to post something and you want to know who will end up seeing it.",
    terms: [
      "feed",
      "friends",
      "followers",
      "audience",
      "reach",
      "share",
      "reshare",
      "story",
      "stories",
      "ranking",
    ],
    order: 7,
  },
  {
    id: "privacy",
    slug: "privacy-and-safety",
    title: "Privacy, visibility and safety",
    description:
      "What is public by default, what hiding an account changes, and how blocking, restricting and reporting differ in what they actually do.",
    intent:
      "You want to know what strangers can see, or you want a specific person to stop reaching you.",
    terms: [
      "privacy",
      "private",
      "hidden account",
      "visibility",
      "block",
      "blocking",
      "restrict",
      "report",
      "reporting",
      "safety",
      "who can see",
    ],
    order: 8,
  },
  {
    id: "developer",
    slug: "building-on-the-api",
    title: "Building on the API",
    description:
      "Authentication, the three endpoints, quotas and backoff — and telling permanent failures apart from the ones worth retrying.",
    intent:
      "You are integrating this into something of your own and you want it to survive production.",
    terms: [
      "api",
      "endpoint",
      "authentication",
      "bearer",
      "api key",
      "rate limit",
      "quota",
      "backoff",
      "retry",
      "integration",
      "sdk",
    ],
    order: 9,
  },
];

/* --------------------------------- matching ---------------------------------- */

const BY_ID = new Map(TOPICS.map((t) => [t.id, t]));
const BY_SLUG = new Map(TOPICS.map((t) => [t.slug, t]));

export const TOPIC_SLUGS: string[] = TOPICS.map((t) => t.slug);

export function getTopic(id: LessonTopic): Topic | undefined {
  return BY_ID.get(id);
}

export function getTopicBySlug(slug: string): Topic | undefined {
  return BY_SLUG.get(slug);
}

/**
 * Whether a haystack of text is about a topic.
 *
 * Word-boundary matching, not `includes`. `"deleting".includes("delete")` being
 * false already cost this codebase a debugging session on the search index; the
 * mirror-image bug bites here — a bare substring test makes the term "api" match
 * "capability", "rapid" and "apart", which would quietly pull unrelated pages
 * into the developer cluster and make it look healthy while being wrong.
 */
function matches(haystack: string, terms: string[]): boolean {
  const text = haystack.toLowerCase();
  return terms.some((term) => {
    const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}s?\\b`).test(text);
  });
}

/* --------------------------------- clusters ---------------------------------- */

export interface TopicCluster {
  topic: Topic;
  /** Authoritative — lessons declare their topic. */
  lessons: LessonMeta[];
  articles: SupportArticle[];
  glossary: GlossaryTerm[];
  seoPages: SeoPage[];
  /** Everything, for the gate and for admin. */
  size: number;
}

export function clusterFor(topic: Topic): TopicCluster {
  const lessons = LESSON_CATALOG.filter((l) => l.topic === topic.id);

  const articles = SUPPORT_ARTICLES.filter((a) =>
    matches(`${a.title} ${a.description}`, topic.terms),
  );

  const glossary = GLOSSARY.filter((term) =>
    matches(`${term.term} ${term.definition} ${term.aliases.join(" ")}`, topic.terms),
  );

  const seoPages = ALL_PAGES.filter((page) =>
    matches(`${page.slug} ${page.primaryKeyword} ${page.secondaryKeywords.join(" ")}`, topic.terms),
  );

  return {
    topic,
    lessons,
    articles,
    glossary,
    seoPages,
    size: lessons.length + articles.length + glossary.length + seoPages.length,
  };
}

export function allClusters(): TopicCluster[] {
  return [...TOPICS].sort((a, b) => a.order - b.order).map(clusterFor);
}

/* ----------------------------------- gate ------------------------------------ */

/**
 * A pillar needs a human-authored anchor. Keyword matches alone can assemble a
 * page that links to twelve places and says nothing, which is precisely the thin
 * content this whole effort is supposed to be the opposite of.
 */
export const PILLAR_MIN_LESSONS = 1;

/**
 * …and enough destinations to be a hub rather than a redirect with extra steps.
 *
 * The same stance as planned schools getting no page at all: a real URL in the
 * sitemap with nothing on it costs topical authority rather than building it.
 */
export const PILLAR_MIN_MEMBERS = 5;

export function isPublishable(cluster: TopicCluster): boolean {
  return cluster.lessons.length >= PILLAR_MIN_LESSONS && cluster.size >= PILLAR_MIN_MEMBERS;
}

/** Clusters that earn a pillar page. `generateStaticParams` and the sitemap read this. */
export function publishableClusters(): TopicCluster[] {
  return allClusters().filter(isPublishable);
}

export function publishableTopicSlugs(): string[] {
  return publishableClusters().map((c) => c.topic.slug);
}

/**
 * The pillar a given lesson belongs to, for the back-link on `/learn/[slug]`.
 *
 * Returns nothing when the lesson's cluster did not earn a page — a back-link to
 * a 404 is worse than no back-link, and it is invisible until someone clicks it.
 */
export function pillarForLesson(slug: string): Topic | undefined {
  const lesson = LESSON_CATALOG.find((l) => l.slug === slug);
  if (!lesson) return undefined;
  const topic = BY_ID.get(lesson.topic);
  if (!topic) return undefined;
  return isPublishable(clusterFor(topic)) ? topic : undefined;
}

/** Canonical URL path for a pillar. One place, so nothing can disagree about it. */
export function topicHref(topic: Topic): string {
  return `/topics/${topic.slug}`;
}

/**
 * A sample of a cluster's keyword pages that actually spans platforms.
 *
 * Taking the first N in corpus order produced a "By platform" section on the
 * `saving-video` pillar that was twelve TikTok pages and nothing else — the
 * corpus is grouped by platform, so a slice never leaves the first one. The
 * heading promised the subject "specific to where your media came from" and
 * then offered one place it could have come from.
 *
 * Round-robin instead: one page per platform, then a second from each, until
 * the limit. A reader arriving from any platform sees their own listed, which
 * is the entire purpose of the section.
 *
 * Only visible by looking at the rendered page — every individual link was
 * correct and the set was useless.
 */
export function seoPagesAcrossPlatforms(cluster: TopicCluster, limit: number): SeoPage[] {
  const byPlatform = new Map<string, SeoPage[]>();
  for (const page of cluster.seoPages) {
    const list = byPlatform.get(page.platformId) ?? [];
    list.push(page);
    byPlatform.set(page.platformId, list);
  }

  const out: SeoPage[] = [];
  const groups = [...byPlatform.values()];
  for (let round = 0; out.length < limit; round++) {
    let addedThisRound = false;
    for (const pages of groups) {
      if (out.length >= limit) break;
      const page = pages[round];
      if (page) {
        out.push(page);
        addedThisRound = true;
      }
    }
    // Every group exhausted — the cluster simply has fewer pages than the limit.
    if (!addedThisRound) break;
  }
  return out;
}

/** Cluster members as flat links — what the pillar page and admin both render. */
export function clusterLinks(cluster: TopicCluster) {
  return {
    lessons: cluster.lessons.map((l) => ({
      href: `/learn/${l.slug}`,
      title: l.title,
      description: l.description,
      minutes: l.minutes,
    })),
    articles: cluster.articles.map((a) => ({
      href: articleHref(a),
      title: a.title,
      description: a.description,
    })),
    glossary: cluster.glossary.map((t) => ({
      href: `/glossary#${t.slug}`,
      title: t.term,
      description: t.definition,
    })),
    seoPages: cluster.seoPages.map((p) => ({
      href: `/${p.slug}`,
      title: p.h1,
      description: p.tagline,
    })),
  };
}
