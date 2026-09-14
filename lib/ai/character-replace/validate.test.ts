import { describe, expect, it } from "vitest";

import { CHARACTER_REPLACE_DEFAULTS, normalizeCharacterReplaceConfig, publicCharacterReplaceConfig } from "./config";
import type { VideoMetadata } from "./types";
import {
  CHARACTER_REPLACE_VIDEO_ACCEPT,
  aspectRatioOf,
  characterReplaceLimits,
  containerOf,
  qualityGuidance,
  resolutionLabelOf,
  toMs,
  validatePhotoFile,
  validatePhotoPixels,
  validateVideoFile,
  validateVideoMetadata,
} from "./validate";

/**
 * The validation layer (Part 2, §5), pinned at the layer that decides.
 *
 * §24's photo and video matrix, minus the cases that need a real decoder
 * (a corrupt file, a readable MOV) — those run in the browser walk. Every
 * number comes from `characterReplaceLimits`, never from a literal, so an
 * operator lowering a ceiling moves these too.
 */

const config = publicCharacterReplaceConfig(CHARACTER_REPLACE_DEFAULTS, { code: "NGN", symbol: "₦" }, false);
const limits = characterReplaceLimits(config);

const meta = (over: Partial<VideoMetadata> = {}): VideoMetadata => ({
  durationMs: 18_437,
  width: 1080,
  height: 1920,
  aspect: aspectRatioOf(1080, 1920),
  resolutionLabel: "1080p",
  sizeBytes: 1,
  mimeType: "video/mp4",
  container: "mp4",
  frameRate: null,
  videoCodec: null,
  hasAudio: null,
  audioDurationMs: null,
  ...over,
});

describe("limits", () => {
  it("derive from the server's config and never exceed the platform", () => {
    expect(limits.video.maxDurationMs).toBe(CHARACTER_REPLACE_DEFAULTS.maximumDurationSeconds * 1000);
    expect(limits.video.minDurationMs).toBe(1000);
    expect(limits.video.maxBytes).toBe(100 * 1024 * 1024);
    // An operator cannot loosen the platform ceiling, only tighten it.
    const loose = characterReplaceLimits({ ...config, maximumUploadBytes: 10 ** 12, maximumPixels: 10 ** 9 });
    expect(loose.video.maxBytes).toBe(100 * 1024 * 1024);
    expect(loose.video.maxPixels).toBe(3840 * 2160);
    const tight = characterReplaceLimits({ ...config, maximumUploadBytes: 5 * 1024 * 1024, maximumDurationSeconds: 15 });
    expect(tight.video.maxBytes).toBe(5 * 1024 * 1024);
    expect(tight.video.maxDurationMs).toBe(15_000);
  });

  it("apply platform defaults before the config answers", () => {
    const none = characterReplaceLimits(null);
    expect(none.video.maxDurationMs).toBe(120_000);
    expect(none.trim.enabled).toBe(true);
  });
});

describe("photo", () => {
  const f = (name: string, type: string, size = 2048) => validatePhotoFile({ name, type, size }, limits);

  it("accepts JPG, JPEG, PNG and WebP", () => {
    expect(f("me.jpg", "image/jpeg")).toEqual({ ok: true });
    expect(f("me.jpeg", "image/jpeg")).toEqual({ ok: true });
    expect(f("me.png", "image/png")).toEqual({ ok: true });
    expect(f("me.webp", "image/webp")).toEqual({ ok: true });
    // A picker with no MIME type, by extension alone.
    expect(f("me.PNG", "")).toEqual({ ok: true });
  });

  it("refuses an unsupported image, an oversized one, and an empty one", () => {
    expect(f("me.heic", "image/heic")).toEqual({ ok: false, code: "unsupported-image" });
    expect(f("me.gif", "image/gif")).toEqual({ ok: false, code: "unsupported-image" });
    expect(f("clip.mp4", "video/mp4")).toEqual({ ok: false, code: "unsupported-image" });
    expect(f("me.jpg", "image/jpeg", limits.photo.maxBytes + 1)).toEqual({ ok: false, code: "image-too-large" });
    expect(f("me.jpg", "image/jpeg", 0)).toEqual({ ok: false, code: "invalid-image" });
  });

  it("refuses a decoded photo too small to hold a face, and an undecodable one", () => {
    expect(validatePhotoPixels({ width: 120, height: 160 }, limits)).toEqual({ ok: false, code: "image-too-small" });
    expect(validatePhotoPixels({ width: 256, height: 256 }, limits)).toEqual({ ok: true });
    expect(validatePhotoPixels(null, limits)).toEqual({ ok: false, code: "invalid-image" });
  });
});

describe("video file", () => {
  const f = (name: string, type: string, size = 2048) => validateVideoFile({ name, type, size }, limits);

  it("accepts MP4, MOV and WebM — and nothing the browser cannot decode", () => {
    expect(f("clip.mp4", "video/mp4")).toEqual({ ok: true });
    expect(f("IMG_0001.MOV", "video/quicktime")).toEqual({ ok: true });
    expect(f("clip.webm", "video/webm")).toEqual({ ok: true });
    expect(f("clip.mov", "")).toEqual({ ok: true });
    // 🔴 AVI is on the platform list and NOT here: no browser decodes it, and
    // this tool needs the browser to.
    expect(f("clip.avi", "video/x-msvideo")).toEqual({ ok: false, code: "unsupported-file" });
    expect(f("clip.mkv", "video/x-matroska")).toEqual({ ok: false, code: "unsupported-file" });
    expect(f("me.jpg", "image/jpeg")).toEqual({ ok: false, code: "unsupported-file" });
    expect(CHARACTER_REPLACE_VIDEO_ACCEPT).not.toContain("avi");
  });

  it("refuses an oversized and an empty video", () => {
    expect(f("clip.mp4", "video/mp4", limits.video.maxBytes + 1)).toEqual({ ok: false, code: "file-too-large" });
    expect(f("clip.mp4", "video/mp4", limits.video.maxBytes)).toEqual({ ok: true });
    expect(f("clip.mp4", "video/mp4", 0)).toEqual({ ok: false, code: "invalid-video" });
  });
});

