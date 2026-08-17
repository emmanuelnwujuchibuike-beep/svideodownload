import { describe, expect, it } from "vitest";

import {
  collectPhotos,
  collectStoryVideoUrls,
  declaredSize,
  isStoryPath,
  mergePhotos,
  photoIdOf,
  tryStorySlides,
} from "./facebook";

/**
 * Facebook PHOTO posts (owner, 2026-08-09: "this is the facebook image link that
 * doesn't fetch or download" — https://web.facebook.com/share/p/19CFoS5Uje/).
 *
 * Every URL below is copied from the real renders of that post, measured on
 * 2026-08-09. The shapes are the point of the suite: the extractor reads size
 * and identity out of these query strings, and Facebook's renders disagree about
 * both, so the merge has to be pinned against the actual strings rather than
 * against something tidier that was invented here.
 *
 * The bug being pinned: the desktop Chrome UA gets HTTP 400 from web.facebook.com,
 * so the ONLY renders that answer are the crawler (one big photo) and mobile
 * (all five, small). Neither alone is the right answer.
 */

/** The cover photo as the CRAWLER render serves it — one photo, ~600px. */
const CRAWLER_HTML = `<html><head>
<meta property="og:title" content="Joy Ezenwafor" />
<meta property="og:image" content="https://scontent.fabv2-1.fna.fbcdn.net/v/t39.30808-6/763740205_122131955871347950_8904919058971514698_n.jpg?stp=dst-jpg_tt6&amp;cstp=mx720x1280&amp;ctp=p600x600&amp;_nc_cat=101&amp;oh=00_AQEA&amp;oe=6A7E7C3A" />
</head><body></body></html>`;

/** The MOBILE render — every photo in the post, but only at 130–350px. */
const MOBILE_HTML = `<html><head>
<meta property="og:title" content="Joy Ezenwafor" />
</head><body>
<img src="https://z-m-scontent.fabv2-1.fna.fbcdn.net/v/t39.30808-6/763740205_122131955871347950_8904919058971514698_n.jpg?stp=dst-webp_q70_s235x350&amp;_nc_cat=101&amp;oh=00_AQE&amp;oe=6A7E7C3A" />
<img src="https://z-m-scontent.fabv2-2.fna.fbcdn.net/v/t39.30808-1/710000435_122097583989347950_5538799541443671685_n.jpg?stp=c0.24.720.720a_cp0_dst-jpg_e15_q65_s40x40_tt6&amp;oh=00_AQF&amp;oe=6A7E6602" />
<img src="https://z-m-scontent.fabv2-1.fna.fbcdn.net/v/t39.30808-6/763761962_122131955931347950_6881772706803127680_n.jpg?stp=dst-webp_q70_s235x350&amp;oh=00_AQG&amp;oe=6A7E6602" />
<img src="https://z-m-scontent.fabv2-1.fna.fbcdn.net/v/t39.30808-6/763120010_122131955943347950_5974873420435578992_n.jpg?stp=dst-webp_p130x130_q70&amp;oh=00_AQH&amp;oe=6A7E6602" />
<img src="https://z-m-scontent.fabv2-2.fna.fbcdn.net/v/t39.30808-6/762690418_122131955859347950_363010229996591952_n.jpg?stp=dst-webp_p130x130_q70&amp;oh=00_AQI&amp;oe=6A7E6602" />
<img src="https://z-m-scontent.fabv2-1.fna.fbcdn.net/v/t39.30808-6/763120266_122131955865347950_6044144871008365640_n.jpg?stp=dst-webp_p130x130_q70&amp;oh=00_AQJ&amp;oe=6A7E6602" />
</body></html>`;

describe("declaredSize", () => {
  it("reads the longest edge out of an stp rendition hint", () => {
    expect(declaredSize("https://x/y_n.jpg?stp=dst-webp_q70_s235x350")).toBe(350);
    expect(declaredSize("https://x/y_n.jpg?stp=dst-webp_p130x130_q70")).toBe(130);
  });

  it("prefers the crop hint over the `mx` MAXIMUM, which reads high", () => {
    const url =
      "https://x/y_n.jpg?stp=dst-jpg_tt6&cstp=mx720x1280&ctp=p600x600&oh=00_A&oe=6A7E7C3A";
    /*
      This is the owner's cover photo. `cstp=mx720x1280` is a ceiling, not a
      size: the delivered JPEG measures 600x1067 (read from its SOF header on
      2026-08-09). Ranking on 1280 would have labelled a 600px-wide image
      "1280px", so the crop hint wins.
    */
    expect(declaredSize(url)).toBe(600);
  });

  it("returns 0 when the URL advertises no size at all", () => {
    expect(declaredSize("https://x/y_n.jpg?_nc_cat=101")).toBe(0);
  });
});

