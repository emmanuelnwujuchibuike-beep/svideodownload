import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  allAssessments,
  gradeAssessment,
  getAssessment,
  orderedQuestions,
  teachableAssessments,
  uncheckedCourses,
} from "./assessments";
import { COURSES, getCourse, teachableCourses } from "./courses";
import { getSchool, isTeachable } from "./schools";

/**
 * Course self-checks — the gate.
 *
 * A question and its explanation are prose asserting how something behaves, so
 * they sit under the same truth gate as a lesson body (see `academy.test.ts`).
 * Two failure modes are specific to this corpus and neither is visible by
 * reading a rendered page:
 *
 *  1. A question drawn from a lesson its course does not teach. It renders as a
 *     perfectly normal question and it is a trick — the reader is being marked
 *     wrong on material nobody showed them.
 *  2. A question whose `correctChoiceId` does not match any of its choices. It
 *     renders fine, and every answer is graded wrong. Nothing surfaces that
 *     except someone taking the check and noticing they cannot pass it.
 */

describe("Assessments — shape", () => {
  it("declares at most one assessment per course", () => {
    const slugs = allAssessments().map((a) => a.courseSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has globally unique question ids", () => {
    // Ids key React lists and the answer map. A collision means two questions
    // share one answer slot, so answering either fills both.
    const ids = allAssessments().flatMap((a) => a.questions.map((q) => q.id));
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates, `Duplicate question ids: ${duplicates.join(", ")}`).toHaveLength(0);
  });

  it("attaches every assessment to a course that exists", () => {
    for (const a of allAssessments()) {
      expect(getCourse(a.courseSlug), `${a.courseSlug} is not a course`).toBeTruthy();
    }
  });

  it("keeps pass marks within a sane range", () => {
    for (const a of allAssessments()) {
      expect(a.passMark, `${a.courseSlug}`).toBeGreaterThan(0);
      expect(a.passMark, `${a.courseSlug}`).toBeLessThanOrEqual(1);
    }
  });

  it("never declares an empty assessment", () => {
    // A check with no questions renders as a real call to action that does
    // nothing — the assessment equivalent of an empty course.
    for (const a of allAssessments()) {
      expect(a.questions.length, `${a.courseSlug} has no questions`).toBeGreaterThan(0);
    }
  });
});

describe("Assessments — question integrity", () => {
  const questions = allAssessments().flatMap((a) =>
    a.questions.map((q) => ({ course: a.courseSlug, q })),
  );

  it("resolves every correctChoiceId to a choice on that question", () => {
    /*
     * The silent killer. A typo here renders a normal-looking question that
     * cannot be answered correctly by anyone, and the only symptom is a reader
     * who fails a check they understood.
     */
    const broken = questions
      .filter(({ q }) => !q.choices.some((c) => c.id === q.correctChoiceId))
      .map(({ course, q }) => `${course}/${q.id} → ${q.correctChoiceId}`);
    expect(broken, `Questions whose answer is not one of their choices:\n  ${broken.join("\n  ")}`).toHaveLength(0);
  });

  it("offers at least three choices, with unique ids and unique text", () => {
    for (const { course, q } of questions) {
      const where = `${course}/${q.id}`;
      expect(q.choices.length, `${where} has too few choices`).toBeGreaterThanOrEqual(3);
      expect(new Set(q.choices.map((c) => c.id)).size, `${where} has duplicate choice ids`).toBe(
        q.choices.length,
      );
      // Two identically-worded options mean one of them is a correct answer
      // marked wrong. Cheap to typo, invisible until someone picks the twin.
      expect(
        new Set(q.choices.map((c) => c.text.trim().toLowerCase())).size,
        `${where} has duplicate choice text`,
      ).toBe(q.choices.length);
    }
  });

  it("explains every answer", () => {
    // The explanation is the teaching surface. A question without one is a
    // score with no lesson attached, which is the version of this feature that
    // is not worth shipping.
    for (const { course, q } of questions) {
      expect(q.explanation.trim().length, `${course}/${q.id} has no explanation`).toBeGreaterThan(40);
      expect(q.prompt.trim().length, `${course}/${q.id} has no prompt`).toBeGreaterThan(10);
    }
  });
});

describe("Assessments — truth gate", () => {
  it("only draws questions from lessons the course actually teaches", () => {
    /*
     * The core invariant. A question sourced outside its course's lesson list
     * tests material the reader was never shown, and it also breaks the review
     * list — `reviewLessonSlugs` filters through the course's lessons, so an
     * outside slug silently vanishes and a wrong answer produces no guidance.
     */
    const broken = allAssessments().flatMap((a) => {
      const course = getCourse(a.courseSlug);
      if (!course) return [];
      const taught = new Set(course.lessonSlugs);
      return a.questions
        .filter((q) => !taught.has(q.lessonSlug))
        .map((q) => `${a.courseSlug}/${q.id} → ${q.lessonSlug}`);
    });
    expect(
      broken,
      `Questions drawn from lessons their course does not teach:\n  ${broken.join("\n  ")}`,
    ).toHaveLength(0);
  });

  it("never declares an assessment for a course that may not be taught", () => {
    for (const a of allAssessments()) {
      const course = getCourse(a.courseSlug)!;
      const school = getSchool(course.schoolId)!;
      expect(isTeachable(school), `${a.courseSlug} sits under un-teachable ${school.id}`).toBe(true);
    }
  });

  it("withholds an assessment whose course is not teachable", () => {
    // getAssessment is the only accessor rendering surfaces call, so the gate
    // has to live there rather than in the caller.
    const teachable = new Set(teachableCourses().map((c) => c.slug));
    for (const a of allAssessments()) {
      if (!teachable.has(a.courseSlug)) {
        expect(getAssessment(a.courseSlug), `${a.courseSlug} leaked past the gate`).toBeUndefined();
      }
    }
    expect(teachableAssessments().length).toBe(
      allAssessments().filter((a) => teachable.has(a.courseSlug)).length,
    );
  });

  it("returns nothing for a course that does not exist", () => {
    expect(getAssessment("no-such-course")).toBeUndefined();
    expect(gradeAssessment("no-such-course", {})).toBeNull();
    expect(orderedQuestions("no-such-course")).toEqual([]);
  });
});

