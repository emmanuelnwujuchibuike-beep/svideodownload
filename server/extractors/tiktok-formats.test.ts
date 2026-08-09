import { describe, expect, it } from "vitest";

import { buildFormats } from "./tiktok";

/**
 * The TikTok NATIVE fallback's format ordering (owner, carried over from
 * 2026-08-09: "TikTok native fallback still needs a transcode — 23s TTFB when
 * TikWM refuses a video").
 *
 * `3135d28` fixed exactly this on the TikWM path and left the native one alone.
 * The shape of the bug: TikTok encodes its TALLEST gears in bytevc1 (its H.265
 * flavour) and its shorter ones in H.264. The list was ordered by height, so the
 * bytevc1 tier led, became the default pick, and every download of that video
 * paid for a full server-side re-encode before a single byte reached the
 * browser.
 *
 * The fixture below is that exact shape.
 */

const item = (bitrates: unknown[]) =>
  ({
    id: "123",
    video: {
      height: 1080,
      width: 1920,
      playAddr: "https://v.tiktok.com/fallback.mp4",
      bitrateInfo: bitrates,
    },
  }) as Parameters<typeof buildFormats>[0];

/** TikTok's real shape: the top gear is bytevc1, the lower ones are H.264. */
const MIXED = [
  { Bitrate: 4_000_000, CodecType: "h265", GearName: "bytevc1_1080p_4000", PlayAddr: { Height: 1080, UrlList: ["https://v/1080-hevc.mp4"] } },
  { Bitrate: 2_000_000, CodecType: "h264", GearName: "normal_720p_2000", PlayAddr: { Height: 720, UrlList: ["https://v/720-h264.mp4"] } },
  { Bitrate: 900_000, CodecType: "h264", GearName: "normal_540p_900", PlayAddr: { Height: 540, UrlList: ["https://v/540-h264.mp4"] } },
];

describe("native TikTok formats — the default must not need a re-encode", () => {
  const formats = buildFormats(item(MIXED)).filter((f) => f.kind === "video");

  it("leads with an H.264 stream, not the taller bytevc1 one", () => {
    expect(formats[0]?.vcodec, "the default pick still forces a transcode").toBe("h264");
    expect(formats[0]?.directUrl).toBe("https://v/720-h264.mp4");
  });

  it("picks the BEST H.264, not merely any of them", () => {
    // 720p beats 540p inside the fast group.
    expect(formats[0]?.resolution).toBe("720p");
  });

  it("still offers the taller bytevc1 tier — nothing is taken away", () => {
    const hevc = formats.find((f) => f.directUrl === "https://v/1080-hevc.mp4");
    expect(hevc).toBeDefined();
    expect(hevc?.vcodec).toBe("hevc");
  });

  it("says what the slow tier costs, so it is chosen on purpose", () => {
    const hevc = formats.find((f) => f.vcodec === "hevc");
    expect(hevc?.label).toMatch(/converts on download/i);
    // …and the fast one makes no such claim.
    expect(formats[0]?.label).not.toMatch(/converts/i);
  });

  it("orders by height when every tier is already H.264", () => {
    const allFast = buildFormats(
      item([
        { Bitrate: 900_000, CodecType: "h264", GearName: "normal_540p", PlayAddr: { Height: 540, UrlList: ["https://v/540.mp4"] } },
        { Bitrate: 4_000_000, CodecType: "h264", GearName: "normal_1080p", PlayAddr: { Height: 1080, UrlList: ["https://v/1080.mp4"] } },
      ]),
    ).filter((f) => f.kind === "video");
    expect(allFast[0]?.resolution).toBe("1080p");
  });

  it("never reads the watermarked downloadAddr", () => {
    // The watermark-free guarantee: only PlayAddr / playAddr are ever used.
    const withWatermark = buildFormats({
      id: "1",
      video: {
        height: 720,
        playAddr: "https://v/clean.mp4",
        downloadAddr: "https://v/WATERMARKED.mp4",
        bitrateInfo: [],
      },
    } as Parameters<typeof buildFormats>[0]);
    expect(JSON.stringify(withWatermark)).not.toContain("WATERMARKED");
  });
});
