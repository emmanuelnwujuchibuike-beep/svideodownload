import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/*
  Owner, 2026-10-18: "unmute button on a video ad doesn't unmute". The full-screen ad's caption block is
  full width, later in the page and tappable, and it was padded (pr-16) rather than margined, so its box
  still covered the strip where the round sound button sits and took the tap (the headline there is a
  full-width button too). The block now ends where the rail starts, and the rail's sound button is above it.
*/
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const tappable = (full: string, creative: string) =>
  full.includes('<div className="pointer-events-auto mr-16">') &&
  !full.includes('<div className="pointer-events-auto pr-16">') &&
  /"z-30 bottom-\[calc\(var\(--ad-cta/.test(creative);

describe("the full-screen ad's sound button receives its taps", () => {
  const full = read("features/ads-platform/serve/fullscreen-video-ad.tsx");
  const creative = read("features/ads-platform/serve/self-ad-creative.tsx");

  it("the caption block stops before the rail, and the rail's sound button sits above it", () => {
    expect(tappable(full, creative)).toBe(true);
  });

  it("the tap still turns sound on for the session and unmutes the element inside the tap", () => {
    expect(creative).toContain("setAdSound(next);");
    expect(creative).toContain("v.muted = !next;");
    expect(creative).toContain("e.stopPropagation();");
  });

  it("teeth: the old padded block, or a sound button under the caption, fails", () => {
    expect(tappable(full.replace("pointer-events-auto mr-16", "pointer-events-auto pr-16"), creative)).toBe(false);
    expect(tappable(full, creative.replace('"z-30 bottom-[calc(', '"z-10 bottom-[calc('))).toBe(false);
  });
});