describe("photoIdOf", () => {
  it("is stable across renditions AND across CDN hostnames", () => {
    const crawler =
      "https://scontent.fabv2-1.fna.fbcdn.net/v/t39.30808-6/763740205_122131955871347950_8904919058971514698_n.jpg?stp=dst-jpg_tt6";
    const mobile =
      "https://z-m-scontent.fabv2-1.fna.fbcdn.net/v/t39.30808-6/763740205_122131955871347950_8904919058971514698_n.jpg?stp=dst-webp_q70_s235x350";
    expect(photoIdOf(crawler)).toBe("763740205_122131955871347950_8904919058971514698");
    expect(photoIdOf(mobile)).toBe(photoIdOf(crawler));
  });

  it("ignores a static asset that is not a photo", () => {
    expect(photoIdOf("https://static.xx.fbcdn.net/rsrc.php/v4/y2/r/GesbvOLhIHk.js")).toBeNull();
  });
});

describe("collectPhotos", () => {
  it("finds every photo in the mobile render", () => {
    const found = collectPhotos(MOBILE_HTML);
    expect(found).toHaveLength(5);
  });

  it("skips the poster's avatar (t39.30808-1), which nobody asked to download", () => {
    const found = collectPhotos(MOBILE_HTML);
    expect(found.some((c) => c.url.includes("/t39.30808-1/"))).toBe(false);
  });
});

describe("mergePhotos — the two renders together", () => {
  it("returns all five photos of the post, not just the crawler's one", () => {
    const formats = mergePhotos([{ html: CRAWLER_HTML }, { html: MOBILE_HTML }]);
    expect(formats, "the album collapsed to the cover photo").toHaveLength(5);
    expect(formats.every((f) => f.kind === "image")).toBe(true);
  });

  it("keeps the CRAWLER's bigger copy of the cover photo over the mobile thumbnail", () => {
    const formats = mergePhotos([{ html: CRAWLER_HTML }, { html: MOBILE_HTML }]);
    const cover = formats.find((f) => f.directUrl?.includes("763740205"));
    expect(cover?.directUrl, "merged to the 235px mobile rendition").toContain("ctp=p600x600");
    expect(cover?.directUrl).not.toContain("s235x350");
  });

  it("is order-independent — the mobile render arriving first must not win on size", () => {
    const formats = mergePhotos([{ html: MOBILE_HTML }, { html: CRAWLER_HTML }]);
    const cover = formats.find((f) => f.directUrl?.includes("763740205"));
    expect(cover?.directUrl).toContain("ctp=p600x600");
  });

  it("carries the facebook referer, without which scontent answers 403", () => {
    const formats = mergePhotos([{ html: MOBILE_HTML }]);
    expect(formats[0]?.httpHeaders?.Referer).toBe("https://www.facebook.com/");
    expect(formats[0]?.httpHeaders?.["User-Agent"]).toBeTruthy();
  });

  it("never stamps a pixel count it has not measured", () => {
    const formats = mergePhotos([{ html: CRAWLER_HTML }, { html: MOBILE_HTML }]);
    // The hints rank the renditions; they do not measure them. The cover photo
    // declares mx720x1280 and is really 600x1067 — so no number is published.
    expect(formats.every((f) => f.resolution === null)).toBe(true);
    expect(formats.some((f) => /\d+px/.test(f.label))).toBe(false);
    // But the tier still tells a member which file is the big one.
    expect(formats[0]?.label).toBe("Photo 1 · Large");
    expect(formats[4]?.label).toBe("Photo 5 · Small");
  });

  it("falls back to og:image when a render has no CDN URLs to scrape", () => {
    const sparse = `<html><head><meta property="og:image" content="https://scontent.fabv2-1.fna.fbcdn.net/v/t39.30808-6/999_888_777_n.jpg?stp=dst-jpg&amp;oh=00_A" /></head><body></body></html>`;
    const formats = mergePhotos([{ html: sparse }]);
    expect(formats).toHaveLength(1);
    expect(formats[0]?.directUrl).toContain("999_888_777");
  });

  it("gives up cleanly on a render with no media at all", () => {
    expect(mergePhotos([{ html: "<html><body>nothing here</body></html>" }])).toHaveLength(0);
  });
});

