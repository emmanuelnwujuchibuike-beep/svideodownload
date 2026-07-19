import { coursesForSchool } from "@/lib/academy/courses";
import { teachableSchools } from "@/lib/academy/schools";
import { LESSON_CATALOG } from "@/lib/learning/catalog";
import { ALL_PAGES } from "@/lib/seo/seo-pages";
import { SUPPORT_ARTICLES } from "@/lib/support/articles";
import { GLOSSARY } from "@/lib/support/glossary";
import { sectionMeta } from "@/lib/support/sections";

/**
 * Unified search index — one corpus across the Academy, Trust Center, guides and
 * the generated downloader pages.
 *
 * ── A build-time index, not a search service ──────────────────────────────────
 *
 * The obvious answer is a hosted search backend. For a corpus of a few hundred
 * short documents that would add a network hop, an API key, a cost centre and an
 * outage mode to something that can be a static file.
 *
 * The whole index is a few tens of kB. It ships as a static chunk, loads once,
 * and then searches at zero latency — offline, on a bad connection in Lagos, with
 * no origin round-trip. It also cannot leak, because it contains only public
 * content: the personal plane (progress, bookmarks) is deliberately absent, so
 * there is no path by which one visitor's index could describe another.
 *
 * ── Availability is inherited, not re-derived ─────────────────────────────────
 *
 * Schools come from `teachableSchools()` and products from the claimable set, so
 * a planned school cannot appear in results. This module makes no judgement of
 * its own about what is real — re-deriving that here would be a second opinion
 * that could disagree with the first.
 */

export type SearchKind = "lesson" | "school" | "course" | "trust" | "downloader" | "term";

export interface SearchDoc {
  id: string;
  kind: SearchKind;
  title: string;
  /** One line shown under the title in results. */
  summary: string;
  href: string;
  /** Section/school label, shown as a result's context. */
  group: string;
  /**
   * Extra terms people actually search for that are absent from the title.
   * Kept short — this is a matching aid, not a body index.
   */
  keywords: string[];
  /**
   * Base rank, before query relevance.
   *
   * Ordering by kind is a real editorial decision: someone typing "download" is
   * far more often looking for the tool than for a lesson about it, and someone
   * typing "delete my account" needs the trust article and nothing else.
   */
  weight: number;
}

const WEIGHT: Record<SearchKind, number> = {
  trust: 10, // people searching these are usually mid-problem
  downloader: 9, // the product itself
  /*
    Above lessons: someone typing a bare jargon word ("bitrate") wants to know
    what it means. Someone wanting to learn the subject types a question, and the
    query-shape difference sorts them out without the ranker needing to guess.
  */
  term: 8,
  lesson: 7,
  school: 6,
  course: 5,
};

/**
 * Builds the index. Pure and synchronous — runs at module load on a static build
 * and is reused for every render, costing nothing against the page budget.
 */
export function buildSearchIndex(): SearchDoc[] {
  const docs: SearchDoc[] = [];

  for (const article of SUPPORT_ARTICLES) {
    docs.push({
      id: `trust:${article.slug}`,
      kind: "trust",
      title: article.title,
      summary: article.summary,
      href: `/trust/${article.slug}`,
      group: sectionMeta(article.section).name,
      keywords: [],
      weight: WEIGHT.trust,
    });
  }

  for (const term of GLOSSARY) {
    docs.push({
      id: `term:${term.slug}`,
      kind: "term",
      title: term.term,
      summary: term.definition,
      href: `/glossary#${term.slug}`,
      group: "Glossary",
      // Aliases ARE the search terms — someone types "srt" far more often than
      // "sidecar captions", and without these that query finds nothing.
      keywords: term.aliases,
      weight: WEIGHT.term,
    });
  }

  for (const lesson of LESSON_CATALOG) {
    docs.push({
      id: `lesson:${lesson.slug}`,
      kind: "lesson",
      title: lesson.title,
      summary: lesson.description,
      href: `/learn/${lesson.slug}`,
      group: "Guides",
      keywords: [lesson.topic],
      weight: WEIGHT.lesson,
    });
  }

  for (const school of teachableSchools()) {
    docs.push({
      id: `school:${school.id}`,
      kind: "school",
      title: school.name,
      summary: school.tagline,
      href: `/academy/${school.slug}`,
      group: "Academy",
      keywords: [],
      weight: WEIGHT.school,
    });

    for (const course of coursesForSchool(school.id)) {
      docs.push({
        id: `course:${course.slug}`,
        kind: "course",
        title: course.title,
        summary: course.description,
        // A course has no page of its own — it renders inside its school. Same
        // fact the entity registry encodes by giving courses no canonical.
        href: `/academy/${school.slug}`,
        group: school.name,
        keywords: [],
        weight: WEIGHT.course,
      });
    }
  }

  for (const page of ALL_PAGES) {
    docs.push({
      id: `downloader:${page.slug}`,
      kind: "downloader",
      title: page.title,
      summary: page.tagline,
      href: `/${page.slug}`,
      group: page.brand,
      // The keyword fields are exactly what someone types into a search box, so
      // they matter more here than anywhere else in the corpus.
      keywords: [page.primaryKeyword, ...page.secondaryKeywords],
      weight: WEIGHT.downloader,
    });
  }

  return docs;
}

