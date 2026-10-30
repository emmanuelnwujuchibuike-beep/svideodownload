/**
 * When each /learn guide was published and last changed — Article JSON-LD's `datePublished` / `dateModified` and
 * the dates shown under the title.
 *
 * MEASURED, not chosen (2026-10-29): `published` is the first commit that added the lesson body to
 * lib/learning/lessons.ts; `updated` is the newest author date among that body's lines in `git blame`. Change
 * `updated` when you materially edit a lesson — never to make a page look fresh (the truth rule: a real date or none).
 * `lib/seo/article-ld.test.ts` fails if a lesson is missing here.
 */
export const LESSON_DATES: Readonly<Record<string, { published: string; updated: string }>> = {
  "how-to-save-a-video": { published: "2026-07-18", updated: "2026-07-18" },
  "what-you-can-and-cannot-download": { published: "2026-07-18", updated: "2026-07-18" },
  "how-to-edit-a-clip": { published: "2026-07-18", updated: "2026-07-18" },
  "how-to-add-subtitles": { published: "2026-07-18", updated: "2026-07-18" },
  "how-to-improve-video-quality": { published: "2026-07-18", updated: "2026-07-18" },
  "how-to-organise-your-media": { published: "2026-07-18", updated: "2026-07-18" },
  "how-to-make-a-thumbnail": { published: "2026-07-18", updated: "2026-07-18" },
  "how-to-build-a-creator-workflow": { published: "2026-07-18", updated: "2026-07-19" },
  "how-feeds-and-friends-work": { published: "2026-07-19", updated: "2026-07-19" },
  "how-to-share-without-oversharing": { published: "2026-07-19", updated: "2026-07-19" },
  "who-can-see-your-profile": { published: "2026-07-19", updated: "2026-07-19" },
  "blocking-restricting-and-reporting": { published: "2026-07-19", updated: "2026-07-19" },
  "getting-started-with-the-api": { published: "2026-07-19", updated: "2026-07-19" },
  "handling-rate-limits-and-failures": { published: "2026-07-19", updated: "2026-07-19" },
};

export function lessonDates(slug: string): { published: string; updated: string } | undefined {
  return LESSON_DATES[slug];
}
