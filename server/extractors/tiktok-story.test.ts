import { describe, expect, it } from "vitest";

import { cleanWatchUrl, compareGears, gearsOf, isTikTokStoryUrl } from "@/server/extractors/tiktok";

/*
  Owner, 2026-10-31: "make the story download in high quality … go through any path". A story's first page gave one
  576x1024 stream, so a story asks every page and keeps the best top stream. Pinned: how a story link is recognised,
  the plain watch URL it also asks for, and "best" = taller, then a higher bitrate.
*/
const STORY =
  "https://www.tiktok.com/@freakiest_siddy_01/video/7702723315751816469?_d=x&aweme_type=40&share_item_id=7702723315751816469&story_type=1&utm_source=copy";

describe("TikTok story: every page, the best stream", () => {
  it("recognises a story link, and not a post", () => {
    expect(isTikTokStoryUrl(STORY)).toBe(true);
    expect(isTikTokStoryUrl("https://www.tiktok.com/@a/video/1?story_type=1")).toBe(true);
    expect(isTikTokStoryUrl("https://www.tiktok.com/@a/video/123?is_from_webapp=1&sender_device=pc")).toBe(false);
    // teeth: an aweme_type that isn't a story is a post
    expect(isTikTokStoryUrl("https://www.tiktok.com/@a/video/1?aweme_type=0")).toBe(false);
  });

  it("also asks the plain watch URL, without the share query", () => {
    expect(cleanWatchUrl(STORY)).toBe("https://www.tiktok.com/@freakiest_siddy_01/video/7702723315751816469");
    expect(cleanWatchUrl("https://vt.tiktok.com/ZS9yxA12hYF6R-8WL86/")).toBeNull();
  });

  it("reads each page's streams, tallest first", () => {
    const gears = gearsOf({
      video: {
        bitrateInfo: [
          { Bitrate: 306000, CodecType: "h264", PlayAddr: { Width: 576, Height: 1024, UrlList: ["https://a/1"] } },
          { Bitrate: 900000, CodecType: "h265_hvc1", PlayAddr: { Width: 720, Height: 1280, UrlList: ["https://a/2"] } },
          { Bitrate: 2000000, CodecType: "h264", PlayAddr: { Width: 1080, Height: 1920, UrlList: [] } },
        ],
      },
    });
    expect(gears).toEqual([
      { width: 720, height: 1280, kbps: 900, codec: "hevc" },
      { width: 576, height: 1024, kbps: 306, codec: "h264" },
    ]);
  });

  it("best = taller, then a higher bitrate — and a page with nothing loses", () => {
    const g576 = { width: 576, height: 1024, kbps: 306, codec: "h264" };
    const g576hi = { ...g576, kbps: 800 };
    const g720 = { width: 720, height: 1280, kbps: 500, codec: "hevc" };
    expect(compareGears(g720, g576hi)).toBeGreaterThan(0);
    expect(compareGears(g576hi, g576)).toBeGreaterThan(0);
    expect(compareGears(undefined, g576)).toBeLessThan(0);
    // teeth: the smaller stream never wins
    expect(compareGears(g576, g720)).toBeLessThan(0);
  });
});
