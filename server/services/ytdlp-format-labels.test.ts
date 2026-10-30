import { describe, expect, it } from "vitest";

import { mapFormats } from "./ytdlp-service";

type Raw = Parameters<typeof mapFormats>[0];

/**
 * A quality is named by its SHORT side (owner, 2026-10-30: downloads "in low quality even if I select high quality").
 * Measured on production the same day, instagram.com/p/DWHwMSwiQkW: yt-dlp's renditions were 1080×1920 and 720×1280,
 * shown as "2160p" and "1440p" — the files delivered were the best there is, the labels promised 4K.
 */
const portraitReel: Raw = {
  duration: 53,
  formats: [
    { format_id: "v1080", ext: "mp4", vcodec: "avc1.640028", acodec: "none", width: 1080, height: 1920, tbr: 2386 },
    { format_id: "v720", ext: "mp4", vcodec: "avc1.64001f", acodec: "none", width: 720, height: 1280, tbr: 1290 },
    { format_id: "a", ext: "m4a", vcodec: "none", acodec: "mp4a.40.2", tbr: 131 },
  ],
} as Raw;

describe("yt-dlp quality labels", () => {
  it("a portrait 1080×1920 reel is 1080p, not 2160p — and its 720×1280 rendition is 720p", () => {
    const video = mapFormats(portraitReel).filter((f) => f.kind === "video");
    expect(video.map((f) => f.label)).toEqual(["1080p", "720p"]);
    expect(video.map((f) => f.resolution)).toEqual(["1080p", "720p"]);
  });

  it("🔴 the tier ID stays the HEIGHT the download selector filters on (height<=2160 still reaches the 1920-tall file)", () => {
    const video = mapFormats(portraitReel).filter((f) => f.kind === "video");
    // teeth: an ID changed to "1080" would make `bestvideo[height<=1080]` skip the 1080×1920 file for the 720×1280 one
    expect(video.map((f) => f.formatId)).toEqual(["2160", "1440"]);
  });

  it("landscape is unchanged: 1920×1080 stays 1080p", () => {
    const landscape = { duration: 10, formats: [{ format_id: "v", ext: "mp4", vcodec: "avc1", acodec: "mp4a", width: 1920, height: 1080, tbr: 4000 }] } as Raw;
    const [v] = mapFormats(landscape);
    expect(v).toMatchObject({ formatId: "1080", label: "1080p" });
  });

  it("a single file (no formats list) is named by its short side too", () => {
    const single = { url: "https://cdn.example/v.mp4", width: 1080, height: 1920, vcodec: "h264", acodec: "aac" } as Raw;
    const [v] = mapFormats(single);
    expect(v).toMatchObject({ formatId: "1920", label: "1080p" });
  });
});
