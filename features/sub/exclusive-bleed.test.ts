import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** The Exclusive feed's cards run edge to edge (owner, 2026-10-18): no side gutter, no side radius. */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const bleeds = (feedSrc: string, css: string) => {
  const rule = css.slice(css.indexOf(".ex-card--bleed {"), css.indexOf("}", css.indexOf(".ex-card--bleed {")));
  return (
    /<ul className="-mx-3 [^"]*sm:-mx-4">/.test(feedSrc) &&
    /<article className="ex-card ex-card--bleed /.test(feedSrc) &&
    /border-radius:\s*0/.test(rule) &&
    /border-left-width:\s*0/.test(rule) &&
    /border-right-width:\s*0/.test(rule)
  );
};

describe("Exclusive feed cards reach the screen edges", () => {
  it("the list pulls out of the page gutters and the card has no side radius or hairlines", () => {
    expect(bleeds(read("features/sub/exclusive-feed.tsx"), read("app/globals.css"))).toBe(true);
  });

  it("teeth: a padded list, or a rounded card, fails", () => {
    const feed = read("features/sub/exclusive-feed.tsx");
    const css = read("app/globals.css");
    expect(bleeds(feed.replace('<ul className="-mx-3', '<ul className="mx-0'), css)).toBe(false);
    expect(bleeds(feed, css.replace(/(\.ex-card--bleed \{\s*border-radius:\s*)0/, "$11rem"))).toBe(false);
  });
});
