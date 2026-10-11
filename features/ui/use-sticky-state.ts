"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * State that survives a cached remount (owner, 2026-10-11: "nothing should
 * reload on backswipe or on every entry").
 *
 * The router cache (next.config `staleTimes.dynamic`, 6 h) replays a page's
 * ORIGINAL server payload when the member swipes back or re-enters it. That is
 * what makes it instant, but a page that changed things on the tap would then
 * show the old state again until the cache expired. This keeps the latest
 * value in memory per page, tied to the payload it started from:
 *
 *   same payload (`base` unchanged)  → the member's latest value comes back
 *   a fresh server payload           → the fresh one wins
 *
 * Module memory only: nothing is written to storage, nothing runs in the
 * background, and a full reload starts clean.
 */
const memory = new Map<string, { base: string | number; value: unknown }>();

export function useStickyState<T>(key: string, base: string | number, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const m = memory.get(key);
    return m && m.base === base ? (m.value as T) : initial;
  });
  const ref = useRef({ key, base });
  ref.current = { key, base };
  useEffect(() => {
    memory.set(ref.current.key, { base: ref.current.base, value });
  }, [value]);
  const set = useCallback<Dispatch<SetStateAction<T>>>((next) => setValue(next), []);
  return [value, set];
}
