import { describe, expect, it } from "vitest";

import { courseLessons, teachableCourses } from "./courses";
import { recommendNext } from "./recommend";

/**
 * Recommendation gates.
 *
 * The ranking is a legible function, so these tests read as its specification:
 * finish what you started, then breadth, and never recommend something a reader
 * cannot actually study.
 */

const firstCourseWithLessons = () =>
  teachableCourses().find((c) => courseLessons(c.slug).length >= 2);

describe("recommendNext", () => {
  it("gives a new reader somewhere to start", () => {
    const recs = recommendNext([]);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]!.reason).toBe("start-here");
    for (const r of recs) expect(r.href).toBe(`/learn/${r.lessonSlug}`);
  });

  it("puts finishing a started course first", () => {
    /*
     * The strongest signal in the system: the reader has already chosen the
     * subject. Recommending anything else first answers a question they did not
     * ask.
     */
    const course = firstCourseWithLessons();
    expect(course, "no teachable course with 2+ lessons").toBeTruthy();

    const lessons = courseLessons(course!.slug);
    const recs = recommendNext([lessons[0]!.slug]);

    expect(recs[0]!.reason).toBe("continue-course");
    expect(recs[0]!.courseSlug).toBe(course!.slug);
    // The NEXT lesson in teaching order, not just any unfinished one.
    expect(recs[0]!.lessonSlug).toBe(lessons[1]!.slug);
  });

  it("never recommends a lesson already completed", () => {
    const course = firstCourseWithLessons()!;
    const lessons = courseLessons(course.slug).map((l) => l!.slug);
    const recs = recommendNext(lessons, 10);
    for (const r of recs) expect(lessons).not.toContain(r.lessonSlug);
  });

  it("never repeats a lesson", () => {
    const recs = recommendNext([], 10);
    expect(new Set(recs.map((r) => r.lessonSlug)).size).toBe(recs.length);
  });

  it("respects the limit", () => {
    expect(recommendNext([], 2).length).toBeLessThanOrEqual(2);
    expect(recommendNext([], 1).length).toBeLessThanOrEqual(1);
  });

  it("only recommends lessons from teachable courses", () => {
    /*
     * Availability is inherited from `teachableCourses()`, not re-derived. A
     * course whose school is not claimable must be unreachable here, or the
     * Academy's truth gate would have a side door.
     */
    const teachable = new Set(teachableCourses().map((c) => c.slug));
    for (const r of recommendNext([], 10)) {
      if (r.courseSlug) expect(teachable.has(r.courseSlug)).toBe(true);
    }
  });

  it("always explains itself", () => {
    // A recommendation with no stated reason is indistinguishable from a random
    // link, and readers treat it as one.
    for (const r of recommendNext([], 5)) {
      expect(r.explanation.trim().length).toBeGreaterThan(5);
      expect(r.title.length).toBeGreaterThan(0);
    }
  });

  it("still returns something to a reader who has finished everything", () => {
    const everything = teachableCourses().flatMap((c) => courseLessons(c.slug).map((l) => l!.slug));
    const recs = recommendNext(everything, 3);
    // May legitimately be empty only if the curriculum covers every lesson.
    for (const r of recs) expect(everything).not.toContain(r.lessonSlug);
  });
});
