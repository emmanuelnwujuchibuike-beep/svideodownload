import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Two owner reports, 2026-10-27:
 *  · "Story keep playing the sound even without the video playing and when I go out of the story the sound still
 *    continue." — the story viewer must stop and empty the video it leaves, pause in the background, and stop a
 *    video whose picture never arrives.
 *  · "Since the earlier Wallpaper fix the bottom part of the Wallpaper in PWA now shows white." — pinning <body>
 *    with position: fixed shortened the full-screen viewer in the installed iOS app; it must not come back.
 * Source checks, because neither failure shows up outside a phone.
 */

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const story = src("features/app-shell/dashboard/story-viewer.tsx");
const wall = src("features/wallpapers/wallpaper-reels.tsx");

export function storyStopsItsSound(code: string): boolean {
  return (
    /removeAttribute\("src"\)/.test(code) &&
    /v\.load\(\)/.test(code) &&
    /visibilitychange/.test(code) &&
    /pagehide/.test(code) &&
    /totalVideoFrames === 0/.test(code)
  );
}

export function wallpaperNeverPinsBody(code: string): boolean {
  return !/body\.style\.position\s*=\s*"fixed"/.test(code) && /addEventListener\("touchmove", onMove, \{ passive: false \}\)/.test(code);
}

describe("story sound stops with the story", () => {
  it("the viewer empties the video it leaves, pauses in the background, and stops a video with no picture", () => {
    expect(storyStopsItsSound(story)).toBe(true);
  });
  it("teeth: a viewer that only unmounts the element fails", () => {
    expect(storyStopsItsSound(story.replace(/removeAttribute\("src"\)/g, "removeAttribute(\"x\")"))).toBe(false);
  });
});

describe("wallpaper viewer reaches the bottom of the screen", () => {
  it("the page behind is held by a touch lock, not by pinning <body>", () => {
    expect(wallpaperNeverPinsBody(wall)).toBe(true);
  });
  it("teeth: bringing back the body pin fails", () => {
    expect(wallpaperNeverPinsBody(`${wall}\nbody.style.position = "fixed";`)).toBe(false);
  });
});
