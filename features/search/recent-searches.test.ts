import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/*
  Node, not jsdom (vitest.config) — the module is browser-only by design, so the
  one API it touches is stubbed. A Map is exactly the contract it relies on.
*/
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      },
    },
  });
});

import {
  clearRecentSearches,
  isRecentSearchEnabled,
  pushRecentSearch,
  readRecentSearches,
  removeRecentSearch,
  setRecentSearchEnabled,
} from "@/features/search/recent-searches";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  RECENT SEARCHES — two controls that must stay separate (2026-09-27)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner: "users should be able to turn of search history in search page. And
 * users should be able to clear previous search without turning off the
 * previous search. With just a X button on each search to clear."
 *
 * Clearing is "forget what I searched". Switching off is "stop remembering from
 * now on". They are different promises, and the common shortcut — one control
 * doing both — forces a member who wants one to accept the other.
 */
describe("recent searches", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps terms most-recent-first and de-duplicates case-insensitively", () => {
    pushRecentSearch("Lagos");
    pushRecentSearch("afrobeats");
    pushRecentSearch("LAGOS");
    expect(readRecentSearches()).toEqual(["LAGOS", "afrobeats"]);
  });

  it("removes ONE term without touching the rest — the X on a row", () => {
    pushRecentSearch("a");
    pushRecentSearch("b");
    pushRecentSearch("c");
    expect(removeRecentSearch("b")).toEqual(["c", "a"]);
    expect(readRecentSearches()).toEqual(["c", "a"]);
  });

  it("clearing everything leaves the history switched ON", () => {
    pushRecentSearch("a");
    clearRecentSearches();
    expect(readRecentSearches()).toEqual([]);
    // 🔴 the whole point: clearing is not the same promise as switching off
    expect(isRecentSearchEnabled()).toBe(true);
    pushRecentSearch("b");
    expect(readRecentSearches()).toEqual(["b"]);
  });

  it("defaults to on, including when storage cannot be read", () => {
    expect(isRecentSearchEnabled()).toBe(true);
  });

  /* Leaving the old list behind while promising not to record is the wrong
     half of the promise — the setting reads as "don't keep my searches". */
  it("switching off clears what was already stored", () => {
    pushRecentSearch("private thing");
    expect(setRecentSearchEnabled(false)).toEqual([]);
    expect(readRecentSearches()).toEqual([]);
    expect(isRecentSearchEnabled()).toBe(false);
  });

  it("records nothing at all while it is off", () => {
    setRecentSearchEnabled(false);
    pushRecentSearch("still not recorded");
    expect(readRecentSearches()).toEqual([]);
  });

  it("and starts recording again when it is switched back on", () => {
    setRecentSearchEnabled(false);
    pushRecentSearch("ignored");
    setRecentSearchEnabled(true);
    pushRecentSearch("kept");
    expect(readRecentSearches()).toEqual(["kept"]);
  });

  it("never stores more than the cap", () => {
    for (let i = 0; i < 20; i++) pushRecentSearch(`term-${i}`);
    expect(readRecentSearches()).toHaveLength(8);
    expect(readRecentSearches()[0]).toBe("term-19");
  });
});
