import type { LessonTopic } from "./types";

import type { PlatformId } from "@/types";

/**
 * Learning Academy™ metadata — titles, topics, reading times and the links into
 * the Discovery Gateway. Deliberately SEPARATE from the lesson bodies in
 * `lessons.ts`.
 *
 * The reason is bundle size. Most consumers only need a title and a slug: the
 * downloads rail lists three guides, the Gateway attaches one to a completed
 * download. Importing the prose for that pulled every word of every lesson into
 * those bundles — 10 kB on `/downloads` alone, for text nobody was going to read
 * there. Only `/learn/[slug]` needs a body, and that page is static.
 *
 * Adding a lesson means an entry here AND a body in `lessons.ts`; the pairing is
 * checked by `learning.test.ts`, so a mismatch fails the build rather than
 * rendering an empty page.
 */
export interface LessonMeta {
  slug: string;
  title: string;
  description: string;
  topic: LessonTopic;
  minutes: number;
  platformIds: PlatformId[];
  /** Discovery Gateway action ids this lesson supports. */
  relatedActionIds: string[];
  /** Other lesson slugs — the internal-linking graph. */
  related: string[];
}

export const LESSON_CATALOG: LessonMeta[] = [
  {
    slug: "how-to-save-a-video",
    title: "How to save a video from a link",
    description:
      "Paste a link, pick a format, save the file. The whole workflow, plus what to do when a link will not resolve.",
    topic: "downloading",
    minutes: 4,
    platformIds: [],
    relatedActionIds: [],
    related: ["what-you-can-and-cannot-download", "how-to-improve-video-quality"],
  },
  {
    slug: "what-you-can-and-cannot-download",
    title: "What you can and cannot download",
    description:
      "Copyright, fair use and platform terms in plain language — what saving a video actually permits you to do with it.",
    topic: "downloading",
    minutes: 5,
    platformIds: [],
    relatedActionIds: ["publish-post", "publish-reel"],
    related: ["how-to-save-a-video", "how-to-build-a-creator-workflow"],
  },
  {
    slug: "how-to-edit-a-clip",
    title: "How to edit a clip without ruining it",
    description:
      "Trimming, cropping and re-encoding explained — including the generation-loss trap that quietly degrades re-shared video.",
    topic: "editing",
    minutes: 6,
    platformIds: [],
    relatedActionIds: ["edit-video", "make-thumbnail"],
    related: ["how-to-improve-video-quality", "how-to-make-a-thumbnail"],
  },
  {
    slug: "how-to-add-subtitles",
    title: "How to add subtitles that people actually read",
    description:
      "Burned-in versus sidecar captions, timing, line length, and why most video is watched with the sound off.",
    topic: "captions",
    minutes: 5,
    platformIds: [],
    relatedActionIds: ["generate-subtitles", "translate-subtitles"],
    related: ["how-to-edit-a-clip", "how-to-build-a-creator-workflow"],
  },
  {
    slug: "how-to-improve-video-quality",
    title: "How to improve video quality (and what is impossible)",
    description:
      "What upscaling can and cannot recover, choosing the right rendition, and the settings that actually affect how sharp an upload looks.",
    topic: "quality",
    minutes: 5,
    platformIds: [],
    relatedActionIds: ["enhance-quality"],
    related: ["how-to-edit-a-clip", "how-to-save-a-video"],
  },
  {
    slug: "how-to-organise-your-media",
    title: "How to organise media you have saved",
    description:
      "A naming and folder system that still works when the library is large, and why sorting by date fails first.",
    topic: "organising",
    minutes: 4,
    platformIds: [],
    relatedActionIds: ["save-to-cloud", "organize-project"],
    related: ["how-to-build-a-creator-workflow", "how-to-save-a-video"],
  },
  {
    slug: "how-to-make-a-thumbnail",
    title: "How to make a thumbnail worth clicking",
    description:
      "Composition, contrast and text at small sizes — designing for the size the thumbnail is actually viewed at.",
    topic: "editing",
    minutes: 4,
    platformIds: [],
    relatedActionIds: ["make-thumbnail"],
    related: ["how-to-edit-a-clip", "how-to-build-a-creator-workflow"],
  },
  {
    slug: "how-to-build-a-creator-workflow",
    title: "How to build a creator workflow that survives contact with reality",
    description:
      "Turning ad-hoc saving and posting into a repeatable pipeline — capture, organise, edit, caption, publish, review.",
    topic: "publishing",
    minutes: 6,
    platformIds: [],
    relatedActionIds: ["organize-project", "publish-reel", "publish-post"],
    related: [
      "what-you-can-and-cannot-download",
      "how-to-organise-your-media",
      "how-to-add-subtitles",
    ],
  },

  /* ----------------------------- Community School ---------------------------- */
  {
    slug: "how-feeds-and-friends-work",
    title: "How feeds and friends work",
    description:
      "Who sees what you post, how the feed decides its order, and the difference between a friend, a follower and a stranger.",
    topic: "community",
    minutes: 5,
    platformIds: [],
    relatedActionIds: ["publish-post", "publish-reel"],
    related: ["who-can-see-your-profile", "how-to-share-without-oversharing"],
  },
  {
    slug: "how-to-share-without-oversharing",
    title: "How to share without oversharing",
    description:
      "Stories, reshares and chat each have a different reach. Knowing which is which is most of what keeps sharing comfortable.",
    topic: "community",
    minutes: 5,
    platformIds: [],
    relatedActionIds: ["send-to-chat", "publish-story"],
    related: ["how-feeds-and-friends-work", "who-can-see-your-profile"],
  },

  /* ------------------------ Security & Privacy School ------------------------ */
  {
    slug: "who-can-see-your-profile",
    title: "Who can see your profile",
    description:
      "What is public by default, what a hidden account actually changes, and how to check your own visibility rather than assume it.",
    topic: "privacy",
    minutes: 5,
    platformIds: [],
    relatedActionIds: [],
    related: ["blocking-restricting-and-reporting", "how-feeds-and-friends-work"],
  },
  {
    slug: "blocking-restricting-and-reporting",
    title: "Blocking, restricting and reporting",
    description:
      "Three different tools for three different problems — what each one does, what the other person can tell, and when to use which.",
    topic: "privacy",
    minutes: 5,
    platformIds: [],
    relatedActionIds: [],
    related: ["who-can-see-your-profile", "how-to-share-without-oversharing"],
  },

  /* ----------------------------- Developer School ---------------------------- */
  {
    slug: "getting-started-with-the-api",
    title: "Getting started with the Frenzsave API",
    description:
      "Authenticating, analyzing a link and requesting a download — the three endpoints that cover almost every integration.",
    topic: "developer",
    minutes: 6,
    platformIds: [],
    relatedActionIds: [],
    related: ["handling-rate-limits-and-failures", "how-to-save-a-video"],
  },
  {
    slug: "handling-rate-limits-and-failures",
    title: "Handling rate limits and failures",
    description:
      "Quotas, backoff, and the failure modes that are permanent versus the ones worth retrying — how to build an integration that degrades gracefully.",
    topic: "developer",
    minutes: 6,
    platformIds: [],
    relatedActionIds: [],
    related: ["getting-started-with-the-api", "what-you-can-and-cannot-download"],
  },
];

