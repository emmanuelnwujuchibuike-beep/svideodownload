import { COURSES, courseLessons, teachableCourses } from "@/lib/academy/courses";
import { getSchool } from "@/lib/academy/schools";
import { LESSON_CATALOG, getLessonMeta } from "@/lib/learning/catalog";

/**
 * "What should I read next" — derived, never stored.
 *
 * ── Why this is not the `related` graph ───────────────────────────────────────
 *
 * Every lesson and article already carries `related`, and that stays the right
 * mechanism for "more like this one". It answers a question about CONTENT.
 * This answers a question about a READER: given what they have finished, what
 * is the single most useful next thing? Those diverge immediately — the best
 * follow-up to a lesson you just finished is usually the next lesson in its
 * course, which is frequently not in its `related` list at all.
 *
 * ── Ranking is a legible function, not a model ────────────────────────────────
 *
 * Same stance as the feed's `rankForYou`: this is ordering rules a person can
 * read and argue with, not a black box. There is no behavioural data here worth
 * training on and pretending otherwise would be the fabrication the rest of this
 * codebase spends its effort avoiding.
 *
 * The order below is the whole design:
 *
 *  1. FINISH WHAT YOU STARTED. A course with some lessons done and some not is
 *     the strongest signal in the system — the reader has already chosen the
 *     subject. Recommending anything else first is answering a question they
 *     did not ask.
 *  2. The natural next course in a school they are already studying, so a
 *     finished course leads somewhere instead of dead-ending.
 *  3. An intro course from a school they have not touched, for breadth.
 *  4. For a reader with no history at all, the intro courses in school order —
 *     which is exactly what the campus page already shows, so a new visitor
 *     sees consistency rather than a second, contradictory ranking.
 *
 * ── Availability is inherited ─────────────────────────────────────────────────
 *
 * Candidates come from `teachableCourses()`, so a course whose school is not
 * claimable can never be recommended. This module makes no judgement of its own
 * about what is real — a second opinion here could disagree with the first.
 */

export type RecommendationReason =
  | "continue-course"
  | "next-in-school"
  | "new-school"
  | "start-here";

export interface Recommendation {
  lessonSlug: string;
  title: string;
  href: string;
  minutes: number;
  /** The course this lesson belongs to, when it belongs to one. */
  courseSlug: string | null;
  courseTitle: string | null;
  reason: RecommendationReason;
  /** One line explaining the pick, shown to the reader. */
  explanation: string;
}

/** Lessons of a course that the reader has not completed, in teaching order. */
function unfinished(courseSlug: string, completed: Set<string>) {
  return courseLessons(courseSlug).filter((lesson) => lesson && !completed.has(lesson.slug));
}

function toRecommendation(
  lessonSlug: string,
  courseSlug: string | null,
  reason: RecommendationReason,
  explanation: string,
): Recommendation | null {
  const lesson = getLessonMeta(lessonSlug);
  if (!lesson) return null;

  const course = courseSlug ? COURSES.find((c) => c.slug === courseSlug) ?? null : null;

  return {
    lessonSlug: lesson.slug,
    title: lesson.title,
    href: `/learn/${lesson.slug}`,
    minutes: lesson.minutes,
    courseSlug: course?.slug ?? null,
    courseTitle: course?.title ?? null,
    reason,
    explanation,
  };
}

/**
 * Up to `limit` recommendations for a reader with these completed lesson slugs.
 *
 * Pure and synchronous: it takes the completed set as an argument rather than
 * reading the personal plane itself, so it runs identically on the client (where
 * that data lives, behind `no-store`) and in a test, and so nothing personal has
 * to travel into a module the static pages import.
 */
export function recommendNext(completedSlugs: Iterable<string>, limit = 3): Recommendation[] {
  const completed = new Set(completedSlugs);
  const picked = new Set<string>();
  const out: Recommendation[] = [];

  /*
    One choke point, and it enforces the two invariants globally: never
    recommend something already finished, never recommend the same lesson twice.

    Both were originally left to each branch to check, and both leaked — a
    branch that offers a course's FIRST lesson has to remember the reader might
    have finished exactly that one, and the "finished everything" path
    recommended a completed lesson straight back. Guarding here means a new
    branch cannot reintroduce either bug.
  */
  const push = (rec: Recommendation | null) => {
    if (!rec || out.length >= limit) return;
    if (picked.has(rec.lessonSlug) || completed.has(rec.lessonSlug)) return;
    picked.add(rec.lessonSlug);
    out.push(rec);
  };

  const available = teachableCourses();

  /* 1 — finish what you started, oldest progress first. */
  const started = available.filter((course) => {
    const lessons = courseLessons(course.slug);
    const done = lessons.filter((l) => l && completed.has(l.slug)).length;
    return done > 0 && done < lessons.length;
  });

  for (const course of started) {
    const next = unfinished(course.slug, completed)[0];
    if (next) {
      push(
        toRecommendation(
          next.slug,
          course.slug,
          "continue-course",
          `Next in ${course.title}, which you have already started.`,
        ),
      );
    }
  }

  /* 2 — the next untouched course in a school already being studied. */
  const engagedSchools = new Set(
    available
      .filter((course) => courseLessons(course.slug).some((l) => l && completed.has(l.slug)))
      .map((course) => course.schoolId),
  );

  for (const course of available) {
    if (!engagedSchools.has(course.schoolId)) continue;
    const lessons = courseLessons(course.slug);
    if (lessons.length === 0 || lessons.some((l) => l && completed.has(l.slug))) continue;
    const school = getSchool(course.schoolId);
    push(
      toRecommendation(
        lessons[0]!.slug,
        course.slug,
        "next-in-school",
        school ? `More from ${school.name}.` : `Continue with ${course.title}.`,
      ),
    );
  }

  /*
    3 — breadth: an intro course from a school not yet touched.

    Only for a reader who HAS history. With an empty completed set every school
    is "not yet touched", so this branch would fire for a first-time visitor and
    label their very first lesson "Something different" — different from what?
    A new reader belongs in branch 4.
  */
  for (const course of completed.size > 0 ? available : []) {
    if (engagedSchools.has(course.schoolId) || course.level !== "intro") continue;
    const lessons = courseLessons(course.slug);
    if (lessons.length === 0) continue;
    const school = getSchool(course.schoolId);
    push(
      toRecommendation(
        lessons[0]!.slug,
        course.slug,
        "new-school",
        school ? `Something different: ${school.name}.` : course.title,
      ),
    );
  }

  /* 4 — no history: intro courses in campus order, so the first thing a new
         reader sees agrees with what the campus page already told them. */
  if (out.length === 0) {
    for (const course of available.filter((c) => c.level === "intro")) {
      const lessons = courseLessons(course.slug);
      if (lessons.length === 0) continue;
      push(toRecommendation(lessons[0]!.slug, course.slug, "start-here", `Start with ${course.title}.`));
    }
  }

  /*
    Last resort: a reader who has finished every teachable course still gets
    something rather than an empty panel — any lesson no course teaches, which
    is exactly the orphan set /admin/corpora reports.
  */
  if (out.length === 0) {
    const taught = new Set(COURSES.flatMap((c) => c.lessonSlugs));
    for (const lesson of LESSON_CATALOG) {
      if (taught.has(lesson.slug) || completed.has(lesson.slug)) continue;
      push(toRecommendation(lesson.slug, null, "start-here", "A guide outside the curriculum."));
    }
  }

  return out;
}
