import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { tiktokExtractor } from "./tiktok";

/**
 * LIVE probe (opt-in): resolve one TikTok link through the real extractor and
 * save every video format's bytes for an ffprobe/ffmpeg audio audit.
 *
 *     TIKTOK_PROBE=1 TIKTOK_PROBE_URL=https://vt.tiktok.com/ZSqyp7REt/ \
 *       npx vitest run server/extractors/tiktok-audio-probe.manual.test.ts
 *
 * Owner, 2026-09-13: "Some downloads' audio is altered halfway and stops and
 * continues, especially TikTok video." The audit runs outside the test.
 */
const LIVE = process.env.TIKTOK_PROBE === "1";
const URL_ = process.env.TIKTOK_PROBE_URL ?? "https://vt.tiktok.com/ZSqyp7REt/";
const OUT = process.env.TIKTOK_PROBE_OUT ?? path.join(tmpdir(), "frenz-tiktok-probe");

describe.skipIf(!LIVE)("TikTok — live audio probe", () => {
  it(
    "extracts and saves every video rendition",
    async () => {
      const meta = await tiktokExtractor.extract(URL_);
      mkdirSync(OUT, { recursive: true });
      const summary = meta.formats.map((f) => ({
        formatId: f.formatId,
        kind: f.kind,
        label: f.label,
        ext: f.ext,
        vcodec: f.vcodec,
        acodec: f.acodec,
        resolution: f.resolution,
        filesize: f.filesize,
        directUrl: f.directUrl?.slice(0, 120),
        needsTranscode: (f as { needsTranscode?: boolean }).needsTranscode ?? null,
      }));
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ title: meta.title, extractor: meta.extractor, formats: summary }, null, 1));
      expect(meta.formats.length).toBeGreaterThan(0);
      for (const f of meta.formats) {
        if (f.kind !== "video" || !f.directUrl) continue;
        const res = await fetch(f.directUrl, { headers: f.httpHeaders ?? {} });
        if (!res.ok) {
          // eslint-disable-next-line no-console
          console.log("fetch failed", f.formatId, res.status);
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const file = `${OUT}/${f.formatId.replace(/[^a-z0-9_-]/gi, "_")}.${f.ext}`;
        writeFileSync(file, buf);
        // eslint-disable-next-line no-console
        console.log("saved", file, buf.length, "bytes");
      }
    },
    120_000,
  );
});
