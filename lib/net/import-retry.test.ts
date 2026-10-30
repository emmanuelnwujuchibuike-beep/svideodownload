import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { importWithRetry } from "@/lib/net/import-retry";

/**
 * Reels "enters but then reload even if the video is already loaded and playing" (owner, 2026-10-30): a lazy chunk the
 * deck asks for a moment after it opens failed once — iOS drops the first requests after a resume — and the error
 * screen reloaded the page. It is asked for again first.
 */
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("importWithRetry", () => {
  it("a chunk that fails once (a dropped request after a resume) still arrives — no error, so no reload", async () => {
    let calls = 0;
    const load = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("Importing a module script failed.");
      return { ReelsFeed: "ok" };
    });
    const p = importWithRetry(load);
    await vi.advanceTimersByTimeAsync(400);
    await expect(p).resolves.toEqual({ ReelsFeed: "ok" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("asks again after 400 ms, then 800 ms — three tries in all", async () => {
    const load = vi.fn(async () => {
      throw new Error("ChunkLoadError");
    });
    const p = importWithRetry(load);
    const settled = p.catch((e: Error) => e.message);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(399);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(800);
    expect(load).toHaveBeenCalledTimes(3);
    // teeth: a chunk that is really gone (a deploy replaced it) still fails — the error screen's reload is the cure
    await expect(settled).resolves.toBe("ChunkLoadError");
  });

  it("the Reels path loads every lazy part through it", () => {
    for (const f of ["features/feed/reel-viewer.tsx", "features/feed/smart-feed.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/dynamic\(\(\) => import\(/);
      expect((src.match(/dynamic\(\(\) => importWithRetry\(\(\) => import\(/g) ?? []).length, f).toBeGreaterThan(0);
    }
  });
});
