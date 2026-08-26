import { afterEach, describe, expect, it, vi } from "vitest";

import {
  distinctVideos,
  preferCleanSnapMedia,
  snapFormat,
  stripSnapWatermark,
} from "./snapchat";

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

  /*
    🔴 THIS TEST WAS INVERTED ON 2026-08-26, AND THE REASON MATTERS.

    The August version asserted the OPPOSITE — that bolt-gcdn is never
    rewritten — after probing the live clip snapchat.com/t/zWJDbGIN, where
    `.1034.` and every other rendition 404'd. That reasoning was sound for that
    clip and the conclusion drawn from it ("bolt-gcdn has no clean rendition")
    was too broad.

    It used to assert that bolt-gcdn is NEVER rewritten, from an August probe of
    one clip where `.1034.` 404'd. Re-probed against the owner's example
    (snapchat.com/t/OafU7rPV → bolt-gcdn/u/jRlgbOdOZ34pwjJoKVhTL.27.IRZXSOY):

      .27.   → 206 video/mp4 540×960  — Snapchat ghost + @handle burned in
      .1034. → 206 video/mp4 480×852  — same clip, overlay GONE

    Both frames were extracted and looked at. `.1034.` exists on bolt-gcdn for
    this clip and not for the other, so availability is PER-CLIP and a host
    allowlist cannot express it — which is exactly why some Spotlight downloads
    came out clean and others watermarked.

    The rewrite is therefore host-agnostic again, and the "does it exist?"
    question moved to `preferCleanSnapMedia`, which asks the CDN instead of
    guessing.
  */
  it("computes the clean candidate on ANY host, bolt-gcdn included", () => {
    const live =
      "https://bolt-gcdn.sc-cdn.net/y/ozcsuISdRBcfOKb3N9CKU.27.IRZXSOY?mo=U3BvdGxpZ2h0U2hhcmluZw&uc=46";
    const out = stripSnapWatermark(live);
    expect(out).toContain(".1034.");
    expect(out).not.toContain("mo=");
    expect(out).not.toContain("uc=");
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
 * ═══════════════════════════════════════════════════════════════════════════
 *  preferCleanSnapMedia — the part that decides what is actually downloaded
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `stripSnapWatermark` only says what the clean URL WOULD be. This asks the CDN
 * whether it is really there, because availability turned out to be per-clip.
 *
 * 🔴 Every failure path must return the ORIGINAL url. The August regression was
 * caused by handing the pipeline a `.1034.` that did not exist: the download
 * failed, the pipeline fell back to yt-dlp, and yt-dlp's Spotlight extractor
 * returns a watermarked render. A dead "clean" URL is strictly worse than a
 * live watermarked one, which is what these cases pin.
 */
describe("preferCleanSnapMedia", () => {
  const WATERMARKED =
    "https://bolt-gcdn.sc-cdn.net/u/abc123.27.TOK?mo=U3BvdGxpZ2h0U2hhcmluZw&uc=8";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubFetch = (impl: (url: string) => Partial<Response> | Promise<Partial<Response>>) => {
    const spy = vi.fn(async (input: RequestInfo, _init?: RequestInit) => {
      const out = await impl(String(input));
      return {
        ok: out.ok ?? true,
        headers: out.headers ?? new Headers({ "content-type": "video/mp4" }),
        ...out,
      } as Response;
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  };

  it("uses the clean rendition when the CDN serves it as video", async () => {
    stubFetch(() => ({ ok: true, headers: new Headers({ "content-type": "video/mp4" }) }));
    const out = await preferCleanSnapMedia(WATERMARKED);
    expect(out).toContain(".1034.");
  });

  it("🔴 keeps the ORIGINAL when the clean rendition 404s", async () => {
    // The August regression, pinned: this is the clip where .1034. is absent.
    stubFetch(() => ({ ok: false, headers: new Headers() }));
    expect(await preferCleanSnapMedia(WATERMARKED)).toBe(WATERMARKED);
  });

  it("🔴 keeps the ORIGINAL when the rendition answers with an IMAGE", async () => {
    // `.256.` is a JPEG thumbnail that also returns 206 — accepting any 2xx
    // would silently swap the video for a still.
    stubFetch(() => ({ ok: true, headers: new Headers({ "content-type": "image/jpeg" }) }));
    expect(await preferCleanSnapMedia(WATERMARKED)).toBe(WATERMARKED);
  });

  it("keeps the ORIGINAL when the probe throws or times out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("aborted");
    }));
    expect(await preferCleanSnapMedia(WATERMARKED)).toBe(WATERMARKED);
  });

  it("makes NO request for an already-clean story URL", async () => {
    const spy = stubFetch(() => ({ ok: true }));
    const clean = "https://cf-st.sc-cdn.net/d/ABC123def.mp4";
    expect(await preferCleanSnapMedia(clean)).toBe(clean);
    // The cost argument for multi-snap stories depends on this: a story of ten
    // clean snaps must not fire ten probes.
    expect(spy).not.toHaveBeenCalled();
  });

  it("asks for ONE BYTE, not the file", async () => {
    const spy = stubFetch(() => ({ ok: true }));
    await preferCleanSnapMedia(WATERMARKED);
    const init = spy.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Range).toBe("bytes=0-0");
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

/**
 * ── The five-fix bug, pinned ──────────────────────────────────────────────
 * A story link kept returning duplicates, the wrong media, or nothing. Five
 * reasoned fixes failed because none of them ever touched a real page.
 *
 * The actual cause, found the moment a live page was fetched: Snapchat wraps
 * SOME string fields as `{ value: "..." }` and leaves others plain, inside the
 * same object. `snapUrls.mediaUrl` is a plain string; `snapId`,
 * `mediaPreviewUrl` and `snapTitle` are wrappers.
 *
 * Treating a wrapper as a string threw a TypeError, the surrounding try/catch
 * swallowed it, and extraction fell through to the blanket CDN scan — which is
 * what produced a picker of 19 identical wrong tiles. A crash in the good path
 * became garbage in the UI instead of an error anyone could see.
 *
 * The fixtures below use the EXACT shape observed on a live page.
 */
describe("wrapped {value} fields — the real page shape", () => {
  const CDN = "https://cf-st.sc-cdn.net";
  const liveSnap = (id: string, media: string) => ({
    // Wrapped, exactly as Snapchat sends it.
    snapId: { value: id },
    snapMediaType: 1,
    snapTitle: null,
    snapUrls: {
      // Plain string — in the SAME object as the wrappers above.
      mediaUrl: `${CDN}/d/${media}.1034.TOK?mo=abc`,
      mediaPreviewUrl: { value: `${CDN}/d/${media}.256.TOK?mo=xyz` },
      overlayUrl: null,
    },
  });

  it("reads a wrapped preview without throwing", () => {
    // The exact call that crashed and dumped extraction into the fallback.
    expect(() => snapFormat(liveSnap("a", "aaa"), 0, 3)).not.toThrow();
  });

  it("uses the wrapped preview as that snap's own cover", () => {
    const f = snapFormat(liveSnap("a", "aaa"), 0, 3);
    expect(f.thumbnail).toBe(`${CDN}/d/aaa.256.TOK?mo=xyz`);
    expect(f.directUrl).toContain("aaa.1034.TOK");
  });

  it("flags every snap of a multi-snap story as a separate item", () => {
    const f = snapFormat(liveSnap("a", "aaa"), 0, 3);
    expect(f.isSeparateItem).toBe(true);
    expect(f.label).toBe("Story 1");
  });

  it("does not flag a single-snap story as a batch", () => {
    expect(snapFormat(liveSnap("a", "aaa"), 0, 1).isSeparateItem).toBe(false);
  });

  it("survives a snap with no preview at all", () => {
    const bare = { snapId: { value: "x" }, snapMediaType: 1, snapUrls: { mediaUrl: `${CDN}/d/x.1034.T` } };
    expect(snapFormat(bare, 0, 2).thumbnail).toBeNull();
  });

  it("treats an image snap as an image", () => {
    const img = { ...liveSnap("i", "iii"), snapMediaType: 0 };
    const f = snapFormat(img, 0, 7);
    expect(f.kind).toBe("image");
    expect(f.ext).toBe("jpg");
  });
});
