import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The landing page must never pull a whole video (owner Lighthouse runs,
 * 2026-08-09 and 2026-08-10).
 *
 * ── Two failures, and why the second one changed the rule ────────────────────
 *
 * 1. `ReelsWarmup` rendered a hidden <video> asking to preload the whole file.
 *    That attribute value does not mean "start early", it means download
 *    everything. Measured against production: the two clips it warms are
 *    11.4 MB and 1.7 MB, so one component was ~13 MB of a 14.5 MB landing
 *    payload, with TTI at 9.4 s.
 *
 * 2. It was changed to ask for metadata only, which should cost about 40 KB.
 *    The next run came back at 14,920 KiB — essentially unchanged. The usual
 *    excuses were checked with curl and did not apply: the media host answers
 *    Range with 206, and the container header sits at byte 36, so cheap
 *    metadata was genuinely available.
 *
 * The conclusion is that the attribute is a HINT, and a hint is not a budget.
 * A browser may buffer a playable media element as far past the request as it
 * likes, and no amount of re-tuning changes who holds the ceiling. So the rule
 * this file enforces is no longer "ask for less" — it is that the landing warms
 * the CONNECTION and a stated number of bytes, with no media element involved.
 *
 * ── Why a source test ────────────────────────────────────────────────────────
 * This costs no JavaScript and adds no bytes to any chunk, so `budget.test.ts`
 * cannot see it: the regression lives entirely in what the page FETCHES AT
 * RUNTIME. Nothing else in the suite can fail on it, which is exactly how it
 * shipped twice.
 */
const WARMUP = join(process.cwd(), "components/landing/reels-warmup.tsx");

/**
 * Strip comments before matching — not tidiness, correctness.
 *
 * The component's own header documents both rejected approaches by name. A scan
 * of raw source would read that prose, conclude the component still does the
 * thing it explains it stopped doing, and fail for the wrong reason. The same
 * trap has bitten three other guards in this repo.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

describe("ReelsWarmup — the landing's video budget is a number, not a hint", () => {
  const src = stripComments(readFileSync(WARMUP, "utf8"));

  it("renders no media element at all", () => {
    /*
      The strongest form of the rule. With no element there is no preload
      attribute to get wrong, and no buffering decision left to the browser.
    */
    expect(src, "a media element hands the byte ceiling back to the browser").not.toMatch(/<\s*(?:video|audio)\b/);
  });

  it("does not rely on a preload hint of any kind", () => {
    expect(src, "preload is advice a browser may ignore — it cannot cap anything").not.toMatch(/preload\s*=/);
  });

  it("fetches a bounded byte range instead", () => {
    // An open-ended fetch would be the whole file again, wearing a new API.
    expect(src).toMatch(/Range/);
    expect(src).toMatch(/bytes=0-/);
    expect(src, "the range must end at a constant, never be open-ended").not.toMatch(/bytes=0-`|bytes=0-"/);
  });

  it("states its ceiling, and keeps it small", () => {
    const declared = /WARM_BYTES\s*=\s*(\d+)\s*\*\s*1024/.exec(src);
    expect(declared, "no WARM_BYTES ceiling is declared").toBeTruthy();
    const kib = Number(declared![1]);
    // Two clips at this size. 256 KiB each would already be half a megabyte of
    // a stranger's data for a tap most visitors never make.
    expect(kib).toBeGreaterThan(0);
    expect(kib).toBeLessThanOrEqual(256);
  });

  it("opens the connection for free rather than by fetching", () => {
    // preconnect is DNS + TCP + TLS at zero bytes, which is most of the
    // cold-start cost on a phone.
    expect(src).toMatch(/rel="preconnect"/);
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

  it("abandons the warm-up when the visitor leaves", () => {
    // A speculative fetch that outlives the page is spending data on a
    // navigation that already happened.
    expect(src).toMatch(/AbortController/);
    expect(src).toMatch(/\.abort\(\)/);
  });
});
