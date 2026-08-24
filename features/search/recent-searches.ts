/**
 * Recent searches — this device only.
 *
 * 🔴 DELIBERATELY NOT SERVER-SIDE. Migration 0113 spells out why a search log
 * is one of the most revealing datasets a social product can hold, and stores
 * discovery analytics as an anonymous daily counter for exactly that reason.
 * A per-user "things you searched for" table would undo that decision for a
 * feature whose whole value is convenience. localStorage keeps it on the
 * device that typed it, where the user can clear it in one tap.
 */

const KEY = "frenz:recent-searches";
const MAX = 8;

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === "string" && !!t.trim()).slice(0, MAX);
  } catch {
    return [];
  }
}

function write(terms: string[]): string[] {
  const next = terms.slice(0, MAX);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — the list is a convenience, never load-bearing */
  }
  return next;
}

export function readRecentSearches(): string[] {
  return read();
}

/** Most-recent-first, case-insensitively de-duplicated. */
export function pushRecentSearch(term: string): string[] {
  const trimmed = term.trim();
  if (!trimmed) return read();
  const lower = trimmed.toLowerCase();
  return write([trimmed, ...read().filter((t) => t.toLowerCase() !== lower)]);
}

export function removeRecentSearch(term: string): string[] {
  const lower = term.toLowerCase();
  return write(read().filter((t) => t.toLowerCase() !== lower));
}

export function clearRecentSearches(): string[] {
  return write([]);
}
