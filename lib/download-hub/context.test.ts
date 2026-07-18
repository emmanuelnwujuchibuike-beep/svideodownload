import { describe, expect, it } from "vitest";

import { buildDownloadContext, heightOf, pickFormat } from "./context";
import type { MediaFormat, VideoMetadata } from "@/types";

/**
 * Format selection and context building. See `docs/DOWNLOAD_HUB_RFC.md` §2.
 *
 * `pickFormat` backs the "Auto Download" preference, which skips the picker
 * entirely — so a wrong choice here is invisible to the user until they open a
 * file that is not what they asked for. The fallback rules are the part worth
 * pinning.
 */

const fmt = (over: Partial<MediaFormat>): MediaFormat => ({
  formatId: "best",
  kind: "video",
  label: "Best",
  ext: "mp4",
  resolution: null,
  fps: null,
  filesize: null,
  tbr: null,
  vcodec: "h264",
  acodec: "aac",
  ...over,
});

describe("heightOf", () => {
  it("reads a numeric height tier from the formatId", () => {
    expect(heightOf(fmt({ formatId: "1080" }))).toBe(1080);
  });

  it("falls back to the resolution string", () => {
    expect(heightOf(fmt({ formatId: "best", resolution: "1920x1080" }))).toBe(1080);
  });

  it("falls back to the label", () => {
    expect(heightOf(fmt({ formatId: "best", resolution: null, label: "720p" }))).toBe(720);
  });

  it("returns 0 when nothing carries a height", () => {
    expect(heightOf(fmt({ formatId: "audio", label: "Audio", resolution: null }))).toBe(0);
    expect(heightOf(undefined)).toBe(0);
  });
});

describe("pickFormat", () => {
  const formats = [
    fmt({ formatId: "1080", label: "1080p" }),
    fmt({ formatId: "480", label: "480p" }),
    fmt({ formatId: "audio", kind: "audio", label: "Audio", acodec: "aac", vcodec: "none" }),
  ];

  it("takes the first video for 'best'", () => {
    expect(pickFormat(formats, "best")?.formatId).toBe("1080");
  });

  it("takes the audio track for 'audio'", () => {
    expect(pickFormat(formats, "audio")?.formatId).toBe("audio");
  });

  it("takes an exact height when the source offers it", () => {
    expect(pickFormat(formats, "1080")?.formatId).toBe("1080");
  });

  it("never overshoots a height preference", () => {
    // 720 requested, source has 1080 and 480 — picking 1080 would blow a metered
    // connection the user explicitly tried to protect.
    expect(pickFormat(formats, "720")?.formatId).toBe("480");
  });

  it("falls back to video when audio is requested but unavailable", () => {
    const videoOnly = [fmt({ formatId: "720", label: "720p" })];
    // Saving something beats silently doing nothing when auto-download is on.
    expect(pickFormat(videoOnly, "audio")?.formatId).toBe("720");
  });

  it("falls back to the best video when no rendition is at or below the ceiling", () => {
    const highOnly = [fmt({ formatId: "2160", label: "2160p" })];
    expect(pickFormat(highOnly, "480")?.formatId).toBe("2160");
  });

  it("returns undefined for an empty format list", () => {
    expect(pickFormat([], "best")).toBeUndefined();
  });
});

describe("buildDownloadContext", () => {
  const metadata = {
    id: "x",
    platform: "tiktok",
    platformName: "TikTok",
    sourceUrl: "https://tiktok.com/x",
    title: "t",
    description: null,
    thumbnail: null,
    durationSeconds: 42,
    creator: null,
    uploadDate: null,
    viewCount: null,
    likeCount: null,
    webpageUrl: "https://tiktok.com/x",
    formats: [fmt({ formatId: "1080", label: "1080p" })],
    extractor: "tiktok",
  } as VideoMetadata;

  it("carries platform, duration and height through", () => {
    const ctx = buildDownloadContext({
      metadata,
      formatId: "1080",
      kind: "video",
      signedIn: true,
      downloadCount: 3,
    });
    expect(ctx).toMatchObject({
      platformId: "tiktok",
      durationSec: 42,
      height: 1080,
      hasAudio: true,
      signedIn: true,
      downloadCount: 3,
    });
  });

  it("treats a video-only rendition as having no audio", () => {
    const videoOnly = {
      ...metadata,
      formats: [fmt({ formatId: "1080", acodec: "none" })],
    } as VideoMetadata;
    expect(
      buildDownloadContext({
        metadata: videoOnly,
        formatId: "1080",
        kind: "video",
        signedIn: false,
        downloadCount: 1,
      }).hasAudio,
    ).toBe(false);
  });

  it("never reports audio on an image download", () => {
    expect(
      buildDownloadContext({
        metadata,
        formatId: "1080",
        kind: "image",
        signedIn: false,
        downloadCount: 1,
      }).hasAudio,
    ).toBe(false);
  });

  it("defaults a missing duration to 0 rather than NaN", () => {
    const noDuration = { ...metadata, durationSeconds: null } as VideoMetadata;
    expect(
      buildDownloadContext({
        metadata: noDuration,
        formatId: "1080",
        kind: "video",
        signedIn: false,
        downloadCount: 1,
      }).durationSec,
    ).toBe(0);
  });
});
