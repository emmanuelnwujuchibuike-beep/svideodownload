import { describe, expect, it } from "vitest";

import { klingTextToVideo } from "@/lib/ai/kling/features/text-to-video";
import { KLING_PRICING_DEFAULTS, ONE_MINUTE_SEGMENTS, quoteKling, type KlingPricingConfig } from "@/lib/ai/kling/pricing";
import { textToVideoInputSchema } from "@/lib/ai/video/schemas";
import { readChain } from "@/server/services/ai-video-chain";

/** Owner, 2026-10-06: a 60 s option only, its own price, set in admin. */
const paid = (over: Partial<KlingPricingConfig> = {}): KlingPricingConfig => ({
  ...KLING_PRICING_DEFAULTS,
  oneMinute: { enabled: true, priceUsdCents: { "720p": 0, "1080p": 0 } },
  matrix: { ...KLING_PRICING_DEFAULTS.matrix, "text_to_video:720p": { ...KLING_PRICING_DEFAULTS.matrix["text_to_video:720p"], priceUsdCentsPerSecond: 12 } },
  ...over,
});

describe("one-minute videos", () => {
  it("ship OFF until switched on in admin", () => {
    expect(KLING_PRICING_DEFAULTS.oneMinute.enabled).toBe(false);
    expect(quoteKling(KLING_PRICING_DEFAULTS, { feature: "text_to_video", resolution: "720p", seconds: 60 }).ok).toBe(false);
  });

  it("are four 15 s segments", () => expect(ONE_MINUTE_SEGMENTS).toBe(4));

  it("default to 60 × the per-second price, or the admin's own price when set", () => {
    const q = quoteKling(paid(), { feature: "text_to_video", resolution: "720p", seconds: 60 });
    expect(q.ok && q.totalUsdCents).toBe(720);
    const own = quoteKling(paid({ oneMinute: { enabled: true, priceUsdCents: { "720p": 599, "1080p": 0 } } }), { feature: "text_to_video", resolution: "720p", seconds: 60 });
    expect(own.ok && own.totalUsdCents).toBe(599);
  });

  it("are refused when switched off, at 4k, or with a reference video", () => {
    expect(quoteKling(paid({ oneMinute: { enabled: false, priceUsdCents: { "720p": 0, "1080p": 0 } } }), { feature: "text_to_video", resolution: "720p", seconds: 60 }).ok).toBe(false);
    expect(quoteKling(paid(), { feature: "text_to_video", resolution: "4k", seconds: 60 }).ok).toBe(false);
    expect(quoteKling(paid(), { feature: "text_to_video", resolution: "720p", seconds: 60, referenceVideo: true }).ok).toBe(false);
  });

  it("only exactly 60 is accepted above 15 — not 30, not 45", () => {
    const parse = (d: number) => textToVideoInputSchema.safeParse({ prompt: "x", options: { durationSeconds: d, aspectRatio: "16:9" } }).success;
    expect(parse(60)).toBe(true);
    expect(parse(15)).toBe(true);
    expect(parse(30)).toBe(false);
    expect(parse(45)).toBe(false);
    expect(klingTextToVideo.validate({ prompt: "x", options: { durationSeconds: 60, aspectRatio: "16:9" } }).ok).toBe(true);
    expect(klingTextToVideo.validate({ prompt: "x", options: { durationSeconds: 60, resolution: "4k", aspectRatio: "16:9" } }).ok).toBe(false);
  });

  it("the chain record is read strictly", () => {
    expect(readChain({ chain: { segments: 4, segmentSeconds: 15, done: ["a"], callbackUrl: "https://x/api/webhooks/kling" } })?.done).toEqual(["a"]);
    expect(readChain({})).toBeNull();
    expect(readChain({ chain: { segments: 99, segmentSeconds: 15, callbackUrl: "x" } })).toBeNull();
  });
});
