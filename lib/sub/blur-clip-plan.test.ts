import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BLUR_CLIP_SECONDS, BLUR_CLIP_WIDTH, buildBlurClipArgs, isWebmClip, lacksPlayableClip, postNeedsBlurWork } from "@/lib/sub/blur-clip-plan";

/**
 * The worker's blurred clip for a locked video (owner, 2026-10-29: every exclusive post autoplays blurred to a
 * non-subscriber). These read the exact ffmpeg command: it must destroy the detail, read only the first seconds of the
 * private file, carry no sound, and produce the one format every iPhone plays.
 */
describe("the server's blurred clip", () => {
  const args = buildBlurClipArgs("https://private.example/sub/x.mp4?sig=1", "/tmp/out.mp4");
  const vf = args[args.indexOf("-vf") + 1] ?? "";

  it("reads only the first seconds of the private file (-t before -i)", () => {
    expect(args.indexOf("-t")).toBeGreaterThan(-1);
    expect(args.indexOf("-t")).toBeLessThan(args.indexOf("-i"));
    expect(args[args.indexOf("-t") + 1]).toBe(String(BLUR_CLIP_SECONDS));
  });

  it("is 24 px wide and blurred — nothing to un-blur", () => {
    expect(vf).toContain(`scale=${BLUR_CLIP_WIDTH}:-2`);
    expect(vf).toMatch(/boxblur=/);
    expect(BLUR_CLIP_WIDTH).toBeLessThanOrEqual(32);
  });

  it("has no sound, and is H.264 baseline MP4 with faststart", () => {
    expect(args).toContain("-an");
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx264");
    expect(args[args.indexOf("-profile:v") + 1]).toBe("baseline");
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
    expect(args.at(-1)).toBe("/tmp/out.mp4");
  });

  it("knows a WebM clip from an MP4 one (teeth: the remake query depends on it)", () => {
    expect(isWebmClip("https://media.example/a/b.webm")).toBe(true);
    expect(isWebmClip("https://media.example/a/b.WEBM?x=1")).toBe(true);
    expect(isWebmClip("https://media.example/a/b.mp4")).toBe(false);
    expect(isWebmClip(null)).toBe(false);
  });

  it("asks the worker for a clip exactly when no iPhone-playable one exists", () => {
    expect(lacksPlayableClip([])).toBe(true);
    expect(lacksPlayableClip([undefined, null])).toBe(true);
    expect(lacksPlayableClip(["https://media.example/a.webm"])).toBe(true);
    expect(lacksPlayableClip(["https://media.example/a.webm", "https://media.example/b.mp4"])).toBe(false);
    expect(lacksPlayableClip(["https://media.example/b.mp4"])).toBe(false);
  });

  it("checks every slide of an album, not just the first", () => {
    const mp4 = "https://media.example/a.mp4";
    const still = "data:image/webp;base64,AAAA";
    expect(postNeedsBlurWork([{ kind: "video", blurVideoUrl: mp4 }, { kind: "video" }], true, mp4)).toBe(true);
    expect(postNeedsBlurWork([{ kind: "video", blurVideoUrl: mp4 }, { kind: "image" }], true, mp4)).toBe(true);
    expect(postNeedsBlurWork([{ kind: "video", blurVideoUrl: mp4 }, { kind: "image", blurUrl: still }], true, mp4)).toBe(false);
    expect(postNeedsBlurWork(undefined, true, null)).toBe(true);
    expect(postNeedsBlurWork(undefined, false, null)).toBe(false);
  });
});

describe("the blurred slideshow", () => {
  const src = readFileSync("features/sub/blurred-slides.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("advances by itself, wraps to the first slide, and holds while a finger is on it (owner, 2026-10-29)", () => {
    expect(src).toMatch(/const SLIDE_MS = \d+;/);
    expect(src).toMatch(/window\.setInterval\(/);
    expect(src).toMatch(/\+ 1\) % count/);
    expect(src).toMatch(/addEventListener\("pointerdown", hold/);
    // only while on screen and the tab is visible — nothing runs for a card off screen
    expect(src).toMatch(/!visible \|\| holding \|\| document\.hidden/);
  });
});

describe("the blurred clip player", () => {
  const src = readFileSync("features/sub/blurred-clip.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("forces muted + inline before it plays (iOS refuses play() otherwise) and never stops for Reduce Motion", () => {
    expect(src).toContain("v.muted = true;");
    expect(src).toContain('v.setAttribute("muted", "");');
    expect(src).toContain('v.setAttribute("playsinline", "");');
    expect(src).not.toMatch(/prefers-reduced-motion/);
    // retried when data arrives and on the next touch (Low Power Mode refuses autoplay)
    expect(src).toMatch(/addEventListener\("loadeddata", tryPlay\)/);
    expect(src).toMatch(/document\.addEventListener\("pointerdown", tryPlay/);
  });
});
