import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildFormats, cookieFromSetCookie, nativeHeaders } from "./tiktok";

/**
 * Outage 2026-10-08: TikTok VIDEO downloads failed (503) while audio worked.
 * The worker's extraction was native — its formats point at TikTok's CDN, which
 * answers 403 without the cookies the video page set. These pin that the page's
 * cookies travel with every native format.
 */
describe("TikTok native formats carry the page's cookies", () => {
  it("turns Set-Cookie lines into one Cookie header, attributes dropped", () => {
    expect(
      cookieFromSetCookie([
        "tt_chain_token=abc123; Max-Age=15552000; Domain=.tiktok.com; Path=/; Secure; HttpOnly",
        "ttwid=1%7Cxyz; Path=/; Domain=tiktok.com; Expires=Fri, 01 Oct 2027 00:00:00 GMT",
        "garbage-without-equals",
      ]),
    ).toBe("tt_chain_token=abc123; ttwid=1%7Cxyz");
    expect(cookieFromSetCookie([])).toBeNull();
  });

  it("every native video format is fetched with that cookie", () => {
    const item = {
      id: "1",
      video: {
        playAddr: "https://v16-webapp-prime.us.tiktok.com/video/play.mp4",
        bitrateInfo: [{ Bitrate: 1_000_000, CodecType: "h264", PlayAddr: { UrlList: ["https://v16-webapp-prime.us.tiktok.com/video/a.mp4"], Width: 720, Height: 1280 } }],
      },
    };
    const formats = buildFormats(item as never, "tt_chain_token=abc123");
    const video = formats.filter((f) => f.kind === "video");
    expect(video.length).toBeGreaterThan(0);
    for (const f of video) expect(f.httpHeaders?.Cookie).toBe("tt_chain_token=abc123");
  });

  it("no cookie means no Cookie header (never an empty one)", () => {
    expect(nativeHeaders(null)).not.toHaveProperty("Cookie");
    expect(nativeHeaders("a=b").Cookie).toBe("a=b");
  });

  it("the native extraction reads the page's Set-Cookie and hands it to the builders", () => {
    const src = readFileSync(join(process.cwd(), "server/extractors/tiktok.ts"), "utf8");
    expect(src).toContain("pageCookie = cookieFromSetCookie(res.headers.getSetCookie?.() ?? []);");
    expect(src).toContain("formats: isPhoto ? buildImageFormats(item, pageCookie) : buildFormats(item, pageCookie),");
  });
});
