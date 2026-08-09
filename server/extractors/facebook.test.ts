import { describe, expect, it } from "vitest";

import { collectPhotos, declaredSize, mergePhotos, photoIdOf } from "./facebook";

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