export const SEARCH_INDEX: SearchDoc[] = buildSearchIndex();

/* ---------------------------------- querying --------------------------------- */

/**
 * Words carrying no discriminating power in a corpus this small.
 *
 * Deliberately short. An aggressive stopword list starts removing terms that
 * genuinely matter — "how" is noise in "how do I delete my account" but load-
 * bearing in a corpus of "How to…" titles, so it stays. Only words that appear
 * in essentially every English sentence are listed.
 */
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "my",
  "your",
  "me",
  "i",
  "is",
  "are",
  "do",
  "does",
  "to",
  "of",
  "in",
  "on",
  "for",
  "and",
  "or",
  "it",
  "this",
  "that",
  "can",
]);

/**
 * Crude suffix stripper, so a query and the prose match on the same word.
 *
 * Substring matching cannot do this: `"deleting".includes("delete")` is FALSE,
 * because the shared part stops at "delet". So "delete my account" scored zero
 * against an article whose summary literally says "Deleting your account starts
 * a 30-day countdown" — the single most important query in the trust corpus,
 * matching nothing.
 *
 * Deliberately not a real stemmer (no Porter, no library). This corpus is a few
 * hundred short documents; the suffixes below cover the plural/gerund/past
 * variation that actually occurs between how people type and how we write, and
 * a full stemmer would add a dependency and new failure modes to solve a problem
 * these four rules already solve.
 *
 * The minimum length guard stops it mangling short words — without it "does"
 * becomes "do" and "us" becomes "u".
 */
function stem(word: string): string {
  if (word.length <= 4) return word;
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return trimTrailingE(word.slice(0, -suffix.length));
    }
  }
  return trimTrailingE(word);
}

/** "delete" → "delet", so it meets "deleting" → "delet". */
function trimTrailingE(word: string): string {
  return word.length > 3 && word.endsWith("e") ? word.slice(0, -1) : word;
}

/** Every stem in a block of already-normalised text. */
function stems(text: string): Set<string> {
  return new Set(text.split(/\s+/).filter(Boolean).map(stem));
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    // Strip diacritics so "francais" finds "Français". Without this a visitor
    // typing on a keyboard without accents silently gets no results.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .trim();
}

/**
 * Scores one document against a query.
 *
 * Tiered rather than fuzzy: an exact title match must always beat a keyword
 * brush, and a fuzzy matcher on a corpus this small mostly produces confident
 * wrong answers. Returns 0 for no match so callers can filter.
 */
export function score(doc: SearchDoc, query: string): number {
  const q = normalise(query);
  if (!q) return 0;

  const title = normalise(doc.title);
  const summary = normalise(doc.summary);
  const keywords = doc.keywords.map(normalise);

  let points = 0;

  if (title === q) points += 100;
  else if (title.startsWith(q)) points += 60;
  else if (title.includes(q)) points += 40;

  if (keywords.some((k) => k === q)) points += 50;
  else if (keywords.some((k) => k.includes(q))) points += 20;

  if (summary.includes(q)) points += 10;

  /*
    Every MEANINGFUL word must appear somewhere. Requiring all terms is what keeps
    "tiktok audio" from returning every TikTok page — an any-term match makes a
    two-word query broader than a one-word query, which is the opposite of what
    the person typing it expects.

    Stopwords are removed first, and that is not a refinement — without it the
    rule is actively broken. "delete my account" returned ZERO results, because
    "my" appears in no title, summary or keyword and the all-terms rule then
    rejected every document. People search in natural language, especially when
    something has gone wrong and they are typing the sentence in their head, so
    the queries this broke were exactly the ones that matter most.
  */
  const terms = q.split(/\s+/).filter((t) => t && !STOPWORDS.has(t));
  if (terms.length > 1) {
    const haystack = stems(`${title} ${summary} ${keywords.join(" ")}`);
    if (terms.every((t) => haystack.has(stem(t)))) points += 25;
    else if (points === 0) return 0;
  }

  return points > 0 ? points + doc.weight : 0;
}

export interface SearchResult extends SearchDoc {
  score: number;
}

export function search(query: string, limit = 8): SearchResult[] {
  return SEARCH_INDEX.map((doc) => ({ ...doc, score: score(doc, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}
