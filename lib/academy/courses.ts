import { LESSON_CATALOG, getLessonMeta } from "@/lib/learning/catalog";

import { SCHOOLS, getSchool, isTeachable } from "./schools";
import type { Course, SchoolId } from "./types";

/**
 * Curriculum Service — courses group lessons into a teaching order.
 *
 * ── No lesson data lives here ─────────────────────────────────────────────────
 *
 * `lib/learning/catalog.ts` remains the single source of truth for lesson
 * metadata, and `lib/learning/lessons.ts` for bodies. A course references lessons
 * BY SLUG and owns nothing about them — no titles, no durations, no descriptions.
 *
 * That is deliberate and it is the whole reason this file is short. Copying lesson
 * metadata into a course record would mean two places to update a title, and the
 * failure mode is silent: the campus would show one title, `/learn/[slug]` another,
 * and the sitemap a third. `coursesAreCoherent` in academy.test.ts pins the
 * reference direction.
 *
 * It also preserves the existing surfaces. `/learn`, `/learn/[slug]` and the
 * Download Hub rail keep reading `lib/learning` exactly as before — the Academy is
 * a new view over that corpus, not a migration of it.
 *
 * ── Metadata only ─────────────────────────────────────────────────────────────
 *
 * Like `schools.ts`, this module must never import lesson PROSE. It is read by the
 * campus index, school pages, search and nav; pulling bodies in would repeat the
 * 10 kB mistake `lib/learning` was split to fix.
 */
export const COURSES: Course[] = [
  /* ------------------------------ Creator School ----------------------------- */
  {
    slug: "saving-media-responsibly",
    schoolId: "creator",
    title: "Saving media responsibly",
    description:
      "The download workflow end to end, and the legal and ethical boundaries around what you may do with what you save.",
    level: "intro",
    lessonSlugs: ["how-to-save-a-video", "what-you-can-and-cannot-download"],
    outcomes: [
      "Save a video, photo or audio track from any supported platform",
      "Diagnose a link that will not resolve, and know which failures are permanent",
      "Explain what copyright and platform terms permit you to do with a saved file",
    ],
    order: 1,
  },
  {
    slug: "creator-workflow",
    schoolId: "creator",
    title: "Building a creator workflow",
    description:
      "Turning ad-hoc saving and posting into a repeatable pipeline that still works when your library is large.",
    level: "core",
    lessonSlugs: ["how-to-organise-your-media", "how-to-build-a-creator-workflow"],
    outcomes: [
      "Name and organise files so the system survives a large library",
      "Run a repeatable capture → organise → edit → caption → publish loop",
      "Identify which step in your pipeline is actually costing you time",
    ],
    order: 2,
  },

  /* ------------------------------ Editing School ----------------------------- */
  {
    slug: "editing-without-loss",
    schoolId: "editing",
    title: "Editing without losing quality",
    description:
      "What re-encoding actually costs, what upscaling can and cannot recover, and how to make edits that do not degrade the source.",
    level: "core",
    lessonSlugs: ["how-to-edit-a-clip", "how-to-improve-video-quality"],
    outcomes: [
      "Trim and crop without triggering avoidable generation loss",
      "Choose a rendition that matches where the video will be watched",
      "Recognise the quality problems no tool can fix after the fact",
    ],
    order: 1,
  },
  {
    slug: "captions-and-thumbnails",
    schoolId: "editing",
    title: "Captions and thumbnails",
    description:
      "The two things that decide whether a video gets watched at all — readable captions and a thumbnail that works at the size people actually see it.",
    level: "core",
    lessonSlugs: ["how-to-add-subtitles", "how-to-make-a-thumbnail"],
    outcomes: [
      "Choose between burned-in and sidecar captions for a given destination",
      "Time and break caption lines so they can be read at speed",
      "Design a thumbnail that survives being shown at thumbnail size",
    ],
    order: 2,
  },

  /* ----------------------------- Community School ---------------------------- */
  {
    slug: "sharing-and-audience",
    schoolId: "community",
    title: "Sharing and audience",
    description:
      "Who actually sees what you post, how the feed decides its order, and how the sharing surfaces differ in reach.",
    level: "intro",
    lessonSlugs: ["how-feeds-and-friends-work", "how-to-share-without-oversharing"],
    outcomes: [
      "Explain the difference between a friend, a follower and the public",
      "Predict the real audience of a post, story, reshare or chat message",
      "Check what a stranger sees rather than assuming it from settings",
    ],
    order: 1,
  },

  /* ------------------------ Security & Privacy School ------------------------ */
  {
    slug: "privacy-and-safety-controls",
    schoolId: "security",
    title: "Privacy and safety controls",
    description:
      "What is public by default, what hiding an account changes, and which of blocking, restricting and reporting fits a given problem.",
    level: "intro",
    lessonSlugs: ["who-can-see-your-profile", "blocking-restricting-and-reporting"],
    outcomes: [
      "Verify your own profile visibility from outside your account",
      "Describe what a hidden account changes, and how it differs from suspension",
      "Choose correctly between blocking, restricting and reporting",
    ],
    order: 1,
  },

  /* ----------------------------- Developer School ---------------------------- */
  {
    slug: "building-on-the-api",
    schoolId: "developer",
    title: "Building on the Frenzsave API",
    description:
      "Authentication, the three endpoints, and the error handling that separates an integration that survives production from one that does not.",
    level: "core",
    lessonSlugs: ["getting-started-with-the-api", "handling-rate-limits-and-failures"],
    outcomes: [
      "Authenticate correctly and keep the API key off the client",
      "Use analyze, download and usage for their intended purposes",
      "Back off on rate limits and stop retrying permanent failures",
    ],
    order: 1,
  },
];