/**
 * Guides surfaced in the Download Hub's panels — the three that match what
 * someone standing in their own library is most likely about to do.
 *
 * Lives here rather than in the component because `HubWarmup` prefetches these
 * routes and must not drift from what the panel actually links to.
 */
export const RAIL_LESSON_SLUGS = [
  "how-to-build-a-creator-workflow",
  "what-you-can-and-cannot-download",
  "how-to-improve-video-quality",
] as const;

const BY_SLUG = new Map(LESSON_CATALOG.map((l) => [l.slug, l]));

export const LESSON_SLUGS: string[] = LESSON_CATALOG.map((l) => l.slug);

export function getLessonMeta(slug: string): LessonMeta | undefined {
  return BY_SLUG.get(slug);
}

export function lessonsForTopic(topic: LessonTopic): LessonMeta[] {
  return LESSON_CATALOG.filter((l) => l.topic === topic);
}

/**
 * The lesson that best supports a given Gateway action — how the Discovery
 * Gateway attaches contextual education to a completed download.
 */
export function lessonForAction(actionId: string): LessonMeta | undefined {
  return LESSON_CATALOG.find((l) => l.relatedActionIds.includes(actionId));
}

export function relatedLessons(slug: string): LessonMeta[] {
  const lesson = BY_SLUG.get(slug);
  if (!lesson) return [];
  return lesson.related.map((s) => BY_SLUG.get(s)).filter((l): l is LessonMeta => Boolean(l));
}
