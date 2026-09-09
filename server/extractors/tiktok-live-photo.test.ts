import { describe, expect, it } from "vitest";

import { buildTikWmFormats } from "./tiktok";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A TIKTOK SLIDE IS NOT ALWAYS A PHOTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "this tiktok link is a multiple post of one image and one
 * video but when fetched it shows both as image instead of one as video."
 *
 * The fixture below is the REAL TikWM response for that link, captured
 * 2026-09-09 and trimmed to the fields this function reads. Two slides:
 * `live_images[0]` is null (a genuine still) and `live_images[1]` is an MP4 —
 * a TikTok Live Photo. The old code read only `images[]` and stamped both
 * `kind: "image"`.
 */

/** The owner's post, as TikWM actually returned it. */
const MIXED_POST = {
  id: "7682858350328958226",
  title: "I'm not like that boys",
  duration: 0,
  size: 0,
  // 🔴 On a photo post `play` is the MUSIC track, not a video — see the test
  // below that pins exactly this.
  play: "https://v16-ies-music.tiktokcdn-us.com/e221ddd7/6aaa973f/video/tos/song.mp4",
  hdplay: null as unknown as string | undefined,
  music: "https://v16-ies-music.tiktokcdn-us.com/e221ddd7/6aaa973f/video/tos/song.mp3",
  images: [
    "https://p16-common-sign.tiktokcdn-us.com/tos-alisg-i-photomode-sg/f432996c60a54eeebadc2266925e4dde~tplv.jpeg",
    "https://p16-common-sign.tiktokcdn-us.com/tos-alisg-i-photomode-sg/562a126bef974e19b31ef7d27cc20ec8~tplv.jpeg",
  ],
  live_images: [
    null,
    "https://v16m.tiktokcdn-us.com/2f717a8b/6aa1b0aa/video/tos/alisg/tos-alisg-ve-150690-sg/oM8QcIf8?mime_type=video_mp4",
  ],
};

describe("a mixed TikTok carousel", () => {
  const formats = buildTikWmFormats(MIXED_POST);
  const slides = formats.filter((f) => f.isSeparateItem);

  it("🔴 returns the Live Photo slide as a VIDEO, not an image", () => {
    const live = formats.find((f) => f.formatId === "live-1");
    expect(live, "slide 2 is a Live Photo and must be offered as a video").toBeDefined();
    expect(live!.kind).toBe("video");
    expect(live!.ext).toBe("mp4");
    expect(live!.directUrl).toContain("mime_type=video_mp4");
  });

  it("still returns the genuine still as an image", () => {
    const still = formats.find((f) => f.formatId === "img-0");
    expect(still).toBeDefined();
    expect(still!.kind).toBe("image");
    expect(still!.directUrl).toContain("photomode");
  });

  it("does NOT emit an image for the slide that is a video", () => {
    // One item per slide. Emitting both would make a 2-slide post download 3
    // files and put a still nobody asked for in the batch.
    expect(formats.find((f) => f.formatId === "img-1")).toBeUndefined();
  });

  it("keeps one separate item per slide, so the batch count matches the post", () => {
    expect(slides).toHaveLength(MIXED_POST.images.length);
  });

  /*
    🔴 THE FIX THAT WOULD HAVE BEEN WRONG.

    The obvious repair for "images present, video missing" is "emit `d.play` as
    a video too". On a photo post `d.play` is the SOUNDTRACK — measured on this
    exact link, `play === music_info.play`, `duration: 0`, `hdplay: null`, and
    the host is `v16-ies-music`. That fix would have offered the music as the
    missing clip, which is a worse bug than the one being fixed because it looks
    plausible.
  */
  it("never offers the music track as a video", () => {
    for (const f of formats.filter((x) => x.kind === "video")) {
      expect(f.directUrl, `${f.formatId} points at the music host`).not.toContain("ies-music");
    }
  });

  it("offers the sound as audio, which is what it is", () => {
    const audio = formats.find((f) => f.kind === "audio");
    expect(audio).toBeDefined();
    expect(audio!.isSeparateItem).toBeFalsy();
  });
});

describe("an ordinary all-stills slideshow is unchanged", () => {
  const formats = buildTikWmFormats({
    images: ["https://cdn/a.jpg", "https://cdn/b.png", "https://cdn/c.jpg"],
    music: "https://cdn/song.mp3",
  });

  it("returns every slide as an image", () => {
    expect(formats.filter((f) => f.kind === "image")).toHaveLength(3);
    expect(formats.filter((f) => f.kind === "video")).toHaveLength(0);
  });

  it("keeps the png/jpg extension it detects from the url", () => {
    expect(formats.find((f) => f.formatId === "img-1")!.ext).toBe("png");
    expect(formats.find((f) => f.formatId === "img-0")!.ext).toBe("jpg");
  });

  it("flags them all as separate items so Select all works", () => {
    expect(formats.filter((f) => f.isSeparateItem)).toHaveLength(3);
  });
});

describe("a single-slide post", () => {
  it("is an ordinary download, not a batch of one", () => {
    const formats = buildTikWmFormats({ images: ["https://cdn/only.jpg"] });
    expect(formats.filter((f) => f.isSeparateItem)).toHaveLength(0);
  });

  it("is still a video when that one slide is a Live Photo", () => {
    const formats = buildTikWmFormats({
      images: ["https://cdn/only.jpg"],
      live_images: ["https://cdn/only.mp4"],
    });
    expect(formats[0]!.kind).toBe("video");
    expect(formats[0]!.isSeparateItem).toBeFalsy();
  });
});

describe("live_images is treated as untrusted", () => {
  it("ignores a null, an empty string and a non-http value", () => {
    const formats = buildTikWmFormats({
      images: ["https://cdn/a.jpg", "https://cdn/b.jpg", "https://cdn/c.jpg"],
      live_images: [null, "", "javascript:alert(1)" as string],
    });
    // Every slide falls back to its still rather than becoming a video with a
    // url the download path would then be asked to fetch.
    expect(formats.filter((f) => f.kind === "image")).toHaveLength(3);
    expect(formats.filter((f) => f.kind === "video")).toHaveLength(0);
  });

  it("survives live_images being shorter than images, or absent entirely", () => {
    const short = buildTikWmFormats({
      images: ["https://cdn/a.jpg", "https://cdn/b.jpg"],
      live_images: ["https://cdn/a.mp4"],
    });
    expect(short.find((f) => f.formatId === "live-0")!.kind).toBe("video");
    expect(short.find((f) => f.formatId === "img-1")!.kind).toBe("image");

    expect(() => buildTikWmFormats({ images: ["https://cdn/a.jpg"] })).not.toThrow();
  });
});

describe("a normal video post still behaves", () => {
  const formats = buildTikWmFormats({
    duration: 12,
    play: "https://v16m.tiktokcdn-us.com/h264.mp4",
    hdplay: "https://v16m.tiktokcdn-us.com/hd.mp4",
    size: 1024,
    music: "https://cdn/song.mp3",
  });

  it("puts the H.264 stream FIRST, so nobody gets the re-encode by default", () => {
    // The 55s-to-first-byte lesson: `hdplay` is often H.265 and needs a
    // transcode, `play` is already H.264 and streams as-is.
    expect(formats[0]!.kind).toBe("video");
    expect(formats[0]!.directUrl).toBe("https://v16m.tiktokcdn-us.com/h264.mp4");
  });

  it("emits no image formats at all", () => {
    expect(formats.filter((f) => f.kind === "image")).toHaveLength(0);
  });
});
