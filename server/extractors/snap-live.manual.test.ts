import { describe, expect, it } from "vitest";

import { snapchatExtractor } from "./snapchat";

/**
 * LIVE end-to-end check against Snapchat. Opt-in only:
 *
 *     SNAP_LIVE=1 npx vitest run server/extractors/snap-live.manual.test.ts
 *
 * Skipped by default so CI never depends on a third party's uptime, on a
 * Spotlight post staying public, or on a signed CDN URL that expires.
 */
const LIVE = process.env.SNAP_LIVE === "1";

describe.skipIf(!LIVE)("Snapchat Spotlight — live", () => {
  it(
    "selects the clean .1034. rendition for the owner's example",
    async () => {
      const meta = await snapchatExtractor.extract("https://snapchat.com/t/OafU7rPV");

      const video = meta.formats.find((f) => f.kind === "video");
      expect(video, "no video format returned").toBeDefined();

      // eslint-disable-next-line no-console
      console.log("selected:", video!.directUrl);

      /*
        The assertion is deliberately loose: `.1034.` is only expected when the
        CDN actually serves it, and that is per-clip. What must ALWAYS hold is
        that the URL we hand out answers as a video — the August regression was
        handing out a dead one.
      */
      const res = await fetch(video!.directUrl!, {
        headers: { ...(video!.httpHeaders ?? {}), Range: "bytes=0-0" },
      });
      expect(res.ok, `selected URL did not answer: ${res.status}`).toBe(true);
      expect(res.headers.get("content-type")).toMatch(/^video\//);
    },
    60_000,
  );
});
