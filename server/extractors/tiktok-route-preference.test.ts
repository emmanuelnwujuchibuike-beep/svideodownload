import { describe, expect, it } from "vitest";

import type { VideoMetadata } from "@/types";

import { preferTikWm } from "./tiktok";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE TIKTOK ROUTE PREFERENCE — the fix for the 2026-09-28 download outage
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every TikTok VIDEO download answered 502 while audio worked. The cause was not
 * extraction failing — metadata was fine — it was extraction SUCCEEDING via the
 * wrong route:
 *
 *   TikWM   formats point at TikWM's own re-encode  → download works
 *   native  formats point at TikTok's CDN, which 403s without the page's
 *           session cookie                          → download 502s
 *
 * `Promise.any` handed over whichever answered first, so once TikWM slowed down
 * (its free tier allows one request per second), native started winning and
 * every video download broke. Measured on production the same day:
 *
 *   canonical URL → native → download 502
 *   short link    → TikWM  → download 200, 6.8 MB
 *
 * These tests are the teeth on the rule. The first one FAILS against a plain
 * `Promise.any`, which is the code this replaced.
 */

const meta = (route: string): VideoMetadata =>
  ({
    id: route,
    platform: "tiktok",
    platformName: "TikTok",
    sourceUrl: "https://www.tiktok.com/@a/video/1",
    title: route,
    description: null,
    thumbnail: null,
    durationSeconds: 5,
    creator: null,
    uploadDate: null,
    viewCount: null,
    likeCount: null,
    webpageUrl: "https://www.tiktok.com/@a/video/1",
    formats: [],
    extractor: "tiktok",
  }) as unknown as VideoMetadata;

const TIKWM = meta("tikwm");
const NATIVE = meta("native");

const after = <T>(ms: number, value: T): Promise<T> => new Promise((r) => setTimeout(() => r(value), ms));
const failsAfter = (ms: number, why = "no"): Promise<never> => new Promise((_, rej) => setTimeout(() => rej(new Error(why)), ms));

describe("TikTok — TikWM is preferred over native (the 502 download fix)", () => {
  it("🔴 native answering FIRST does not win: TikWM is waited for inside the grace window", async () => {
    // This is the exact shape of the outage — and the assertion a plain
    // `Promise.any` fails, because it would return NATIVE here.
    const result = await preferTikWm(after(60, TIKWM), after(5, NATIVE), 500);
    expect(result).toBe(TIKWM);
  });

  it("TikWM answering first is used immediately", async () => {
    const result = await preferTikWm(after(5, TIKWM), after(60, NATIVE), 500);
    expect(result).toBe(TIKWM);
  });

  it("native IS used when TikWM cannot answer at all — it is still a real fallback", async () => {
    const result = await preferTikWm(failsAfter(5, "TikWM returned no usable media"), after(10, NATIVE), 500);
    expect(result).toBe(NATIVE);
  });

  it("native is used when TikWM misses the grace window — a bounded wait, not an unbounded one", async () => {
    const started = Date.now();
    const result = await preferTikWm(after(5_000, TIKWM), after(5, NATIVE), 80);
    expect(result).toBe(NATIVE);
    // The whole point of the window: we do not wait out TikWM's full timeout.
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("both routes failing still rejects, so the caller can fall back to yt-dlp", async () => {
    await expect(preferTikWm(failsAfter(5, "tikwm"), failsAfter(10, "native"), 500)).rejects.toBeInstanceOf(AggregateError);
  });

  it("a grace window of zero degrades to 'native wins', not to a hang", async () => {
    const result = await preferTikWm(after(50, TIKWM), after(1, NATIVE), 0);
    expect(result).toBe(NATIVE);
  });
});
