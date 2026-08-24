import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isProtectedTarget, MEDIA_SELECTORS } from "./media-protection";

/**
 * Two suites, for the two ways this feature can fail.
 *
 * 1. It protects the wrong things — a scroll container, a paragraph, a button —
 *    which breaks the site. That is the decision function.
 * 2. It protects the right things but does so EXPENSIVELY, or by disabling the
 *    page rather than the media. That cannot be unit-tested behaviourally in a
 *    node environment, so it is asserted against the source: the whole
 *    performance case for this design is "two delegated listeners, no touch
 *    handlers, no DOM scanning", and a future edit that quietly adds a
 *    `touchstart` handler or a MutationObserver would invalidate it silently.
 *
 * Runs in the project's default node environment — no jsdom, because "no new
 * dependency" is an explicit requirement of this feature. `isProtectedTarget`
 * is written against the one capability it needs (`closest`), so a five-line
 * fake exercises the real function rather than a copy of it.
 */

const ROOT = path.resolve(__dirname, "../..");

/** An element that answers `closest()` from a list of selectors it matches. */
function fake(...matches: string[]) {
  return {
    closest(selector: string) {
      // The real `closest` takes a selector LIST; split it the same way so a
      // test written against "img,video,…" behaves like the DOM does.
      const wanted = selector.split(",").map((s) => s.trim());
      return matches.some((m) => wanted.includes(m)) ? {} : null;
    },
  };
}

describe("media protection · what gets protected", () => {
  it("protects every media element type", () => {
    for (const tag of ["img", "video", "picture", "canvas"]) {
      expect(isProtectedTarget(fake(tag)), tag).toBe(true);
    }
  });

  it("protects a marked wrapper, for full-bleed viewers", () => {
    expect(isProtectedTarget(fake("[data-media-protected]"))).toBe(true);
  });

  it("leaves ordinary page content alone", () => {
    // The whole "do not break the website" requirement, as a test: text,
    // buttons, links, inputs and scroll containers must keep native behaviour.
    expect(isProtectedTarget(fake())).toBe(false);
    expect(isProtectedTarget(null)).toBe(false);
  });

  it("honours the opt-out even when media also matches", () => {
    // A subtree that genuinely wants the native menu wins over the type match,
    // otherwise the escape hatch would not be one.
    expect(isProtectedTarget(fake("img", "[data-media-unprotected]"))).toBe(false);
  });

  it("names the selectors the CSS block also uses", () => {
    // Drift between the two halves is the failure this catches: CSS suppresses
    // the iOS callout, JS suppresses the menu and the drag, and they must agree
    // on what "media" means.
    for (const tag of ["img", "video", "picture", "canvas"]) {
      expect(MEDIA_SELECTORS.PROTECTED).toContain(tag);
    }
    expect(MEDIA_SELECTORS.OPT_OUT).toBe("[data-media-unprotected]");
  });
});

/**
 * Comments stripped, because these assertions are about CODE. The module's own
 * doc comment names `stopPropagation` and `MutationObserver` while explaining
 * why it uses neither — matching on the raw file would fail on the explanation
 * and, worse, would pass the day someone deleted the explanation.
 */
function codeOf(file: string): string {
  return readFileSync(path.join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("media protection · stays cheap and stays scoped", () => {
  const source = codeOf("lib/dom/media-protection.ts");

  it("listens for exactly contextmenu and dragstart", () => {
    const listened = [...source.matchAll(/addEventListener\(\s*"([a-z]+)"/g)].map((m) => m[1]);
    expect([...new Set(listened)].sort()).toEqual(["contextmenu", "dragstart"]);
  });

  it("never touches touch, pointer or scroll events", () => {
    // A touch listener here would be the one thing that could cost a frame
    // during a scroll, on exactly the low-end devices this must stay smooth on.
    expect(source).not.toMatch(/touchstart|touchmove|touchend|pointerdown|wheel|"scroll"/);
  });

  it("never scans or polls the DOM", () => {
    expect(source).not.toMatch(/MutationObserver|setInterval|requestAnimationFrame|querySelectorAll/);
  });

  it("suppresses the default without silencing app handlers", () => {
    // The app's own press-and-hold menus listen for `contextmenu` too. Stopping
    // propagation would trade the OS menu for no menu at all.
    expect(source).toContain("preventDefault");
    expect(source).not.toContain("stopPropagation");
  });

  it("mounts app-wide, not per component", () => {
    // 112 files render images here and 28 render video. If protection ever has
    // to be added per call site it will be missed, so assert the single mount
    // point still exists.
    const shell = codeOf("features/app-shell/deferred-shell.tsx");
    expect(shell).toContain("MediaProtection");
  });

  it("keeps the CSS half in the stylesheet, where it costs no JavaScript", () => {
    const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    // The property the iOS "Save to Photos" sheet actually obeys.
    expect(css).toContain("-webkit-touch-callout: none");
    expect(css).toContain("[data-media-unprotected]");
    // And it must NOT have reached for the blunt instrument: disabling touch
    // or pointer handling globally is the "breaks the website" failure.
    expect(css).not.toMatch(/^\s*\*\s*\{[^}]*touch-action:\s*none/m);
  });
});
