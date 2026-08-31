import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  declaredUrlSize,
  looksOriginal,
  metaImageCandidates,
  metaVideoCandidates,
  pickWidest,
  rankRenditions,
} from "./media-quality";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

/**
 * Source with comments removed.
 *
 * These files deliberately quote the broken patterns they replaced, so a guard
 * that greps the raw text cannot tell "this bug is back" from "here is why this
 * bug existed" — and would fire on the documentation written to prevent it.
 */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * These are REGRESSION tests for a class of bug that produces no error and no
 * broken file: the download works, it is simply a smaller copy than the one the
 * platform was offering. Nothing else in the suite could catch that, which is
 * how three of these shipped at once.
 */
describe("rendition ranking", () => {
  it("picks the widest candidate, not the first", () => {
    const best = pickWidest([
      { url: "https://cdn/small.jpg", width: 320, height: 400 },
      { url: "https://cdn/big.jpg", width: 1440, height: 1800 },
      { url: "https://cdn/mid.jpg", width: 1080, height: 1350 },
    ]);
    expect(best?.url).toBe("https://cdn/big.jpg");
  });

  it("ranks by the LONGEST edge, so a tall portrait beats a short landscape of equal width", () => {
    const best = pickWidest([
      { url: "https://cdn/landscape.jpg", width: 1080, height: 608 },
      { url: "https://cdn/portrait.jpg", width: 1080, height: 1920 },
    ]);
    expect(best?.url).toBe("https://cdn/portrait.jpg");
  });

  it("never lets an UNDESCRIBED rendition outrank a described one", () => {
    // An unknown size is not a big size — that assumption is how a thumbnail
    // wins a ranking it should have lost.
    const best = pickWidest([
      { url: "https://cdn/unknown.jpg" },
      { url: "https://cdn/known.jpg", width: 900 },
    ]);
    expect(best?.url).toBe("https://cdn/known.jpg");
  });

  it("ignores candidates with no usable url", () => {
    expect(pickWidest([{ width: 4000 }, { url: "https://cdn/ok.jpg", width: 10 }])?.url).toBe("https://cdn/ok.jpg");
    expect(pickWidest([])).toBeNull();
    expect(pickWidest(undefined)).toBeNull();
  });
});

describe("URL size hints", () => {
  it("reads Pinterest rendition folders", () => {
    expect(declaredUrlSize("https://i.pinimg.com/736x/ab/cd/ef.jpg")).toBe(736);
    expect(declaredUrlSize("https://i.pinimg.com/1200x/ab/cd/ef.jpg")).toBe(1200);
  });

  it("reads Meta stp/cstp crop hints", () => {
    expect(declaredUrlSize("https://scontent.fbcdn.net/v/x.jpg?stp=dst-jpg_p1080x1350")).toBe(1350);
    expect(declaredUrlSize("https://scontent.fbcdn.net/v/x.jpg?stp=dst-webp_p130x130_q70")).toBe(130);
  });

  it("returns 0 when a URL advertises nothing", () => {
    expect(declaredUrlSize("https://i.pinimg.com/originals/ab/cd/ef.jpg")).toBe(0);
  });

  it("recognises an original-upload path", () => {
    expect(looksOriginal("https://i.pinimg.com/originals/ab/cd/ef.jpg")).toBe(true);
    expect(looksOriginal("https://i.pinimg.com/736x/ab/cd/ef.jpg")).toBe(false);
  });

  it("🔴 ranks the ORIGINAL above a larger-sounding rendition", () => {
    /*
      The case that matters: `/originals/` carries NO size hint at all, so a
      naive "biggest declared number wins" would rank the 736px preview above
      the untouched upload. Pinterest downloads did exactly that.
    */
    const ranked = rankRenditions([
      "https://i.pinimg.com/736x/ab/cd/ef.jpg",
      "https://i.pinimg.com/originals/ab/cd/ef.jpg",
    ]);
    expect(ranked[0]).toContain("/originals/");
  });

  it("is stable for equal candidates, so a tie never reshuffles anything", () => {
    const urls = ["https://cdn/a.jpg", "https://cdn/b.jpg", "https://cdn/c.jpg"];
    expect(rankRenditions(urls)).toEqual(urls);
  });
});

