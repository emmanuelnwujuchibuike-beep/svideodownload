import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AD_VIDEO_MAX_SECONDS, effectiveMaxVideoSeconds, validateCreative, type CreativeLimits } from "./creative-validation";
import { VIDEO_STALL_SECONDS } from "./rotation";

const code = (f: string) => readFileSync(path.resolve(process.cwd(), f), "utf8");

// Owner, 2026-10-16: "make video ad in banner play until the end before rotating, but the maximum
// video length for upload should be 15sec".
describe("the 15-second video cap", () => {
  it("never above 15 s; a format's own shorter limit still wins; no limit means 15 s", () => {
    expect(AD_VIDEO_MAX_SECONDS).toBe(15);
    expect(effectiveMaxVideoSeconds(60)).toBe(15);
    expect(effectiveMaxVideoSeconds(10)).toBe(10);
    expect(effectiveMaxVideoSeconds(null)).toBe(15);
    expect(effectiveMaxVideoSeconds(0)).toBe(15);
  });
  it("a 16-second video is refused at upload, a 15-second one passes", () => {
    const limits: CreativeLimits = { code: "x", mediaTypes: ["video"], maxDurationSeconds: effectiveMaxVideoSeconds(60), maxFileBytes: 50_000_000, maxWidth: 4000, maxHeight: 4000, minWidth: null, minHeight: null, aspectRatio: null, aspectTolerance: null } as CreativeLimits;
    const base = { mediaType: "video" as const, mime: "video/mp4", fileSizeBytes: 1_000_000, width: 720, height: 1280 };
    expect(validateCreative({ ...base, durationSeconds: 16 } as never, limits).errors).toContain("video_too_long");
    expect(validateCreative({ ...base, durationSeconds: 15 } as never, limits).errors).not.toContain("video_too_long");
  });
  it("the server's limits and the upload step both use the cap", () => {
    expect(code("lib/ads-platform/server.ts")).toContain("maxDurationSeconds: effectiveMaxVideoSeconds(f.max_duration_seconds),");
    expect(code("features/ads-platform/creative-step.tsx")).toContain("maxDurationSeconds: effectiveMaxVideoSeconds(format.max_duration_seconds),");
    expect(code("lib/ads-platform/advertiser-server.ts")).toContain("startVideoProcessing(db, cr, locked, kind, limits.maxDurationSeconds,");
  });
});

describe("a banner video plays to its end", () => {
  const banner = code("features/ads-platform/serve/self-ad-banner.tsx");
  it("with more than one ad it plays once and the next ad follows on 'ended'", () => {
    expect(banner).toContain("loop={count <= 1}");
    expect(banner).toContain("onEnded={count > 1 && dwell ? () => setIndex((i) => (i + 1) % count) : undefined}");
  });
  it("while it plays, the dwell clock cannot cut it: only the stall net (longer than any allowed video) runs", () => {
    expect(VIDEO_STALL_SECONDS).toBeGreaterThan(AD_VIDEO_MAX_SECONDS);
    expect(banner).toContain("isVideo ? Math.max(dwell, VIDEO_STALL_SECONDS) : dwell");
  });
});
