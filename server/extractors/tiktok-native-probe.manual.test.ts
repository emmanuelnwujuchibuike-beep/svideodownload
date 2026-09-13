import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * LIVE probe (opt-in): the NATIVE TikTok route only — TikWM is stubbed to
 * fail so the race cannot pick it — and every video rendition saved for an
 * audio audit. See tiktok-audio-probe.manual.test.ts for the other half.
 *
 *     TIKTOK_PROBE=1 npx vitest run server/extractors/tiktok-native-probe.manual.test.ts
 */
const LIVE = process.env.TIKTOK_PROBE === "1";
const URL_ = process.env.TIKTOK_PROBE_URL ?? "https://vt.tiktok.com/ZSqyp7REt/";
const OUT = process.env.TIKTOK_PROBE_OUT ?? path.join(tmpdir(), "frenz-tiktok-probe/native");

describe.skipIf(!LIVE)("TikTok — native route audio probe", () => {
  it(
    "extracts natively and saves every rendition",
    async () => {
      const realFetch = globalThis.fetch;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const u = String(input);
          if (u.includes("tikwm.com")) return new Response("{}", { status: 503 });
          return realFetch(input, init);
        }),
      );
      const { tiktokExtractor } = await import("./tiktok");
      const meta = await tiktokExtractor.extract(URL_);
      vi.unstubAllGlobals();
      mkdirSync(OUT, { recursive: true });
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          meta.formats.map((f) => ({ id: f.formatId, kind: f.kind, label: f.label, vcodec: f.vcodec, res: f.resolution, tbr: f.tbr, size: f.filesize })),
          null,
          1,
        ),
      );
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
        console.log("saved", file, buf.length);
      }
    },
    120_000,
  );
});
