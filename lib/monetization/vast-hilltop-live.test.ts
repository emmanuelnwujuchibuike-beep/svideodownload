import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseVast } from "./vast";

/**
 * The REAL HilltopAds response, captured from the live tag on 2026-09-02.
 *
 * ── Why a captured fixture and not a synthetic one ───────────────────────────
 *
 * The codec-selection bug that zeroed this zone's revenue was invisible to
 * every synthetic fixture in `vast.test.ts`, because those fixtures gave the
 * renditions DIFFERENT heights and the height sort therefore decided them. The
 * whole bug was that Hilltop ships webm/mp4/flv at IDENTICAL dimensions, so the
 * comparator returned 0 and document order won. Only the vendor's actual
 * document has that shape.
 *
 * This is the fixture the earlier tests could not have been.
 */
const XML = readFileSync(join(__dirname, "__fixtures__", "hilltop-vast.xml"), "utf8");

describe("🔴 the live HilltopAds VAST — the document that read 0 impressions", () => {
  it("parses at all", () => {
    const ad = parseVast(XML);
    expect(ad).not.toBeNull();
    expect(ad!.impressions.length).toBeGreaterThan(0);
  });

  it("🔴🔴 picks the MP4, not the WebM Hilltop lists first", () => {
    /*
      Before the fix this returned the .webm. WebKit cannot decode VP8 in a bare
      `<video src>`, `overlay.ts` fires the impression from the `playing` event,
      and so every iOS visitor produced no impression and no error — a flat zero
      on the dashboard while the banner and slider zones served normally.
    */
    const ad = parseVast(XML)!;
    expect(ad.mediaType).toBe("video/mp4");
    expect(ad.mediaUrl).toMatch(/\.mp4($|\?)/);
  });

  it("🔴 never selects or offers the FLV rendition", () => {
    // Flash video. Nothing has decoded it in years; offering it as a fallback
    // would just be a slower way to lose the impression.
    const ad = parseVast(XML)!;
    expect(ad.mediaUrl).not.toMatch(/\.flv/);
    for (const f of ad.fallbacks) expect(f.type).not.toBe("video/flv");
  });

  it("keeps a retryable fallback, so one dead codec is not the end of the ad", () => {
    const ad = parseVast(XML)!;
    expect(ad.fallbacks.length).toBeGreaterThan(0);
  });

  it("reads the impression pixel and the start tracker the network bills on", () => {
    const ad = parseVast(XML)!;
    expect(ad.impressions[0]).toMatch(/^https:\/\//);
    expect(ad.tracking.start?.[0]).toMatch(/^https:\/\//);
  });
});
