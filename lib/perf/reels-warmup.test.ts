import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The landing page must never preload a whole video (owner Lighthouse run,
 * 2026-08-09: "the landing page still feels slow while opening").
 *
 * ── The measurement this pins ────────────────────────────────────────────────
 * A `<video>` with the `auto` preload value does not mean "start early". It
 * means **download the entire file**. `ReelsWarmup` used it for the first clip, and measured against
 * production on 2026-08-09 the two clips it warms were 11.4 MB and 1.7 MB — so
 * one component accounted for ~13.1 MB of the landing's 14.5 MB total payload
 * (Lighthouse: "Avoid enormous network payloads — 14,569 KiB"), with TTI at
 * 9.4 s.
 *
 * ── Why a source test and not a bundle-size test ─────────────────────────────
 * This costs no JavaScript and adds no bytes to any chunk, so `budget.test.ts`
 * cannot see it — the regression is entirely in what the page FETCHES AT
 * RUNTIME. Nothing else in the suite can fail on it, which is exactly how it
 * shipped in the first place. The attribute is one word; the cost is eleven
 * megabytes of a stranger's mobile data.
 */
const WARMUP = join(process.cwd(), "components/landing/reels-warmup.tsx");

describe("ReelsWarmup — never download a whole video on the landing page", () => {
  const src = readFileSync(WARMUP, "utf8");

  it("does not preload whole files", () => {
    /*
      Matches the attribute in any form: a literal, or a ternary that can yield
      it. Deliberately NOT written with the offending string spelled out in this
      file's own prose — a source-scanning test that matches its own comments is
      a test that fails for the wrong reason (see the same trap in
      lib/design-tokens.test.ts).
    */
    expect(src, "the whole-file preload value downloads the ENTIRE video — measured at 11.4 MB").not.toMatch(
      /preload\s*=\s*(?:"auto"|\{[^}]*["']auto["'][^}]*\})/,
    );
  });

  it('preloads metadata only', () => {
    expect(src).toMatch(/preload\s*=\s*"metadata"/);
  });

  it("still gates on connection quality before fetching anything", () => {
    // The warm-up is opt-in on the visitor's connection, not on ours.
    expect(src).toContain("saveData");
    expect(src).toContain("effectiveType");
    expect(src).toMatch(/downlink/);
  });

  it("still waits for load + idle, so it cannot compete with first paint", () => {
    expect(src).toMatch(/requestIdleCallback/);
    expect(src).toMatch(/readyState === "complete"|addEventListener\("load"/);
  });

  it("warms at most two clips", () => {
    expect(src).toMatch(/urls\.slice\(0,\s*2\)/);
  });
});