/**
 * Facebook STORIES — fetch every slide, like Snapchat (owner, 2026-08-17:
 * "facebook story is suppose to fetch all the posts in the story like
 * snapchat and not just single").
 *
 * ── Why these fixtures are INVENTED, unlike the photo-post ones above ──────
 * This file's own convention is real, captured renders — not possible here.
 * A real Facebook Story requires a logged-in session to view at all
 * (confirmed 2026-08-17 against a real owner-supplied link: every
 * unauthenticated UA this extractor uses redirected straight to Facebook's
 * login page), and asking the owner for their session cookies is exactly
 * what this codebase's own security posture rules out. So these fixtures
 * repeat the `playable_url`/`playable_url_quality_hd`/fbcdn patterns that
 * ARE independently confirmed real elsewhere in this file (buildFormats,
 * collectPhotos above), multiple times, to verify the PARSING LOGIC is
 * correct if a real authenticated page ever does hydrate more than one
 * slide's worth of them. They do NOT verify that Facebook's real story
 * page actually contains more than one — that remains unverified, see the
 * long comment on `tryStorySlides` in facebook.ts.
 */
const STORY_URL = "https://www.facebook.com/stories/122098061367170758/UzpfSVNDOjIxMDU2MzMxNzcwMDY2MDU=/";
const ORDINARY_POST_URL = "https://www.facebook.com/watch/?v=1234567890";

describe("isStoryPath", () => {
  it("matches the real share-link shape", () => {
    expect(isStoryPath(new URL(STORY_URL).pathname)).toBe(true);
  });
  it("does not match an ordinary post/watch/reel path", () => {
    expect(isStoryPath("/watch/")).toBe(false);
    expect(isStoryPath("/reel/123456/")).toBe(false);
    expect(isStoryPath("/someuser/videos/123456/")).toBe(false);
  });
});

describe("collectStoryVideoUrls", () => {
  it("counts an ordinary single video's hd+sd pair as ONE slide, not two", () => {
    const html = `{"playable_url":"https:\\/\\/video.fbcdn.net\\/sd.mp4","playable_url_quality_hd":"https:\\/\\/video.fbcdn.net\\/hd.mp4"}`;
    const found = collectStoryVideoUrls(html);
    expect(found).toHaveLength(1);
    expect(found[0]?.url).toContain("hd.mp4");
  });

  it("finds one slide per DISTINCT hd url when several are present", () => {
    const html = [
      `{"playable_url_quality_hd":"https:\\/\\/video.fbcdn.net\\/slide1.mp4"}`,
      `{"playable_url_quality_hd":"https:\\/\\/video.fbcdn.net\\/slide2.mp4"}`,
      `{"playable_url_quality_hd":"https:\\/\\/video.fbcdn.net\\/slide3.mp4"}`,
    ].join(",");
    const found = collectStoryVideoUrls(html);
    expect(found.map((f) => f.url)).toEqual([
      "https://video.fbcdn.net/slide1.mp4",
      "https://video.fbcdn.net/slide2.mp4",
      "https://video.fbcdn.net/slide3.mp4",
    ]);
  });

  it("falls back to SD urls only when NO hd url exists anywhere in the page", () => {
    const html = `{"playable_url":"https:\\/\\/video.fbcdn.net\\/only-sd.mp4"}`;
    const found = collectStoryVideoUrls(html);
    expect(found).toHaveLength(1);
    expect(found[0]?.url).toContain("only-sd.mp4");
  });

  it("never mixes hd and sd counting — sd is ignored entirely once any hd exists", () => {
    const html = [
      `{"playable_url_quality_hd":"https:\\/\\/video.fbcdn.net\\/slide1-hd.mp4"}`,
      `{"playable_url":"https:\\/\\/video.fbcdn.net\\/slide2-sd-only.mp4"}`,
    ].join(",");
    // slide2 has no hd counterpart, so the conservative rule (documented on
    // collectStoryVideoUrls) misses it rather than risk double-counting.
    const found = collectStoryVideoUrls(html);
    expect(found).toHaveLength(1);
    expect(found[0]?.url).toContain("slide1-hd.mp4");
  });
});

