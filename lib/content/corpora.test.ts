import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { COURSES } from "@/lib/academy/courses";
import { LESSON_CATALOG } from "@/lib/learning/catalog";
import { SUPPORT_ARTICLES } from "@/lib/support/articles";
import {
  auditCorpora,
  corpusCounts,
  courseHealth,
  danglingCourseLessons,
  localeProgress,
  orphanLessons,
  unlinkedArticles,
} from "./corpora";

/**
 * Corpus operations gates.
 *
 * The audit is an operator's view of content health, so the tests care about two
 * things: that the numbers are real (not re-derived approximations that can
 * disagree with the pages themselves), and that a finding means something —
 * a console that reports non-problems gets ignored and then deleted, which is
 * exactly what happened to the first orphan metric on this project.
 */

describe("corpus counts are the real ones", () => {
  it("counts what the corpora actually contain", () => {
    const counts = corpusCounts();
    expect(counts.lessons).toBe(LESSON_CATALOG.length);
    expect(counts.courses).toBe(COURSES.length);
    expect(counts.articles).toBe(SUPPORT_ARTICLES.length);
  });

  it("splits articles between the centres with nothing lost", () => {
    const counts = corpusCounts();
    expect(counts.helpArticles + counts.trustArticles).toBe(counts.articles);
    expect(counts.helpArticles).toBeGreaterThan(0);
    expect(counts.trustArticles).toBeGreaterThan(0);
  });
});

describe("findings mean something", () => {
  it("reports no dangling course lesson", () => {
    /*
     * A course teaching a slug that resolves to nothing renders one fewer lesson
     * than it claims. This is the one finding that is always a real break, so it
     * should be empty in a healthy tree — if this ever fails, the console is
     * doing its job and the content needs fixing.
     */
    expect(danglingCourseLessons()).toEqual([]);
  });

  it("agrees with courseHealth on declared vs resolvable", () => {
    for (const course of courseHealth()) {
      expect(course.resolvable, `${course.slug} declares more than it can resolve`).toBe(
        course.declared,
      );
    }
  });

  it("classifies severity honestly", () => {
    // `broken` must mean a reader is hitting something wrong right now. A
    // console that cries wolf is one that gets ignored.
    const broken = auditCorpora().filter((f) => f.severity === "broken");
    expect(broken, `Real breaks:\n  ${broken.map((f) => f.title).join("\n  ")}`).toHaveLength(0);
  });

  it("distinguishes an orphan lesson from a broken one", () => {
    // Orphans are a GAP, never a break: several lessons predate the curriculum
    // and are reached from downloader pages rather than from a school.
    const orphans = orphanLessons();
    const findings = auditCorpora().filter((f) => f.area === "academy");
    if (orphans.length > 0) {
      expect(findings.some((f) => f.severity === "gap" && f.title.includes("no course"))).toBe(true);
    }
  });

  it("measures the corpus link graph, not the rendered one", () => {
    /*
     * The trap this avoids, learned the expensive way: an orphan check counting
     * the wrong edges once reported 155 orphans out of 169 nodes. `related` is
     * the corpus's own graph, so an "unlinked" article is genuinely one nothing
     * points at — a number small enough to act on.
     */
    expect(unlinkedArticles().length).toBeLessThan(SUPPORT_ARTICLES.length / 2);
  });
});

describe("locale progress is measured", () => {
  it("reports English complete and the rest at zero", () => {
    const progress = localeProgress();
    const en = progress.find((l) => l.code === "en");
    expect(en?.coverage).toBe(1);
    expect(en?.missing).toBe(0);

    for (const locale of progress.filter((l) => l.code !== "en")) {
      expect(locale.coverage, `${locale.code} claims coverage`).toBe(0);
      expect(locale.missing).toBeGreaterThan(0);
    }
  });
});

describe("the admin surface stays an operator tool", () => {
  const page = readFileSync("app/admin/corpora/page.tsx", "utf8");

  it("is never indexed and never prerendered", () => {
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toContain("robots: { index: false, follow: false }");
  });

  it("checks admin rights in the page, not only in middleware", () => {
    expect(page).toContain("isAdmin(");
    expect(page).toContain('redirect("/")');
  });

  it("shows nothing from the personal plane", () => {
    /*
     * 0088 records what individuals read — the security school, the privacy
     * articles. An operator needs to know a lesson is orphaned, not who read it.
     * Pinned because the screen that crosses this line would be an easy and
     * plausible addition later.
     */
    expect(page).not.toContain("personal_learning_items");
    expect(page).not.toContain("@/features/personal");
    expect(readFileSync("lib/content/corpora.ts", "utf8")).not.toContain("personal_learning_items");
  });

  it("is reachable from the admin dashboard", () => {
    // Route existence is not route shipping — the sibling operator pages were
    // reachable only by typing the URL, and an operator page has no organic
    // traffic to make that absence obvious.
    const dashboard = readFileSync("app/admin/page.tsx", "utf8");
    // The routes, not an href literal — the links are rendered from a list, and
    // asserting the attribute would break the moment anyone refactors the loop
    // while proving nothing extra today.
    expect(dashboard).toContain('"/admin/corpora"');
    expect(dashboard).toContain('"/admin/content"');
    expect(dashboard).toContain("aria-label=\"Operations\"");
  });
});