/* ----------------------------------- reads ----------------------------------- */

const BY_SLUG = new Map(COURSES.map((c) => [c.slug, c]));

export const COURSE_SLUGS: string[] = COURSES.map((c) => c.slug);

export function getCourse(slug: string): Course | undefined {
  return BY_SLUG.get(slug);
}

/** Courses belonging to a school, in teaching order. */
export function coursesForSchool(schoolId: SchoolId): Course[] {
  return COURSES.filter((c) => c.schoolId === schoolId).sort((a, b) => a.order - b.order);
}

/**
 * Lesson metadata for a course, resolved from the learning catalogue.
 *
 * Returns metadata objects, never bodies — so a school page can list a course's
 * lessons with titles and reading times without pulling any prose into its bundle.
 * Unknown slugs are dropped rather than throwing; `academy.test.ts` asserts there
 * are none, so a drop in production would mean the test was deleted.
 */
export function courseLessons(slug: string) {
  const course = BY_SLUG.get(slug);
  if (!course) return [];
  return course.lessonSlugs.map((s) => getLessonMeta(s)).filter((l) => Boolean(l));
}

/** Total reading time for a course, derived from its lessons. */
export function courseMinutes(slug: string): number {
  return courseLessons(slug).reduce((total, lesson) => total + (lesson?.minutes ?? 0), 0);
}

/**
 * Courses whose school may teach. The campus, sitemap and search index read this
 * rather than `COURSES`, so a course can never outlive its school's claimability.
 */
export function teachableCourses(): Course[] {
  return COURSES.filter((c) => {
    const school = getSchool(c.schoolId);
    return school ? isTeachable(school) : false;
  });
}

/**
 * Whether a school has a curriculum a learner can actually start today.
 *
 * THREE states, not two, because "teachable" and "populated" are different facts:
 *
 *  - `planned`     — the product does not exist. Nothing may be written.
 *  - `in-progress` — the school is teachable, but no course is written yet.
 *  - `ready`       — teachable and populated.
 *
 * The middle state is the one that needed naming. Community, Security & Privacy
 * and Developer School all teach real things, so the truth gate correctly allows
 * lessons — but allowing a lesson is not the same as having written one. Without
 * this distinction the campus would present three schools as available and then
 * show a learner an empty room, which is a smaller lie than claiming an unbuilt
 * product but a lie all the same.
 *
 * Derived from the curriculum, never declared, so it self-corrects the moment a
 * course is added — no flag to remember to flip.
 */
export type CurriculumState = "planned" | "in-progress" | "ready";

export function schoolCurriculumState(schoolId: SchoolId): CurriculumState {
  const school = getSchool(schoolId);
  if (!school || !isTeachable(school)) return "planned";
  return coursesForSchool(schoolId).length > 0 ? "ready" : "in-progress";
}

/** Schools a learner can start today. The campus leads with these. */
export function readySchools(): SchoolId[] {
  return SCHOOLS.filter((s) => schoolCurriculumState(s.id) === "ready").map((s) => s.id);
}

/**
 * Lessons in the catalogue that no course teaches yet.
 *
 * Not an error — the corpus grows faster than curricula, and an orphan lesson is
 * still reachable at `/learn/[slug]`. This is the editorial backlog, surfaced in
 * admin rather than left for someone to notice.
 */
export function uncurriculedLessons() {
  const claimed = new Set(COURSES.flatMap((c) => c.lessonSlugs));
  return LESSON_CATALOG.filter((l) => !claimed.has(l.slug));
}