describe("video metadata", () => {
  it("accepts a normal phone video, portrait or landscape", () => {
    expect(validateVideoMetadata(meta(), limits)).toEqual({ ok: true });
    expect(validateVideoMetadata(meta({ width: 1920, height: 1080 }), limits)).toEqual({ ok: true });
  });

  it("🔴 does NOT refuse a long video — the trim step handles length", () => {
    expect(validateVideoMetadata(meta({ durationMs: 600_000 }), limits)).toEqual({ ok: true });
  });

  it("refuses a video too short to trim to the minimum", () => {
    expect(validateVideoMetadata(meta({ durationMs: 400 }), limits)).toEqual({ ok: false, code: "video-too-short" });
    expect(validateVideoMetadata(meta({ durationMs: 1000 }), limits)).toEqual({ ok: true });
  });

  it("refuses too many pixels and too few", () => {
    expect(validateVideoMetadata(meta({ width: 7680, height: 4320 }), limits)).toEqual({ ok: false, code: "video-resolution-too-large" });
    expect(validateVideoMetadata(meta({ width: 3840, height: 2160 }), limits)).toEqual({ ok: true });
    expect(validateVideoMetadata(meta({ width: 320, height: 180 }), limits)).toEqual({ ok: false, code: "video-resolution-too-small" });
  });

  it("passes an unmeasured video through — readiness catches it later, in words", () => {
    expect(validateVideoMetadata(meta({ durationMs: null, width: null, height: null }), limits)).toEqual({ ok: true });
  });
});

describe("metadata helpers", () => {
  it("names the common aspect ratios and reduces the rest", () => {
    expect(aspectRatioOf(1080, 1920)).toMatchObject({ label: "9:16", orientation: "portrait" });
    expect(aspectRatioOf(1920, 1080)).toMatchObject({ label: "16:9", orientation: "landscape" });
    expect(aspectRatioOf(1080, 1080)).toMatchObject({ label: "1:1", orientation: "square" });
    expect(aspectRatioOf(1080, 1350)).toMatchObject({ label: "4:5" });
    // A camera that is a pixel off still reads as the ratio it meant.
    expect(aspectRatioOf(1080, 1918)?.label).toBe("9:16");
    // 700×300 is within 1% of the ultrawide 21:9 and takes its name.
    expect(aspectRatioOf(700, 300)?.label).toBe("21:9");
    expect(aspectRatioOf(1000, 300)?.label).toBe("10:3");
    expect(aspectRatioOf(null, 100)).toBeNull();
  });

  it("labels resolution from the SHORTER edge, so portrait and landscape agree", () => {
    expect(resolutionLabelOf(1080, 1920)).toBe("1080p");
    expect(resolutionLabelOf(1920, 1080)).toBe("1080p");
    expect(resolutionLabelOf(720, 1280)).toBe("720p");
    expect(resolutionLabelOf(3840, 2160)).toBe("4K");
    expect(resolutionLabelOf(854, 480)).toBe("480p");
    expect(resolutionLabelOf(640, 360)).toBe("360p");
    expect(resolutionLabelOf(null, null)).toBeNull();
  });

  it("reads the container from the name first, then the type", () => {
    expect(containerOf("IMG_0001.MOV", "video/mp4")).toBe("mov");
    expect(containerOf("clip", "video/webm")).toBe("webm");
    expect(containerOf("clip", "")).toBe("unknown");
  });

  it("turns decoder seconds into integer milliseconds and refuses nonsense", () => {
    expect(toMs(18.437)).toBe(18_437);
    expect(toMs(18.4375)).toBe(18_438);
    expect(toMs(0)).toBe(0);
    expect(toMs(null)).toBeNull();
    expect(toMs(Number.NaN)).toBeNull();
    expect(toMs(-1)).toBeNull();
  });
});

describe("quality guidance (§13)", () => {
  it("says when the output asks for more detail than the source holds — and only then", () => {
    // Every tier on, so the 1080p sentence can be seen; the default ships 1080p off.
    const config = publicCharacterReplaceConfig(
      normalizeCharacterReplaceConfig({ qualities: [{ id: "1080p", enabled: true }] }),
      { code: "NGN", symbol: "₦" },
      false,
    );
    const source720 = meta({ width: 720, height: 1280, resolutionLabel: "720p" });
    expect(qualityGuidance(source720, "1080p", config.qualities)).toBe("Your source video is 720p. 1080p output may not add real detail.");
    expect(qualityGuidance(source720, "720p", config.qualities)).toBeNull();
    expect(qualityGuidance(source720, "480p", config.qualities)).toBeNull();
    expect(qualityGuidance(meta(), "1080p", config.qualities)).toBeNull();
    expect(qualityGuidance(null, "1080p", config.qualities)).toBeNull();
    expect(qualityGuidance(meta({ width: null, height: null }), "1080p", config.qualities)).toBeNull();
  });
});
