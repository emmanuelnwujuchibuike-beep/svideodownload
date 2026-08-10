import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The two things that made a phone hot (owner, 2026-08-10: "a performance issue
 * in the landing page and history page … it becomes worse and overheats when I
 * fetch multiple downloads media").
 *
 * Neither is visible in a bundle size and neither has a wrong-looking pixel, so
 * nothing else in this suite can fail on them.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Comments name both problems; a raw scan would match its own prose. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

describe("download manager — one notification per frame", () => {
  const src = stripComments(read("features/downloads/manager.ts"));

  it("coalesces subscriber notifications into an animation frame", () => {
    /*
      Every patch used to notify every subscriber synchronously. During a batch
      that is several full re-renders a second — the floating progress card, the
      hero result panel, the download box, the history gallery, the topbar —
      each landing at an arbitrary point in a frame, none of them batchable by
      React because they originate outside its event system.
    */
    expect(src).toMatch(/requestAnimationFrame/);
    expect(src, "a queued frame must not be able to stack").toMatch(/frame\s*!==\s*null/);
  });

  it("still updates the snapshot eagerly", () => {
    // Deferring the RENDER is fine; deferring the DATA would let a click handler
    // read a stale queue and start a download that is already running.
    expect(src).toMatch(/tasks\s*=\s*\[\.\.\.tasks\]/);
  });

  it("paints terminal states immediately", () => {
    // "Saved" and "Failed" are what a person is waiting for; those skip the
    // queue so the answer never lags the bytes.
    expect(src).toMatch(/const terminal =/);
    expect(src).toMatch(/emit\(terminal\)/);
  });
});

describe("history gallery — no compositing pass per tile", () => {
  const src = stripComments(read("features/history/media-gallery.tsx"));

  it("keeps backdrop-filter off anything that repeats per item", () => {
    /*
      `backdrop-filter` is a separate GPU pass that re-samples everything behind
      the element, and it promotes the element to its own layer even at zero
      opacity. Three of them per tile across a hundred-plus tiles is a few
      hundred blur passes per scrolled frame, for chrome sitting on top of a
      photo that was already legible from its dark fill.

      One is allowed: the actions menu, which exists only while open.
    */
    const hits = src.match(/backdrop-blur/g) ?? [];
    expect(
      hits.length,
      `${hits.length} backdrop-blur layers in the gallery tile. Only the open ` +
        `actions menu may have one — anything rendered per item must not.`,
    ).toBeLessThanOrEqual(1);
  });
});
