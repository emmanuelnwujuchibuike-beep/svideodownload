import { describe, expect, it } from "vitest";

import { distinctVideos, stripSnapWatermark } from "./snapchat";

/**
 * Snapchat Spotlight watermark removal.
 *
 * Spotlight share pages serve a watermarked render (the `.27.` rendition, and a
 * `mo` query carrying `SpotlightSharing`); the same media is served clean at the
 * `.1034.` story-original rendition. The bug this suite pins: the rewrite only
 * matched a `/d/` media path, while Spotlight also serves from `/y/` — so a
 * `/y/` URL passed the watermark check and had nothing rewritten, and the file
 * downloaded WITH the watermark. That is the reported "Snapchat Spotlight still
 * downloads with watermarks".
 */
describe("stripSnapWatermark", () => {
  const watermarked = (dir: string) =>
    `https://cf-st.sc-cdn.net/${dir}/ABC123def.27.XYZtoken?mo=U3BvdGxpZ2h0U2hhcmluZw&uc=42`;

  it("strips the watermark on a /d/ Spotlight URL", () => {
    const out = stripSnapWatermark(watermarked("d"));
    expect(out).toContain(".1034.");
    expect(out).not.toContain(".27.");
    expect(out).not.toContain("mo=");
  });

  it("strips the watermark on a /y/ Spotlight URL — the case that was broken", () => {
    const out = stripSnapWatermark(watermarked("y"));
    expect(out, "the /y/ rendition was left watermarked").toContain(".1034.");
    expect(out).not.toContain(".27.");
    expect(out).not.toContain("mo=");
  });

  it("detects the watermark from the SpotlightSharing media-option alone", () => {
    // A non-.27. rendition can still carry the sharing overlay via `mo`.
    const out = stripSnapWatermark(
      "https://cf-st.sc-cdn.net/y/ABC123def.99.tok?mo=U3BvdGxpZ2h0U2hhcmluZw",
    );
    expect(out).toContain(".1034.");
    expect(out).not.toContain("mo=");
  });

  it("leaves a clean story URL untouched", () => {
    const clean = "https://cf-st.sc-cdn.net/d/ABC123def.mp4";
    expect(stripSnapWatermark(clean)).toBe(clean);
  });

  it("leaves an already-clean .1034. URL untouched", () => {
    const clean = "https://cf-st.sc-cdn.net/y/ABC123def.1034.XYZtoken";
    expect(stripSnapWatermark(clean)).toBe(clean);
  });

  it("returns the input unchanged when it is not a URL", () => {
    expect(stripSnapWatermark("not a url")).toBe("not a url");
  });
});

/**
 * ── The 19-tile bug ───────────────────────────────────────────────────────
 * Owner (2026-08-09), with a screenshot: a share link produced a picker of 19
 * items, every tile the same picture, none of them the right video.
 *
 * The blanket CDN scan was doing what it was told — collecting every
 * `sc-cdn.net` string on the page. A Snapchat page carries far more than its
 * story: poster images, preview renditions, and the SAME clip at several
 * qualities. Emitting one "Story N" per URL turned page furniture into a
 * download picker, which is worse than finding nothing: it is confidently
 * wrong and the member cannot tell which item is real.
 */
describe("distinctVideos — the scrape must not fabricate a story", () => {
  const CDN = "https://cf-st.sc-cdn.net";

  it("collapses several renditions of ONE clip to one item", () => {
    // Exactly the shape that produced 19 tiles: one media id, many renditions.
    const urls = [27, 1034, 256, 512].map((r) => `${CDN}/d/abc123.${r}.tok?sig=1`);
    expect(distinctVideos(urls)).toHaveLength(1);
  });

  it("drops posters and previews", () => {
    const urls = [
      `${CDN}/p/cover.jpg`,
      `${CDN}/p/thumb.png`,
      `${CDN}/d/abc123.1034.tok`,
      `${CDN}/p/preview.webp?sig=9`,
    ];
    expect(distinctVideos(urls)).toEqual([`${CDN}/d/abc123.1034.tok`]);
  });

  it("keeps genuinely different videos", () => {
    const urls = [`${CDN}/d/aaa.1034.tok`, `${CDN}/d/bbb.1034.tok`, `${CDN}/d/ccc.1034.tok`];
    expect(distinctVideos(urls)).toHaveLength(3);
  });

  it("ignores the signature when deciding what is distinct", () => {
    const urls = [`${CDN}/d/abc.1034.tok?sig=1&exp=1`, `${CDN}/d/abc.1034.tok?sig=2&exp=2`];
    expect(distinctVideos(urls)).toHaveLength(1);
  });

  it("handles extension-less Spotlight paths", () => {
    const urls = [`${CDN}/d/xyz`, `${CDN}/y/xyz`];
    // Same filename, so the same media served from two directories.
    expect(distinctVideos(urls)).toHaveLength(1);
  });

  it("returns nothing when the page held only images", () => {
    expect(distinctVideos([`${CDN}/p/a.jpg`, `${CDN}/p/b.png`])).toEqual([]);
  });

  it("handles an empty list", () => {
    expect(distinctVideos([])).toEqual([]);
  });

  it("preserves the first URL seen for each video", () => {
    const first = `${CDN}/d/abc.1034.tok`;
    expect(distinctVideos([first, `${CDN}/d/abc.27.tok`])).toEqual([first]);
  });
});
