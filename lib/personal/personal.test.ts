import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { COURSE_SLUGS, courseLessons } from "@/lib/academy/courses";
import { LESSON_SLUGS } from "@/lib/learning/catalog";
import { SUPPORT_ARTICLES } from "@/lib/support/articles";
import {
  PERSONAL_ITEM_KINDS,
  completedLessonSlugs,
  courseProgress,
  itemExists,
  itemHref,
  itemTitle,
  resolvableItems,
  type PersonalItemState,
} from "./items";

/**
 * The personal plane's gates.
 *
 * This is the first table in the project holding a record of what an individual
 * reads, which makes it the first one where a loose check is a privacy problem
 * rather than a correctness one. The tests below cover both halves: that items
 * resolve to real pages, and that nothing personal leaks into a surface that was
 * built to be public.
 */

function state(partial: Partial<PersonalItemState> & Pick<PersonalItemState, "kind" | "slug">) {
  return {
    completedAt: null,
    bookmarkedAt: null,
    lastViewedAt: null,
    note: null,
    ...partial,
  } as PersonalItemState;
}

describe("personal items resolve to real pages", () => {
  it("accepts every lesson and every support article", () => {
    for (const slug of LESSON_SLUGS) {
      expect(itemExists("lesson", slug), `lesson ${slug} not resolvable`).toBe(true);
      expect(itemHref("lesson", slug)).toBe(`/learn/${slug}`);
      expect(itemTitle("lesson", slug)).toBeTruthy();
    }

    for (const article of SUPPORT_ARTICLES) {
      expect(itemExists("article", article.slug), `article ${article.slug}`).toBe(true);
      // Derived, never a hardcoded prefix: one corpus, two centres. A saved list
      // that assumed /trust would send half its entries to a 404.
      expect(itemHref("article", article.slug)).toMatch(/^\/(help|trust)\//);
    }
  });

  it("rejects a slug that names nothing", () => {
    /*
     * The check the database cannot make — lessons and articles are compiled
     * TypeScript, so there is no foreign key. Without this, the table would take
     * arbitrary strings and become free storage on a self-writable row.
     */
    expect(itemExists("lesson", "not-a-lesson")).toBe(false);
    expect(itemExists("article", "../../etc/passwd")).toBe(false);
    expect(itemHref("lesson", "not-a-lesson")).toBeNull();
  });

  it("hides stale rows on read without destroying them", () => {
    const items = [
      state({ kind: "lesson", slug: LESSON_SLUGS[0]! }),
      state({ kind: "lesson", slug: "retired-lesson", note: "a note the reader wrote" }),
    ];
    const visible = resolvableItems(items);

    expect(visible).toHaveLength(1);
    // The stale row is filtered from the RESULT, not deleted from the input —
    // dropping someone's note because we renamed a slug is the worse failure.
    expect(items).toHaveLength(2);
  });

  it("only declares kinds that have their own URL", () => {
    // A glossary term is an anchor and a course renders inside its school, so
    // neither can be returned to. Saving one would produce an entry that scrolls
    // you into the middle of a page you did not choose.
    expect([...PERSONAL_ITEM_KINDS].sort()).toEqual(["article", "lesson"]);
  });
});

describe("course progress is derived, not stored", () => {
  it("counts completed lessons against the course's resolvable ones", () => {
    const slug = COURSE_SLUGS.find((s) => courseLessons(s).length >= 2);
    expect(slug, "no course with 2+ lessons to test against").toBeTruthy();

    const lessons = courseLessons(slug!);
    const none = courseProgress(slug!, new Set());
    expect(none.completed).toBe(0);
    expect(none.fraction).toBe(0);
    expect(none.total).toBe(lessons.length);

    const all = courseProgress(slug!, new Set(lessons.map((l) => l!.slug)));
    expect(all.completed).toBe(lessons.length);
    expect(all.fraction).toBe(1);
  });

  it("reports zero rather than NaN for a course with no lessons", () => {
    // A course whose lessons were all retired divides by zero otherwise, and the
    // progress bar renders as NaN% — visible, ugly, and reported as a bug days
    // after the content change that caused it.
    const progress = courseProgress("no-such-course", new Set());
    expect(progress).toEqual({ total: 0, completed: 0, fraction: 0 });
  });

  it("reads completion only from lessons", () => {
    const completed = completedLessonSlugs([
      state({ kind: "lesson", slug: LESSON_SLUGS[0]!, completedAt: "2026-07-19T00:00:00Z" }),
      state({ kind: "lesson", slug: LESSON_SLUGS[1]! }),
      state({ kind: "article", slug: SUPPORT_ARTICLES[0]!.slug, completedAt: "2026-07-19T00:00:00Z" }),
    ]);

    expect(completed.has(LESSON_SLUGS[0]!)).toBe(true);
    expect(completed.has(LESSON_SLUGS[1]!)).toBe(false);
    expect(completed.has(SUPPORT_ARTICLES[0]!.slug)).toBe(false);
  });
});

describe("the personal plane stays private", () => {
  const route = readFileSync("app/api/personal/route.ts", "utf8");

  it("never lets a response be cached", () => {
    /*
     * Cloudflare fronts Vercel on this project. A shared-cache hit on a
     * per-user endpoint serves one reader's notes to the next visitor, so
     * no-store is set on EVERY response including errors — which are also
     * per-user — rather than left to a default a config change could alter.
     */
    expect(route).toContain("no-store");
    expect(route).toContain("private");
    /*
      Exactly ONE call to NextResponse.json — the one inside the helper. Any
      second call is a response built without the header, which is how a
      per-user endpoint ends up with one cacheable path nobody noticed.
    */
    expect(route).toMatch(/function json\(/);
    expect(route.match(/NextResponse\.json\(/g) ?? []).toHaveLength(1);
  });

  it("is dynamic, so it can never be prerendered", () => {
    expect(route).toContain('export const dynamic = "force-dynamic"');
  });

  it("scopes every read to the caller's own id", () => {
    // RLS is the real boundary, but a missing filter here would mean relying on
    // it alone — and one policy mistake would then expose everyone's history.
    expect(route).toContain('.eq("user_id", user.id)');
  });

  it("keeps personal writing out of the public search index", () => {
    /*
     * The search index is built at compile time from public corpora and this
     * table is not one of them. Pinning it because the failure would be silent
     * and severe: a note is private writing, and a static index is served to
     * everyone and cached at the edge.
     */
    const index = readFileSync("lib/search/index.ts", "utf8");
    expect(index).not.toContain("personal_learning_items");
    expect(index).not.toContain("@/features/personal");
  });

  it("keeps personal state out of the assistant's context", () => {
    const corpus = readFileSync("lib/assistant/corpus.ts", "utf8");
    expect(corpus).not.toContain("personal_learning_items");
  });
});

describe("migration 0088", () => {
  const sql = readFileSync("supabase/migrations/0088_personal_learning_plane.sql", "utf8");

  it("enables RLS and restricts every operation to the owner", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toMatch(/using \(auth\.uid\(\) = user_id\)/);
    expect(sql).toMatch(/with check \(auth\.uid\(\) = user_id\)/);
  });

  it("grants nobody else read access", () => {
    // Which lessons someone reads is a real signal about them — the security
    // school, the privacy articles. An aggregate over this table is a separate
    // decision and must be made explicitly, not fall out of a loose policy.
    const policies = sql.match(/create policy[\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(1);
  });

  it("constrains item_kind in the database too", () => {
    expect(sql).toMatch(/check \(item_kind in \('lesson', 'article'\)\)/);
  });

  it("is idempotent", () => {
    // Every migration here is re-runnable; the owner applies these by hand.
    expect(sql).toContain("create table if not exists");
    expect(sql).toContain("drop policy if exists");
  });
});
