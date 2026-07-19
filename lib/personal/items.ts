import { courseLessons } from "@/lib/academy/courses";
import { getLessonMeta } from "@/lib/learning/catalog";
import { articleHref, getArticle } from "@/lib/support/articles";

/**
 * The personal plane — what a reader has finished, saved and noted.
 *
 * ── Only kinds that have a page ───────────────────────────────────────────────
 *
 * Two kinds, because two things have their own URL a reader can return to. A
 * glossary term is an anchor on one page and a course renders inside its school,
 * so neither is bookmarkable in any way that would mean something later — a
 * "saved" list whose entries scroll you to the middle of a page you did not
 * choose is a worse feature than not having it.
 *
 * ── Course progress is derived, never stored ──────────────────────────────────
 *
 * A course is a list of lesson slugs. Its progress is therefore a function of
 * lesson completions, and storing it as well would create a second source of
 * truth that goes wrong silently the moment a course's lesson list changes —
 * exactly the drift the Product Genome and the availability derivations exist to
 * prevent. `courseProgress()` computes it on read.
 */

export type PersonalItemKind = "lesson" | "article";

export const PERSONAL_ITEM_KINDS: readonly PersonalItemKind[] = ["lesson", "article"];

export interface PersonalItemRef {
  kind: PersonalItemKind;
  slug: string;
}

export interface PersonalItemState {
  kind: PersonalItemKind;
  slug: string;
  completedAt: string | null;
  bookmarkedAt: string | null;
  lastViewedAt: string | null;
  note: string | null;
}

/**
 * Notes are capped, and the cap is enforced here rather than only in the API.
 *
 * A note is a reading aid, not a document store: uncapped free text on a
 * self-writable table is an invitation to use it as one, and the cost lands on
 * every future read of the row. 4000 characters is far more than anyone writes
 * against a single lesson and small enough that a row stays cheap.
 */
export const MAX_NOTE_LENGTH = 4000;

/* -------------------------------- resolution --------------------------------- */

/**
 * Does this (kind, slug) name something that actually exists?
 *
 * The database cannot answer this — lessons and articles are compiled
 * TypeScript, so there is no foreign key to lean on. This is the check that
 * stands in for one, and it runs on every write. Without it the table would
 * happily accumulate rows for slugs that never existed or have since been
 * renamed, and the reader's "saved" list would quietly fill with dead entries
 * that 404 when tapped.
 */
export function itemExists(kind: PersonalItemKind, slug: string): boolean {
  if (kind === "lesson") return Boolean(getLessonMeta(slug));
  return Boolean(getArticle(slug));
}

/**
 * Where the item lives.
 *
 * Articles delegate to `articleHref` rather than assuming a prefix: one corpus
 * feeds the Help Center and the Trust Center, and hardcoding `/trust/` here
 * would rebuild the duplicate-canonical bug that fix removed — this time as a
 * saved list pointing half its entries at 404s.
 */
export function itemHref(kind: PersonalItemKind, slug: string): string | null {
  if (kind === "lesson") return getLessonMeta(slug) ? `/learn/${slug}` : null;
  const article = getArticle(slug);
  return article ? articleHref(article) : null;
}

/** Human title, for the reader's own saved and completed lists. */
export function itemTitle(kind: PersonalItemKind, slug: string): string | null {
  if (kind === "lesson") return getLessonMeta(slug)?.title ?? null;
  return getArticle(slug)?.title ?? null;
}

/**
 * Drop entries whose item no longer exists.
 *
 * Content gets renamed and retired; the rows referencing it do not vanish. This
 * runs on read so a stale row degrades to being invisible rather than to a
 * broken link, and the row itself is left alone — deleting a reader's note
 * because we renamed a slug would be the worse failure.
 */
export function resolvableItems(items: PersonalItemState[]): PersonalItemState[] {
  return items.filter((item) => itemExists(item.kind, item.slug));
}

/* ---------------------------------- progress ---------------------------------- */

export interface CourseProgress {
  /** Lessons in the course that resolve to real, published lessons. */
  total: number;
  completed: number;
  /** 0–1. Zero when the course has no resolvable lessons, never NaN. */
  fraction: number;
}

/**
 * Progress through one course, from the reader's completed lesson slugs.
 *
 * Counts against the course's RESOLVABLE lessons rather than its declared list.
 * If a course names a lesson that no longer exists, the honest denominator is
 * what a reader can actually finish — otherwise the last 10% becomes unreachable
 * and a completed course never reports as complete, which is precisely the kind
 * of quietly-broken progress bar people stop trusting.
 */
export function courseProgress(courseSlug: string, completedLessons: Set<string>): CourseProgress {
  // `courseLessons` already drops slugs that resolve to nothing, so this is
  // the resolvable set by construction.
  const lessons = courseLessons(courseSlug);
  const total = lessons.length;
  if (total === 0) return { total: 0, completed: 0, fraction: 0 };

  const completed = lessons.filter((lesson) => completedLessons.has(lesson?.slug ?? "")).length;
  return { total, completed, fraction: completed / total };
}

/** Completed lesson slugs, as a set — what `courseProgress` consumes. */
export function completedLessonSlugs(items: PersonalItemState[]): Set<string> {
  return new Set(
    items.filter((item) => item.kind === "lesson" && item.completedAt).map((item) => item.slug),
  );
}
