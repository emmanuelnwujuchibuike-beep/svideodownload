import { getAssessment, uncheckedCourses } from "@/lib/academy/assessments";
import { COURSES, courseLessons, schoolCurriculumState } from "@/lib/academy/courses";
import { SCHOOLS, isTeachable, schoolViews } from "@/lib/academy/schools";
import { LOCALES } from "@/lib/i18n/locales";
import { catalogueCoverage, missingKeys } from "@/lib/i18n/messages";
import { LESSON_CATALOG, LESSON_SLUGS } from "@/lib/learning/catalog";
import {
  PILLAR_MIN_LESSONS,
  PILLAR_MIN_MEMBERS,
  allClusters,
  isPublishable,
} from "@/lib/seo/topics";
import { SUPPORT_ARTICLES, articleHref } from "@/lib/support/articles";
import { GLOSSARY } from "@/lib/support/glossary";
import { centreOf } from "@/lib/support/sections";

/**
 * Corpus health — the read model behind /admin/corpora.
 *
 * ── An inspection console, not an editor ──────────────────────────────────────
 *
 * Lessons, schools, articles and terms are compiled TypeScript. Nothing at
 * runtime can change them, so an admin screen offering an edit box would be a
 * lie with a save button on it. What an operator actually needs is the view they
 * cannot get from the code: what is published versus gated, what is orphaned,
 * and what is claimed but unreachable. When authorship moves to the 0085/0086
 * tables, the queries swap and this shape survives — the same stance
 * `/admin/content` already takes.
 *
 * ── Why findings and counts, not printing ─────────────────────────────────────
 *
 * Everything here returns data. That keeps the module render-free (so tests and
 * any future CLI can use it), and it is what lets the page decide severity
 * styling in one place rather than scattering it through prose.
 *
 * ── Deliberately nothing per-user ─────────────────────────────────────────────
 *
 * The personal plane (0088) records what individuals read. None of it appears
 * here, and `personal.test.ts` pins that. An operator needs to know a lesson is
 * orphaned; they do not need to know who read it, and building the screen that
 * shows them is how that boundary gets crossed by accident later.
 *
 * This module in particular stays entirely free of it — everything here is
 * derived from compiled content and nothing else. The aggregate that DOES read
 * the personal plane (0089) lives in `lib/content/learning-analytics.ts`, behind
 * an admin-gated database function with a k-anonymity floor, deliberately in a
 * separate module so the boundary is visible in the import graph rather than
 * buried in one function of a file that otherwise never touches user data.
 */

export type FindingSeverity = "broken" | "gap" | "note";

export interface CorpusFinding {
  severity: FindingSeverity;
  /** Which corpus this concerns — the grouping the page renders by. */
  area: "academy" | "support" | "glossary" | "locale";
  title: string;
  /** What an operator should do about it, or why it is acceptable. */
  detail: string;
}

export interface CorpusCounts {
  schools: number;
  teachableSchools: number;
  courses: number;
  lessons: number;
  articles: number;
  helpArticles: number;
  trustArticles: number;
  terms: number;
}

export function corpusCounts(): CorpusCounts {
  const articles = SUPPORT_ARTICLES;
  return {
    schools: SCHOOLS.length,
    teachableSchools: SCHOOLS.filter(isTeachable).length,
    courses: COURSES.length,
    lessons: LESSON_CATALOG.length,
    articles: articles.length,
    helpArticles: articles.filter((a) => centreOf(a.section).id === "help").length,
    trustArticles: articles.filter((a) => centreOf(a.section).id === "trust").length,
    terms: GLOSSARY.length,
  };
}

/* ---------------------------------- academy ---------------------------------- */

/**
 * Lessons no course teaches.
 *
 * Not a bug on its own — the guide corpus predates the curriculum and several
 * lessons are reached from downloader pages rather than from a school. It is
 * reported as a GAP because each one is a lesson a reader can only find by
 * search, and because the alternative (silence) is how a corpus quietly splits
 * into a taught half and a forgotten half.
 */
export function orphanLessons(): string[] {
  const taught = new Set(COURSES.flatMap((c) => c.lessonSlugs));
  return LESSON_SLUGS.filter((slug) => !taught.has(slug));
}

/** Course lesson slugs that resolve to no lesson at all. Always a real break. */
export function danglingCourseLessons(): { course: string; slug: string }[] {
  const known = new Set(LESSON_SLUGS);
  return COURSES.flatMap((course) =>
    course.lessonSlugs
      .filter((slug) => !known.has(slug))
      .map((slug) => ({ course: course.slug, slug })),
  );
}

/* ---------------------------------- support ---------------------------------- */

/**
 * Articles nothing links to.
 *
 * `related` is the corpus's own internal link graph, and an article with no
 * inbound edge is reachable only from its centre's index. That is survivable for
 * one article and corrosive at scale — it is the shape a corpus takes just
 * before half of it becomes unfindable.
 *
 * Note this measures the CORPUS graph, not the rendered hyperlink graph. The
 * distinction cost a whole metric once before: an orphan check that counted the
 * wrong edges reported 155 orphans out of 169, which is a number an operator
 * learns to ignore and then deletes.
 */
export function unlinkedArticles(): string[] {
  const linked = new Set(SUPPORT_ARTICLES.flatMap((a) => a.related));
  return SUPPORT_ARTICLES.filter((a) => !linked.has(a.slug)).map((a) => a.slug);
}

/** Terms no other term relates to — the glossary's version of the same check. */
export function unlinkedTerms(): string[] {
  const linked = new Set(GLOSSARY.flatMap((t) => t.related));
  return GLOSSARY.filter((t) => !linked.has(t.slug)).map((t) => t.slug);
}

