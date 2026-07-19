import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getLessonMeta } from "@/lib/learning/catalog";
import { getModule } from "@/lib/platform/modules";

import { COURSES, courseMinutes, coursesForSchool } from "./courses";
import {
  CORE_LIVE_SCHOOL_PRODUCTS,
  SCHOOLS,
  getSchool,
  isTeachable,
  schoolAvailability,
  schoolViews,
  teachableSchools,
} from "./schools";

/**
 * Frenzsave Academy™ truth gate. See `docs/ACADEMY_RFC.md` §2.
 *
 * The Academy declares eleven schools and six of them teach products that do not
 * exist. That is only safe because availability is DERIVED and lesson bodies are
 * GATED. These tests are what make that structural rather than something a
 * reviewer has to catch every time.
 *
 * The risk here is strictly higher than the Download Hub's. A Gateway action
 * pointing at an unbuilt product is a link labelled "soon". A lesson is prose
 * asserting how software behaves — publishing that for software we have not built
 * poisons the support assistant, emits false schema.org entities, and creates the
 * support load the Academy exists to deflect.
 */

const ROOT = path.resolve(__dirname, "../..");

function routeExists(href: string): boolean {
  const clean = href.replace(/^\//, "").split("?")[0]!;
  if (!clean) return true;
  return ["app/(app)", "app/(marketing)", "app"].some((base) => {
    try {
      return statSync(path.join(ROOT, base, clean)).isDirectory();
    } catch {
      return false;
    }
  });
}

/* ------------------------------- registry shape ------------------------------ */

describe("Knowledge Campus — registry", () => {
  it("has unique ids and slugs", () => {
    expect(new Set(SCHOOLS.map((s) => s.id)).size).toBe(SCHOOLS.length);
    expect(new Set(SCHOOLS.map((s) => s.slug)).size).toBe(SCHOOLS.length);
  });

  it("has a unique ordering", () => {
    expect(new Set(SCHOOLS.map((s) => s.order)).size).toBe(SCHOOLS.length);
  });

  it("pairs `kind` with `productId` coherently", () => {
    for (const s of SCHOOLS) {
      if (s.kind === "practice") {
        // A practice school teaches a subject. Giving it a productId would quietly
        // couple honest subject-matter content to whether we shipped something.
        expect(s.productId, `${s.id} is practice but names a product`).toBeNull();
      } else {
        expect(s.productId, `${s.id} is a product school with no productId`).toBeTruthy();
      }
    }
  });
});

/* -------------------------------- truthfulness ------------------------------- */

describe("Knowledge Campus — truthfulness", () => {
  it("fails closed: an unknown product id resolves to `planned`", () => {
    const bogus = { ...SCHOOLS[0]!, kind: "product" as const, productId: "does-not-exist" };
    expect(schoolAvailability(bogus)).toBe("planned");
    expect(isTeachable(bogus)).toBe(false);
  });

  it("derives `live` for a product school only when the genome says claimable", () => {
    for (const s of SCHOOLS) {
      if (s.kind !== "product") continue;
      if (schoolAvailability(s) !== "live") continue;

      const product = getModule(s.productId!);
      if (product) {
        expect(product.veracity.claimable, `${s.id} → ${s.productId}`).toBe(true);
      } else {
        // No genome entry: it may ONLY be live via the audited allowlist.
        expect(
          CORE_LIVE_SCHOOL_PRODUCTS.has(s.productId!),
          `${s.id} is live but ${s.productId} is neither in the genome nor the allowlist`,
        ).toBe(true);
      }
    }
  });

  it("proves every allowlisted product with a route that exists on disk", () => {
    // The hole this closes: the allowlist bypasses the genome entirely, so a typo
    // would silently promote an unbuilt school to `live` and unlock lesson bodies.
    const broken = [...CORE_LIVE_SCHOOL_PRODUCTS.entries()]
      .filter(([, route]) => !routeExists(route))
      .map(([id, route]) => `${id} → ${route}`);
    expect(broken, `Allowlisted products with no proving route:\n  ${broken.join("\n  ")}`).toHaveLength(0);
  });

  it("never marks a planned school teachable", () => {
    for (const s of schoolViews()) {
      if (s.availability === "planned") {
        expect(s.teachable, `${s.id} is planned but teachable`).toBe(false);
      }
    }
  });

  it("keeps every unbuilt product school out of the teachable set", () => {
    const teachableIds = new Set(teachableSchools().map((s) => s.id));
    for (const s of SCHOOLS) {
      if (s.kind !== "product" || !s.productId) continue;
      const product = getModule(s.productId);
      const claimable = product?.veracity.claimable ?? false;
      const allowlisted = CORE_LIVE_SCHOOL_PRODUCTS.has(s.productId);
      if (!claimable && !allowlisted) {
        expect(teachableIds.has(s.id), `${s.id} teaches unbuilt ${s.productId}`).toBe(false);
      }
    }
  });

  it("always allows practice schools to teach", () => {
    // Editing craft and security hygiene are true regardless of what we ship.
    // Gating them on a product would be the opposite error: refusing to publish
    // knowledge that is genuinely correct.
    for (const s of SCHOOLS) {
      if (s.kind !== "practice") continue;
      expect(isTeachable(s), `${s.id} is a practice school but not teachable`).toBe(true);
    }
  });
});

/* --------------------------------- curriculum -------------------------------- */

describe("Curriculum", () => {
  it("has unique slugs and a unique order within each school", () => {
    expect(new Set(COURSES.map((c) => c.slug)).size).toBe(COURSES.length);
    for (const school of SCHOOLS) {
      const orders = coursesForSchool(school.id).map((c) => c.order);
      expect(new Set(orders).size, `${school.id} has duplicate course order`).toBe(orders.length);
    }
  });

  it("references only lessons that exist", () => {
    // Courses reference lessons BY SLUG and own no lesson data. That is what keeps
    // one title in one place — but it means a typo'd slug silently yields a course
    // with a missing lesson rather than a crash.
    const broken = COURSES.flatMap((c) =>
      c.lessonSlugs.filter((s) => !getLessonMeta(s)).map((s) => `${c.slug} → ${s}`),
    );
    expect(broken, `Courses referencing missing lessons:\n  ${broken.join("\n  ")}`).toHaveLength(0);
  });

  it("belongs to a school that exists", () => {
    for (const c of COURSES) {
      expect(getSchool(c.schoolId), `${c.slug} → unknown school ${c.schoolId}`).toBeTruthy();
    }
  });

  it("never declares a course for a school that may not teach", () => {
    // A course under a planned school would be curriculum for software we have not
    // built — the same false claim as a lesson, one level up.
    for (const c of COURSES) {
      const school = getSchool(c.schoolId)!;
      expect(isTeachable(school), `${c.slug} sits under un-teachable ${school.id}`).toBe(true);
    }
  });

  it("never declares an empty course", () => {
    /*
     * A course with no lessons is a hollow claim: it renders as a real curriculum
     * entry, appears in the sitemap and search, and teaches nothing. If the lessons
     * are not written yet, the course should not be declared yet.
     */
    for (const c of COURSES) {
      expect(c.lessonSlugs.length, `${c.slug} declares no lessons`).toBeGreaterThan(0);
      expect(c.outcomes.length, `${c.slug} declares no outcomes`).toBeGreaterThan(0);
    }
  });

  it("does not teach the same lesson from two courses", () => {
    // Two courses claiming one lesson makes progress ambiguous: completing it would
    // advance two courses, and neither percentage would mean anything.
    const seen = new Map<string, string>();
    for (const c of COURSES) {
      for (const slug of c.lessonSlugs) {
        const prior = seen.get(slug);
        expect(prior, `${slug} is taught by both ${prior} and ${c.slug}`).toBeUndefined();
        seen.set(slug, c.slug);
      }
    }
  });

  it("derives course length from the lesson catalogue", () => {
    for (const c of COURSES) {
      expect(courseMinutes(c.slug), `${c.slug} has zero reading time`).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------ bundle discipline ---------------------------- */

describe("Knowledge Campus — bundle discipline", () => {
  it("keeps the curriculum free of lesson prose", () => {
    const src = readFileSync(path.join(__dirname, "courses.ts"), "utf8");
    expect(src).not.toMatch(/from "@\/lib\/learning\/lessons"/);
  });

  it("keeps the school registry free of lesson prose", () => {
    /*
     * `lib/learning` learned this the expensive way: importing lesson TITLES for a
     * three-item rail pulled every word of every lesson into `/downloads`. The
     * Academy corpus is far larger, and this registry is imported by nav, search
     * and the campus index — i.e. nearly everywhere.
     */
    const src = readFileSync(path.join(__dirname, "schools.ts"), "utf8");
    expect(src).not.toMatch(/from "\.\/lessons"/);
    expect(src).not.toMatch(/from "@\/lib\/learning\/lessons"/);
  });
});
