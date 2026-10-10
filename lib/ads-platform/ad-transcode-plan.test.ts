import { describe, expect, it } from "vitest";

import { AD_FALLBACK_SHORT_EDGE, adFallbackSize, buildAdTranscodeArgs } from "./ad-transcode-plan";

describe("Stream full → the worker compresses ad videos to 480p (owner, 2026-10-10)", () => {
  it("a 1080p video comes out at 480p, landscape or portrait, ratio kept", () => {
    expect(adFallbackSize(1920, 1080)).toEqual({ width: 854, height: 480 });
    expect(adFallbackSize(1080, 1920)).toEqual({ width: 480, height: 854 });
    expect(adFallbackSize(3840, 2160)).toEqual({ width: 854, height: 480 });
  });

  it("a video already at or under 480p is never upscaled", () => {
    expect(adFallbackSize(640, 360)).toEqual({ width: 640, height: 360 });
    expect(adFallbackSize(480, 480)).toEqual({ width: 480, height: 480 });
  });

  it("teeth: for any input the short edge never passes 480 and the shape is kept (nothing cropped)", () => {
    for (const [w, h] of [[1920, 1080], [1080, 1920], [1000, 697], [7680, 4320], [720, 1280], [300, 200]] as const) {
      const out = adFallbackSize(w, h);
      expect(Math.min(out.width, out.height)).toBeLessThanOrEqual(AD_FALLBACK_SHORT_EDGE);
      expect(Math.abs(out.width / out.height - w / h) / (w / h)).toBeLessThan(0.01);
    }
  });

  it("the ffmpeg command is constants plus the two paths — a web-playable, fast-start MP4", () => {
    const args = buildAdTranscodeArgs("/tmp/in", "/tmp/out.mp4");
    expect(args.filter((a) => a === "/tmp/in" || a === "/tmp/out.mp4")).toHaveLength(2);
    expect(args.at(-1)).toBe("/tmp/out.mp4");
    expect(args).toEqual(expect.arrayContaining(["libx264", "aac", "+faststart", "yuv420p"]));
    expect(args.join(" ")).toContain("min(480,");
  });
});