/* ----------------------------------- audit ----------------------------------- */

export function auditCorpora(): CorpusFinding[] {
  const findings: CorpusFinding[] = [];

  /* --- academy --- */
  for (const { course, slug } of danglingCourseLessons()) {
    findings.push({
      severity: "broken",
      area: "academy",
      title: `Course "${course}" teaches a lesson that does not exist`,
      detail: `Lesson slug "${slug}" resolves to nothing, so the course renders one fewer lesson than it claims. Either write it or remove the slug.`,
    });
  }

  const unchecked = uncheckedCourses();
  if (unchecked.length > 0) {
    findings.push({
      severity: "note",
      area: "academy",
      title: `${unchecked.length} course(s) have no self-check`,
      detail: `Complete and readable without one — a check is an optional extra, not a missing part: ${unchecked.join(", ")}.`,
    });
  }

  const heldTopics = allClusters().filter((c) => !isPublishable(c));
  if (heldTopics.length > 0) {
    findings.push({
      severity: "note",
      area: "academy",
      title: `${heldTopics.length} topic cluster(s) have not earned a pillar page`,
      detail: `Below the gate of ${PILLAR_MIN_LESSONS} lesson and ${PILLAR_MIN_MEMBERS} members, so no page is generated: ${heldTopics
        .map((c) => `${c.topic.slug} (${c.size})`)
        .join(", ")}. Each is one or two pieces of writing away from publishing itself.`,
    });
  }

  const orphans = orphanLessons();
  if (orphans.length > 0) {
    findings.push({
      severity: "gap",
      area: "academy",
      title: `${orphans.length} lesson(s) belong to no course`,
      detail: `Reachable from search and from downloader pages, but not from any school: ${orphans.join(", ")}.`,
    });
  }

  for (const school of schoolViews()) {
    if (!isTeachable(school)) continue;
    const state = schoolCurriculumState(school.id);
    if (state !== "ready") {
      findings.push({
        severity: "gap",
        area: "academy",
        title: `${school.name} is teachable but its curriculum is "${state}"`,
        detail:
          state === "planned"
            ? "The school publishes with no course behind it — an index page with nothing to read."
            : "Some courses are still incomplete, so the school page over-promises what a reader can finish today.",
      });
    }
  }

  /* --- support --- */
  const unlinked = unlinkedArticles();
  if (unlinked.length > 0) {
    findings.push({
      severity: "gap",
      area: "support",
      title: `${unlinked.length} article(s) have no inbound related link`,
      detail: `Reachable only from their centre's index: ${unlinked.join(", ")}. Adding each to a related list of a neighbouring article is usually the fix.`,
    });
  }

  for (const article of SUPPORT_ARTICLES) {
    const href = articleHref(article);
    if (!href.startsWith("/help/") && !href.startsWith("/trust/")) {
      findings.push({
        severity: "broken",
        area: "support",
        title: `Article "${article.slug}" resolves to an unexpected route`,
        detail: `articleHref returned "${href}". Every article must live under exactly one centre.`,
      });
    }
  }

  /* --- glossary --- */
  const strandedTerms = unlinkedTerms();
  if (strandedTerms.length > 0) {
    findings.push({
      severity: "note",
      area: "glossary",
      title: `${strandedTerms.length} term(s) are not related from any other term`,
      detail: `Still findable by search and by their aliases, which is how most people reach a glossary: ${strandedTerms.join(", ")}.`,
    });
  }

  /* --- locales --- */
  for (const locale of LOCALES) {
    const done = catalogueCoverage(locale.code);
    if (done >= 1) continue;
    findings.push({
      severity: done === 0 ? "note" : "gap",
      area: "locale",
      title: `${locale.name} (${locale.endonym}) is ${Math.round(done * 100)}% translated`,
      detail:
        done === 0
          ? `Declared and not started — ${missingKeys(locale.code).length} UI strings outstanding. Never offered to visitors while it is below 90%.`
          : `${missingKeys(locale.code).length} strings outstanding. Reaches visitors at 90%.`,
    });
  }

  return findings;
}

/** Per-locale translation progress, for the admin table. */
export function localeProgress() {
  return LOCALES.map((locale) => ({
    code: locale.code,
    name: locale.name,
    endonym: locale.endonym,
    direction: locale.direction,
    coverage: catalogueCoverage(locale.code),
    missing: missingKeys(locale.code).length,
  }));
}

/**
 * Course-level curriculum view: lesson counts an operator can act on.
 *
 * `questions` is null rather than 0 when no self-check exists — "no check
 * written" and "a check with nothing in it" are different states, and only the
 * second one is a fault. `assessments.test.ts` makes the second impossible, so
 * a null here is the editorial backlog and a zero would be a bug.
 */
export function courseHealth() {
  return COURSES.map((course) => ({
    slug: course.slug,
    title: course.title,
    schoolId: course.schoolId,
    declared: course.lessonSlugs.length,
    resolvable: courseLessons(course.slug).length,
    questions: getAssessment(course.slug)?.questions.length ?? null,
  }));
}

/**
 * Teachable courses with no self-check yet.
 *
 * Reported as a `note`, not a `gap`: a course without a check is complete and
 * useful, it simply has no optional extra. Scoring it higher would repeat the
 * orphan-detection mistake — a metric that flags 155 non-problems gets ignored,
 * then deleted, and takes the real findings with it.
 */
export function assessmentBacklog(): string[] {
  return uncheckedCourses();
}
