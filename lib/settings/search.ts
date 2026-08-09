import { getCategory } from "./categories";
import { SETTINGS, settingRank, type SettingEntry } from "./registry";

/**
 * Smart Settings Search™ — ranked, synonym-aware, instant (Part 21).
 *
 * ── Why this is not a vector index ───────────────────────────────────────────
 * The brief asks for "instant semantic search … using everyday language rather
 * than exact menu names". An embedding index would mean a model, a network
 * request per keystroke, and a cache — for a corpus of roughly 200 short
 * strings that fits in a few kilobytes of the bundle already loaded.
 *
 * The everyday language lives in each entry's `keywords` instead. That is not a
 * downgrade, it is a different trade with better properties here: synonyms are
 * DATA. They are reviewable in a diff, correct by construction, and they cannot
 * drift. "2fa" finds two-factor authentication because somebody wrote that
 * down — not because a model happened to place them nearby.
 *
 * The honest limit: it cannot answer a phrasing nobody anticipated. When a
 * search returns nothing the UI says so and offers the category list, rather
 * than pretending the setting does not exist.
 *
 * Pure — no React, no I/O — so every ranking rule below is directly testable.
 */

export interface SearchHit {
  entry: SettingEntry;
  /** Higher is better. Only meaningful relative to other hits. */
  score: number;
  /** Which field matched — the UI explains WHY a result is there. */
  matchedOn: "label" | "keyword" | "description" | "category";
}

/**
 * Score bands, widely spaced on purpose.
 *
 * A gap of 100 between bands means no amount of within-band tie-breaking can
 * ever promote a description match above a label match. Adjacent numbers would
 * make the ordering depend on the tie-breaker, which is exactly how "why is
 * that the top result?" happens.
 */
const EXACT_LABEL = 600;
const LABEL_PREFIX = 500;
const EXACT_KEYWORD = 400;
const LABEL_SUBSTRING = 300;
const KEYWORD_SUBSTRING = 200;
const DESCRIPTION = 100;
const CATEGORY = 50;

/** Lowercase, collapse whitespace, drop punctuation people type but do not mean. */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Score one entry against one normalised query, or null for no match.
 *
 * Every band is checked and the BEST is kept — an entry whose label contains the
 * query and whose keyword matches it exactly should rank on the keyword, not on
 * whichever test happened to run first.
 */
function scoreEntry(entry: SettingEntry, q: string): SearchHit | null {
  const label = normalise(entry.label);
  const description = normalise(entry.description);
  const category = normalise(getCategory(entry.category)?.label ?? "");

  let best = 0;
  let matchedOn: SearchHit["matchedOn"] = "label";

  const take = (score: number, on: SearchHit["matchedOn"]) => {
    if (score > best) {
      best = score;
      matchedOn = on;
    }
  };

  if (label === q) take(EXACT_LABEL, "label");
  else if (label.startsWith(q)) take(LABEL_PREFIX, "label");
  else if (label.includes(q)) take(LABEL_SUBSTRING, "label");

  for (const raw of entry.keywords) {
    const k = normalise(raw);
    if (k === q) take(EXACT_KEYWORD, "keyword");
    else if (k.includes(q) || q.includes(k)) take(KEYWORD_SUBSTRING, "keyword");
  }

  if (description.includes(q)) take(DESCRIPTION, "description");
  if (category.includes(q)) take(CATEGORY, "category");

  if (best === 0) return null;

  /*
    A small, BOUNDED nudge for settings a member can actually change.

    Someone searching for "download quality" wants the control, not the note
    explaining it does not exist yet. +10 orders live above planned WITHIN a
    band and can never cross one — a planned exact-label match still outranks a
    live description match, which is right: the exact thing they named comes
    first even if it is not built.
  */
  if (entry.status === "live") best += 10;

  return { entry, score: best, matchedOn };
}

/**
 * Search every declared setting.
 *
 * Multi-word queries are ANDed across terms and the per-term scores summed, so
 * "dark mode" beats an entry that matches only "mode". Summing rather than
 * taking the max is what makes a two-word query prefer the entry that answers
 * both halves.
 */
export function searchSettings(query: string, limit = 12): SearchHit[] {
  const terms = normalise(query).split(" ").filter(Boolean);
  if (terms.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const entry of SETTINGS) {
    let total = 0;
    let matchedOn: SearchHit["matchedOn"] = "label";
    let matchedEvery = true;

    for (const term of terms) {
      const hit = scoreEntry(entry, term);
      if (!hit) {
        matchedEvery = false;
        break;
      }
      total += hit.score;
      // Report the STRONGEST field across the terms — that is the one worth
      // explaining to the reader.
      if (hit.score >= total - hit.score) matchedOn = hit.matchedOn;
    }

    /*
      Every term must match SOMETHING on the entry. Requiring all terms is what
      keeps "blocked users" from returning every setting containing "users";
      a query that finds nothing is a better answer than a list that ignores
      half of what was typed.
    */
    if (matchedEvery && total > 0) hits.push({ entry, score: total, matchedOn });
  }

  return hits
    .sort((a, b) => b.score - a.score || settingRank(a.entry) - settingRank(b.entry))
    .slice(0, limit);
}

/**
 * Settings that change what OTHER people can see or do.
 *
 * Surfaced separately because a privacy control that reads like a cosmetic
 * toggle is how people share more than they intended.
 */
export function privacyRelevant(): SettingEntry[] {
  return SETTINGS.filter((s) => s.affectsOthers).sort((a, b) => settingRank(a) - settingRank(b));
}