describe("Meta versioned-media payloads", () => {
  /**
   * 🔴 THE EXACT SHAPE THE OLD REGEX COULD NOT MATCH.
   *
   * `"image_versions2":\{"candidates":\[\{"[^}]*?"url":"…"` consumes the opening
   * quote of the first key and then needs another `"url":"` before the first
   * `}`. `[^}]` cannot cross that brace, so when `url` IS the first key — how
   * Meta emits it — the pattern never matched and every Threads photo fell
   * through to `display_url`, the resized display copy.
   */
  const urlFirst =
    '{"image_versions2":{"candidates":[{"url":"https://cdn/BIG_1440.jpg","width":1440,"height":1800},' +
    '{"url":"https://cdn/SMALL_640.jpg","width":640,"height":800}]},"display_url":"https://cdn/DISPLAY_1080.jpg"}';

  it("reads candidates when url is the FIRST key", () => {
    expect(metaImageCandidates(urlFirst).map((c) => c.url)).toEqual(["https://cdn/BIG_1440.jpg"]);
  });

  it("reads candidates when url is a LATER key", () => {
    const urlLater =
      '{"image_versions2":{"candidates":[{"width":1440,"height":1800,"url":"https://cdn/BIG_1440.jpg"}]}}';
    expect(metaImageCandidates(urlLater).map((c) => c.url)).toEqual(["https://cdn/BIG_1440.jpg"]);
  });

  it("returns ONE entry per picture, in carousel order", () => {
    const carousel =
      '{"a":{"image_versions2":{"candidates":[{"url":"https://cdn/P1_1440.jpg","width":1440},{"url":"https://cdn/P1_640.jpg","width":640}]}},' +
      '"b":{"image_versions2":{"candidates":[{"url":"https://cdn/P2_1440.jpg","width":1440}]}}}';
    // Order is the post's order — ranking must never reorder distinct photos.
    expect(metaImageCandidates(carousel).map((c) => c.url)).toEqual([
      "https://cdn/P1_1440.jpg",
      "https://cdn/P2_1440.jpg",
    ]);
  });

  it("ranks video_versions the same way", () => {
    const html =
      '{"video_versions":[{"url":"https://cdn/V_480.mp4","width":480,"height":852},' +
      '{"url":"https://cdn/V_1080.mp4","width":1080,"height":1920}]}';
    expect(metaVideoCandidates(html).map((c) => c.url)).toEqual(["https://cdn/V_1080.mp4"]);
  });

  it("returns nothing rather than guessing when there are no candidates", () => {
    expect(metaImageCandidates("{}")).toEqual([]);
    expect(metaVideoCandidates('{"video_url":"https://cdn/x.mp4"}')).toEqual([]);
  });
});

/**
 * Source guards. These read the shipped files, because the defects they cover
 * are single characters in an argument list or a regex — the kind that survives
 * every behavioural test in the suite and only shows up as "the download looks
 * softer than the original".
 */
