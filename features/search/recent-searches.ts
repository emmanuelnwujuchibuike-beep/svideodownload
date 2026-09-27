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
  // the switch is checked HERE, at the one place that writes, so no caller can forget it
  if (!isRecentSearchEnabled()) return [];
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

/**
 * ── TURNING THE HISTORY OFF (owner, 2026-09-27) ────────────────────────────
 *
 * "users should be able to turn of search history in search page. And users
 * should be able to clear previous search without turning off the previous
 * search."
 *
 * Two separate controls, deliberately: clearing is "forget what I searched",
 * switching off is "stop remembering from now on". Conflating them — the
 * common shortcut — means a member who wants one has to accept the other.
 *
 * Switching OFF also clears what is already stored. Leaving the old list
 * behind while promising not to record would be the wrong half of the promise:
 * the setting reads as "don't keep my searches", not "keep the old ones".
 *
 * Defaults to ON, and a device that cannot read the preference is treated as
 * ON — the list is a convenience and failing closed here would silently break
 * it for anyone in private mode.
 */
const PREF_KEY = "frenz:recent-searches-enabled";

export function isRecentSearchEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Returns the list as it stands afterwards — empty when switching off. */
export function setRecentSearchEnabled(on: boolean): string[] {
  try {
    window.localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    /* private mode — the preference simply does not persist */
  }
  return on ? read() : clearRecentSearches();
}
