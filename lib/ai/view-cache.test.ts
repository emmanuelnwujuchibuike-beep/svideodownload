import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
  🔴 THIS SUITE RUNS IN NODE, ON PURPOSE (see vitest.config: no jsdom). The
  module under test is browser-only by design — it reads `window.localStorage`
  and dispatches a window event — so the browser surface it touches is stubbed
  here rather than pulling a DOM implementation into a fast unit suite. The
  stub is deliberately dumb: a Map and an EventTarget, which is exactly the
  contract the module relies on.
*/
beforeAll(() => {
  const store = new Map<string, string>();
  const target = new EventTarget();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage,
      dispatchEvent: (e: Event) => target.dispatchEvent(e),
      addEventListener: (t: string, l: EventListener) => target.addEventListener(t, l),
      removeEventListener: (t: string, l: EventListener) => target.removeEventListener(t, l),
    },
  });
});

import { AI_REFRESH_EVENT, clearAiViewCache, dropAiViewCache, readAiViewCache, requestAiRefresh, writeAiViewCache } from "@/lib/ai/view-cache";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SNAPSHOT THAT STOPS AN AI PAGE RELOADING (owner, 2026-09-27)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "back swipe and return in the all the Ai pages never reload or load after
 * first load, users can revalidate only by swiping down from the top."
 *
 * The router cache was never the problem — `staleTimes.dynamic` is already six
 * hours. What reloaded was the CLIENT: React unmounts a route's tree on
 * navigation, so every fetch-on-mount ran again on the way back. These pin the
 * storage rules; the hook that uses them is features/ai/core/use-cached-view.ts.
 */
describe("the AI view cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("gives back exactly what was written, with when", () => {
    writeAiViewCache("tta-config", { voices: 3 });
    const snap = readAiViewCache<{ voices: number }>("tta-config");
    expect(snap?.value).toEqual({ voices: 3 });
    expect(typeof snap?.at).toBe("number");
  });

  it("keys are separate — one page's answer is never another's", () => {
    writeAiViewCache("audio-library", ["a"]);
    writeAiViewCache("voice-library", ["b"]);
    expect(readAiViewCache<string[]>("audio-library")?.value).toEqual(["a"]);
    expect(readAiViewCache<string[]>("voice-library")?.value).toEqual(["b"]);
  });

  it("answers null for a key never written", () => {
    expect(readAiViewCache("nothing-here")).toBeNull();
  });

  /* A day's TTL is the backstop behind sign-out — a snapshot is a member's own. */
  it("forgets a snapshot older than the TTL, and removes it", () => {
    vi.useFakeTimers();
    writeAiViewCache("tta-config", { v: 1 });
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    expect(readAiViewCache("tta-config")).toBeNull();
    expect(window.localStorage.getItem("frenzsave_ai_view_v1:tta-config")).toBeNull();
  });

  it("survives junk in storage rather than throwing into a render", () => {
    window.localStorage.setItem("frenzsave_ai_view_v1:broken", "{not json");
    expect(readAiViewCache("broken")).toBeNull();
    window.localStorage.setItem("frenzsave_ai_view_v1:shapeless", JSON.stringify({ hello: 1 }));
    expect(readAiViewCache("shapeless")).toBeNull();
  });

  it("drops one key without touching its neighbours", () => {
    writeAiViewCache("a", 1);
    writeAiViewCache("b", 2);
    dropAiViewCache("a");
    expect(readAiViewCache("a")).toBeNull();
    expect(readAiViewCache<number>("b")?.value).toBe(2);
  });

  /* 🔴 On sign-out every AI snapshot goes: they are the session's, and a shared
     device must not show the last member's library to the next one. */
  it("clears every AI snapshot on sign-out and leaves other storage alone", () => {
    writeAiViewCache("tta-config", 1);
    writeAiViewCache("voice-library", 2);
    window.localStorage.setItem("something_else", "keep me");
    clearAiViewCache();
    expect(readAiViewCache("tta-config")).toBeNull();
    expect(readAiViewCache("voice-library")).toBeNull();
    expect(window.localStorage.getItem("something_else")).toBe("keep me");
  });

  it("the pull fires the one event the cached pages listen for", () => {
    const heard = vi.fn();
    window.addEventListener(AI_REFRESH_EVENT, heard);
    requestAiRefresh();
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(AI_REFRESH_EVENT, heard);
  });
});