describe("no silent quality degradation in the download pipeline", () => {
  const service = read("server", "services", "download-service.ts");

  it("🔴 never re-encodes audio that is already AAC", () => {
    /*
      The remux path is documented as lossless and was re-encoding audio to
      128 kbps on every download. Measured on a 240 kbps source: -47%.
    */
    expect(service).toMatch(/probed\.audio === "aac"\s*\?\s*\["-c:a", "copy"\]/);
    expect(service, "the unconditional 128k audio re-encode is back").not.toMatch(
      /"-c:a",\s*\n?\s*"aac",\s*\n?\s*"-b:a",\s*\n?\s*"128k"/,
    );
  });

  it("keeps the compatibility re-encode at CRF 20 or better", () => {
    /*
      This branch is unavoidable (bytevc1/VP9 do not decode everywhere) but it
      is the single biggest quality drop in the pipeline, and `withQualityLadder`
      sorts by height, which routes the tier most people pick straight into it.
      CRF costs no extra CPU, so there is no reason for it to be loose.
    */
    const crf = service.match(/"-c:v", "libx264", "-preset", "veryfast", "-crf", "(\d+)"/)?.[1];
    expect(crf, "the H.264 compatibility transcode's CRF").toBeDefined();
    expect(Number(crf)).toBeLessThanOrEqual(20);
  });

  it("🔴 treats an unknown codec probe as unknown, not as 'not H.264'", () => {
    // A probe that merely timed out used to trigger a full re-encode of a
    // source that may well have been H.264 and passthrough-able.
    expect(service).toMatch(/if \(!codecs\.video && format\.directUrl\) \{/);
  });

  it("proxies direct URLs as an untouched passthrough", () => {
    /*
      The proxy must never become a transform. It streams the upstream body and
      is allowed to do exactly two things to it: enforce an idle timeout and
      refuse an audio-only container for a video request.
    */
    const proxy = service.slice(service.indexOf("async function proxyDownload"), service.indexOf("function headerArgFor"));
    expect(proxy).toContain("withIdleTimeout(res.body");
    for (const forbidden of ["sharp(", "resize", "libx264", "-vf", "scale="]) {
      expect(proxy, `proxyDownload must not ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("extractors ask for the original, not the preview", () => {
  it("🔴 Pinterest prefers the pin's original over og:image", () => {
    const src = read("server", "extractors", "pinterest.ts");
    // `og:image` is the i.pinimg.com/736x/… share card; `orig` is the upload.
    // The old code was `metaContent(html, "og:image") || firstMatch(orig)`,
    // and `||` takes the first truthy branch — always the preview.
    expect(src).not.toMatch(/const img\s*=\s*\n?\s*metaContent\(html, "og:image"\) \|\|/);
    expect(src).toMatch(/rankRenditions\(candidates\)/);
  });

  it("🔴 Threads reads image candidates through the shared scanner", () => {
    const src = read("server", "extractors", "threads.ts");
    expect(src).toMatch(/metaImageCandidates\(html\)/);
    // Comments stripped first: the file DOCUMENTS the old pattern on purpose,
    // and a guard that cannot tell an explanation from the code it warns about
    // fails the moment someone writes the explanation.
    expect(codeOnly(src), "the unmatchable candidates regex is back in the code").not.toMatch(
      /image_versions2.{0,20}candidates.{0,20}\[\^\}\]/,
    );
  });

  it("🔴 Threads takes display_url only as a FALLBACK, never as an extra photo", () => {
    const src = read("server", "extractors", "threads.ts");
    const displayLoop = src.indexOf('display_url":"([^"]+)"');
    const guard = src.lastIndexOf("if (imgs.length === 0) {", displayLoop);
    expect(guard, "display_url must be inside an `imgs.length === 0` guard").toBeGreaterThan(-1);
  });

  it("Instagram ranks video renditions as well as images", () => {
    const src = read("server", "extractors", "instagram.ts");
    expect(src).toMatch(/pickWidest\(child\.video_versions\)/);
    expect(src, "video_versions must not be taken first-wins").not.toMatch(
      /video_versions\?\.find\(/,
    );
  });

  it("Twitter still asks for the original image and the top-bitrate video", () => {
    // Not changed by this audit — asserted so it cannot regress quietly.
    const src = read("server", "extractors", "twitter.ts");
    expect(src).toContain("?name=orig");
    expect(src).toMatch(/sort\(\(a, b\) => \(b\.bitrate \?\? 0\) - \(a\.bitrate \?\? 0\)\)/);
  });

  it("Facebook keeps the LARGEST rendition of each photo when merging renders", () => {
    const src = read("server", "extractors", "facebook.ts");
    expect(src).toMatch(/if \(!prev \|\| c\.size > prev\.size\)/);
  });
});