describe("tryStorySlides", () => {
  it("returns null for a non-story URL even with multiple video urls present", () => {
    const html = [
      `{"playable_url_quality_hd":"https:\\/\\/video.fbcdn.net\\/a.mp4"}`,
      `{"playable_url_quality_hd":"https:\\/\\/video.fbcdn.net\\/b.mp4"}`,
    ].join(",");
    expect(tryStorySlides(ORDINARY_POST_URL, [html])).toBeNull();
  });

  it("returns null when the story page only ever embeds ONE slide (the safe, unchanged fallback)", () => {
    const html = `{"playable_url_quality_hd":"https:\\/\\/video.fbcdn.net\\/only-one.mp4"}`;
    expect(tryStorySlides(STORY_URL, [html])).toBeNull();
  });

  it("returns every slide, each flagged isSeparateItem, when the page embeds several", () => {
    const html = [
      `{"playable_url_quality_hd":"https:\\/\\/video.fbcdn.net\\/s1.mp4"}`,
      `{"playable_url_quality_hd":"https:\\/\\/video.fbcdn.net\\/s2.mp4"}`,
      `{"playable_url_quality_hd":"https:\\/\\/video.fbcdn.net\\/s3.mp4"}`,
    ].join(",");
    const formats = tryStorySlides(STORY_URL, [html]);
    expect(formats).toHaveLength(3);
    expect(formats?.every((f) => f.isSeparateItem === true)).toBe(true);
    expect(formats?.every((f) => f.kind === "video")).toBe(true);
  });

  it("deduplicates repeated video renders across multiple UAs", () => {
    const videoHtml = [
      `{"playable_url_quality_hd":"https:\\/\\/video.fbcdn.net\\/s1.mp4"}`,
      `{"playable_url_quality_hd":"https:\\/\\/video.fbcdn.net\\/s2.mp4"}`,
    ].join(",");
    // Same video render repeated (as if two UAs hydrated the same tray) must
    // not double the count.
    const formats = tryStorySlides(STORY_URL, [videoHtml, videoHtml]);
    expect(formats).toHaveLength(2);
    expect(formats?.every((f) => f.kind === "video")).toBe(true);
  });

  /*
    🔴 The two bugs the owner reported, 2026-08-17: "it duplicate a the
    file to a separate thumbnail that are just blurred image together with
    the real multi story".
  */
  it("does NOT treat a video slide's own poster/cover photo as an extra slide", () => {
    // A video story where the page also embeds each video's own still-frame
    // poster as an fbcdn photo asset — collectPhotos has no way to tell that
    // apart from a real standalone photo slide, so once ANY video exists,
    // scraped photos are dropped rather than counted as extra slides.
    const html = [
      `{"playable_url_quality_hd":"https:\\/\\/video.fbcdn.net\\/s1.mp4"}`,
      `{"playable_url_quality_hd":"https:\\/\\/video.fbcdn.net\\/s2.mp4"}`,
      `<img src="https://scontent.fna.fbcdn.net/v/t39.30808-6/111111_222222_333333_n.jpg?stp=dst-jpg" />`,
    ].join(",");
    const formats = tryStorySlides(STORY_URL, [html]);
    expect(formats).toHaveLength(2); // the 2 videos, NOT 2 videos + 1 "photo"
    expect(formats?.every((f) => f.kind === "video")).toBe(true);
  });

  it("merges a blurred low-quality rendition and the real rendition of the SAME photo into one slide", () => {
    // Same photoId (111111_222222_333333), two different renditions — a
    // small blurred placeholder and the real, larger copy. Must collapse to
    // ONE slide (the larger), not two — this was the literal bug: exact-URL
    // dedup treated them as different photos.
    const blurred = `<img src="https://scontent.fna.fbcdn.net/v/t39.30808-6/111111_222222_333333_n.jpg?stp=dst-webp_s16x16_blur" />`;
    const real = `<img src="https://scontent.fna.fbcdn.net/v/t39.30808-6/111111_222222_333333_n.jpg?stp=dst-jpg_s600x600" />`;
    const another = `<img src="https://scontent.fna.fbcdn.net/v/t39.30808-6/444444_555555_666666_n.jpg?stp=dst-jpg_s600x600" />`;
    const formats = tryStorySlides(STORY_URL, [[blurred, real, another].join("")]);
    expect(formats).toHaveLength(2); // 2 distinct photos, not 3
    expect(formats?.every((f) => f.kind === "image")).toBe(true);
    // The kept rendition is the larger (real) one, not the blurred placeholder.
    const merged = formats?.find((f) => f.directUrl?.includes("111111_222222_333333"));
    expect(merged?.directUrl).toContain("s600x600");
  });

  it("a pure photo story (no video slides) still returns every real photo, merged by identity", () => {
    const photo1 = `<img src="https://scontent.fna.fbcdn.net/v/t39.30808-6/111111_222222_333333_n.jpg?stp=dst-jpg_s600x600" />`;
    const photo2 = `<img src="https://scontent.fna.fbcdn.net/v/t39.30808-6/444444_555555_666666_n.jpg?stp=dst-jpg_s600x600" />`;
    const formats = tryStorySlides(STORY_URL, [[photo1, photo2].join("")]);
    expect(formats).toHaveLength(2);
    expect(formats?.every((f) => f.kind === "image" && f.isSeparateItem === true)).toBe(true);
  });

  it("never throws on a malformed URL", () => {
    expect(() => tryStorySlides("not a url", ["<html></html>"])).not.toThrow();
    expect(tryStorySlides("not a url", ["<html></html>"])).toBeNull();
  });
});
