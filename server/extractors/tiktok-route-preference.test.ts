import { describe, expect, it } from "vitest";

import type { VideoMetadata } from "@/types";

import { preferTikTokRoute } from "./tiktok";

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
 * 2026-10-08: native's formats now carry the page cookies and download, and
 * native's CDN delivers the file far faster than TikWM's host (measured 2 s vs
 * 29 s), so the rule became: VIDEO → native preferred; PHOTO → TikWM preferred
 * (only TikWM reports Live Photo slides). See `preferTikTokRoute`.
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
const photo = (route: string): VideoMetadata =>
  ({ ...meta(route), formats: [{ formatId: "img-0", kind: "image" }] }) as unknown as VideoMetadata;
const TIKWM_PHOTO = photo("tikwm-photo");
const NATIVE_PHOTO = photo("native-photo");

const after = <T>(ms: number, value: T): Promise<T> => new Promise((r) => setTimeout(() => r(value), ms));
const failsAfter = (ms: number, why = "no"): Promise<never> => new Promise((_, rej) => setTimeout(() => rej(new Error(why)), ms));

describe("TikTok — native leads for video, TikWM for photos (2026-10-08)", () => {
  it("video: native answering first wins at once — no waiting for TikWM", async () => {
    const started = Date.now();
    const result = await preferTikTokRoute(after(2_000, TIKWM), after(5, NATIVE), 500);
    expect(result).toBe(NATIVE);
    expect(Date.now() - started).toBeLessThan(400);
  });

  it("video: TikWM answering first waits the grace window for native (the faster file)", async () => {
    const result = await preferTikTokRoute(after(5, TIKWM), after(60, NATIVE), 500);
    expect(result).toBe(NATIVE);
  });

  it("video: native missing the grace window → TikWM, after a BOUNDED wait", async () => {
    const started = Date.now();
    const result = await preferTikTokRoute(after(5, TIKWM), after(5_000, NATIVE), 80);
    expect(result).toBe(TIKWM);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("native failing outright (a WAF page) → TikWM is still a real fallback", async () => {
    const result = await preferTikTokRoute(after(10, TIKWM), failsAfter(5, "waf"), 500);
    expect(result).toBe(TIKWM);
  });

  it("photo: native first still waits for TikWM — only TikWM reads Live Photos", async () => {
    const result = await preferTikTokRoute(after(60, TIKWM_PHOTO), after(5, NATIVE_PHOTO), 500);
    expect(result).toBe(TIKWM_PHOTO);
  });

  it("photo: TikWM first is used at once", async () => {
    const result = await preferTikTokRoute(after(5, TIKWM_PHOTO), after(60, NATIVE_PHOTO), 500);
    expect(result).toBe(TIKWM_PHOTO);
  });

  it("both routes failing still rejects, so the caller can fall back to yt-dlp", async () => {
    await expect(preferTikTokRoute(failsAfter(5, "tikwm"), failsAfter(10, "native"), 500)).rejects.toBeInstanceOf(AggregateError);
  });
});
