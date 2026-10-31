import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/*
  Owner, 2026-10-31 (screenshot): the Exclusive post's @handle watermark sat at the bottom right, cut off by the screen
  edge and under the video's sound button; the "Exclusive" tag and the avatar touched the left edge too. The Exclusive
  list is pulled to the screen edges AND the Feed's post card pulls itself out again on phones — double full-bleed.
*/
const feed = readFileSync("features/sub/exclusive-feed.tsx", "utf8");
const card = readFileSync("features/feed/feed-post-card.tsx", "utf8");

const oneBleed = (src: string) => /<div className="max-sm:px-3">\s*<ExclusivePost /.test(src) && /<ul className="-mx-3 sm:-mx-4">/.test(src);
const watermarkBottomLeft = (src: string) => {
  const marks = src.slice(src.indexOf("function ExclusiveMarks"));
  return /absolute bottom-2\.5 left-3 [^"]*truncate[^"]*">\s*@\{handle\}/.test(marks) && !/bottom-3 right-3[^"]*">\s*@\{handle\}/.test(marks);
};

describe("an Exclusive post stays inside the screen", () => {
  it("the card is pulled to the edges once, not twice (phones)", () => {
    expect(oneBleed(feed)).toBe(true);
    expect(oneBleed(feed.replace('<div className="max-sm:px-3">', "<div>"))).toBe(false);
  });
  it("the watermark sits bottom-left inside the frame, clear of the video's buttons", () => {
    expect(watermarkBottomLeft(card)).toBe(true);
    expect(watermarkBottomLeft(card.replace("absolute bottom-2.5 left-3 ", "absolute bottom-3 right-3 "))).toBe(false);
  });
});