describe("Assessments — coverage", () => {
  it("asks about every lesson in a checked course", () => {
    /*
     * A check that only covers the first lesson of a two-lesson course reports
     * "you have understood this course" on half the evidence. Not a hard truth
     * violation, but it makes the pass mark mean something different per course,
     * which is worse than either extreme.
     */
    const gaps = allAssessments().flatMap((a) => {
      const course = getCourse(a.courseSlug);
      if (!course) return [];
      const asked = new Set(a.questions.map((q) => q.lessonSlug));
      return course.lessonSlugs.filter((s) => !asked.has(s)).map((s) => `${a.courseSlug} → ${s}`);
    });
    expect(gaps, `Lessons in a checked course with no question:\n  ${gaps.join("\n  ")}`).toHaveLength(0);
  });

  it("reports uncovered courses as a backlog rather than failing", () => {
    // Deliberately not an assertion that the backlog is empty. The corpus grows
    // faster than the checks, and a test that fails on an unwritten assessment
    // would make adding a course require writing one in the same commit.
    const backlog = uncheckedCourses();
    for (const slug of backlog) {
      expect(getCourse(slug), `backlog names a non-course: ${slug}`).toBeTruthy();
    }
    expect(backlog.length).toBeLessThanOrEqual(COURSES.length);
  });
});

describe("Assessments — grading", () => {
  const courseSlug = "saving-media-responsibly";

  function answersFor(courseSlugArg: string, pick: (correct: string, ids: string[]) => string | null) {
    const out: Record<string, string | null> = {};
    for (const q of orderedQuestions(courseSlugArg)) {
      out[q.id] = pick(
        q.correctChoiceId,
        q.choices.map((c) => c.id),
      );
    }
    return out;
  }

  it("scores a perfect attempt as a pass with nothing to review", () => {
    const result = gradeAssessment(courseSlug, answersFor(courseSlug, (correct) => correct))!;
    expect(result.score).toBe(result.total);
    expect(result.passed).toBe(true);
    expect(result.reviewLessonSlugs).toEqual([]);
  });

  it("scores every wrong answer as a fail and names the lessons to reread", () => {
    const result = gradeAssessment(
      courseSlug,
      answersFor(courseSlug, (correct, ids) => ids.find((id) => id !== correct)!),
    )!;
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.reviewLessonSlugs.length).toBeGreaterThan(0);
  });

  it("grades a skipped question as wrong rather than refusing the attempt", () => {
    // A partial attempt still gets explanations and a review list. Withholding
    // those over an unanswered question punishes the reader for the wrong thing.
    const result = gradeAssessment(courseSlug, {})!;
    expect(result.total).toBeGreaterThan(0);
    expect(result.score).toBe(0);
    expect(result.answers.every((a) => a.chosenChoiceId === null && !a.correct)).toBe(true);
  });

  it("lists review lessons in the course's teaching order, de-duplicated", () => {
    const course = getCourse(courseSlug)!;
    const result = gradeAssessment(
      courseSlug,
      answersFor(courseSlug, (correct, ids) => ids.find((id) => id !== correct)!),
    )!;

    expect(new Set(result.reviewLessonSlugs).size).toBe(result.reviewLessonSlugs.length);
    const positions = result.reviewLessonSlugs.map((s) => course.lessonSlugs.indexOf(s));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((p) => p >= 0)).toBe(true);
  });

  it("points every graded answer at a lesson route", () => {
    const result = gradeAssessment(courseSlug, {})!;
    for (const answer of result.answers) {
      expect(answer.lessonHref).toBe(`/learn/${answer.lessonSlug}`);
    }
  });

  it("respects the pass mark at the boundary", () => {
    /*
     * Grading is `score / total >= passMark`. Checking the boundary explicitly
     * because an off-by-one between `>` and `>=` is invisible in every attempt
     * except the one that lands exactly on the threshold.
     */
    for (const a of teachableAssessments()) {
      const questions = orderedQuestions(a.courseSlug);
      const needed = Math.ceil(a.passMark * questions.length);
      const chosen: Record<string, string | null> = {};
      questions.forEach((q, i) => {
        chosen[q.id] =
          i < needed ? q.correctChoiceId : q.choices.find((c) => c.id !== q.correctChoiceId)!.id;
      });
      const result = gradeAssessment(a.courseSlug, chosen)!;
      expect(result.score, a.courseSlug).toBe(needed);
      expect(result.passed, `${a.courseSlug} at exactly the pass mark`).toBe(true);
    }
  });
});

describe("Assessments — bundle discipline", () => {
  it("keeps question prose out of the metadata modules", () => {
    /*
     * `schools.ts` and `courses.ts` are imported by nav, search and the campus
     * index — i.e. nearly everywhere. This corpus is prose, and the same import
     * once pulled every word of every lesson into `/downloads`.
     */
    for (const file of ["schools.ts", "courses.ts", "recommend.ts"]) {
      const src = readFileSync(path.join(__dirname, file), "utf8");
      expect(src, `${file} imports assessment prose`).not.toMatch(/from "\.\/assessments"/);
      expect(src, `${file} imports assessment prose`).not.toMatch(
        /from "@\/lib\/academy\/assessments"/,
      );
    }
  });
});
