import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BLUR_CLIP_FPS, BLUR_CLIP_MARK, BLUR_CLIP_SECONDS, BLUR_CLIP_UPSCALE, BLUR_CLIP_WIDTH, blurClipKey, buildBlurClipArgs, CLIP_NEEDS_WORK_FILTER, isWebmClip, lacksCurrentClip, postNeedsBlurWork } from "@/lib/sub/blur-clip-plan";

/**
 * A PostgREST `or` filter of the shapes CLIP_NEEDS_WORK_FILTER uses (is.null · not.like · ilike, quoted or not), run on
 * one value the way Postgres would: `*` is LIKE's `%`, ilike ignores case, NULL fails every comparison. Checked against
 * the production database on 2026-10-30 (read-only): the real filter selected exactly the rows lacksCurrentClip flags.
 */
function filterSelects(filter: string, value: string | null): boolean {
  return filter.split(/,(?=blur_video_url\.)/).some((clause) => {
    const m = clause.match(/^blur_video_url\.(not\.)?(is|like|ilike)\.(.*)$/);
    if (!m) throw new Error(`unknown clause ${clause}`);
    const [, not, op, raw] = m;
    if (op === "is") return (raw === "null") !== !!not && (raw === "null" ? value === null : false);
    if (value === null) return false;
    const pattern = raw!.replace(/^"(.*)"$/, "$1");
    const re = new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, op === "ilike" ? "is" : "s");
    return re.test(value) !== !!not;
  });
}
const CLIP_CASES: (string | null)[] = [
  null,
  "",
  "https://media.example/sub-blur/p/0-abc.mp4",
  "https://media.example/sub-blur/p/0-abc.MP4?v=1",
  "https://media.example/sub-blur/p/0-abc.webm",
  "https://media.example/sub-blur/p/0-abc.WEBM",
  "https://media.example/sub-blur/p/0-abc.webm?v=2",
  "https://media.example/sub-blur/p/0-abc.webm#t=1",
  "http://media.example/sub-blur/p/0-abc.mp4",
  "HTTPS://media.example/sub-blur/p/0-abc.mp4",
  "data:video/mp4;base64,AAAA",
  "https://media.example/a.webmx/clip.mp4",
  // recipe 3 (2026-10-30): a recipe-2 clip (4 s, 24 fps) is remade too
  "https://media.example/sub-blur/v2/p/0-abc.mp4",
  // only a worker clip under the current mark is current
  "https://media.example/sub-blur/v3/p/0-abc.mp4",
  "https://media.example/sub-blur/v3/p/0-abc.MP4?v=1",
  "https://media.example/sub-blur/v3/p/0-abc.webm",
  "http://media.example/sub-blur/v3/p/0-abc.mp4",
  "https://media.example/SUB-BLUR/V3/p/0-abc.mp4",
];
const CURRENT = "https://media.example/sub-blur/v3/p/0-abc.mp4";

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

  it("recipe 2 (owner, 2026-10-30: 'lagging low quality inside the blur'): the detail goes FIRST, then a smooth enlargement, at a fluid frame rate", () => {
    const steps = vf.split(",");
    const tiny = steps.indexOf(`scale=${BLUR_CLIP_WIDTH}:-2:flags=area`);
    const big = steps.findIndex((s) => s.startsWith(`scale=${BLUR_CLIP_WIDTH * BLUR_CLIP_UPSCALE}:-2`));
    const gauss = steps.findIndex((s) => s.startsWith("gblur="));
    // teeth: enlarging before the tiny scale would keep the detail; no enlargement leaves the blocks
    expect(tiny).toBeGreaterThan(-1);
    expect(big).toBeGreaterThan(tiny);
    expect(gauss).toBeGreaterThan(big);
    expect(BLUR_CLIP_UPSCALE).toBeGreaterThanOrEqual(3);
    expect(BLUR_CLIP_FPS).toBeGreaterThanOrEqual(24);
    expect(vf).toContain(`fps=${BLUR_CLIP_FPS}`);
    // Light's 48 px stays bounded at the enlarged size too
    expect(buildBlurClipArgs("in", "out", 500)[buildBlurClipArgs("in", "out", 500).indexOf("-vf") + 1]).toContain(`scale=${64 * BLUR_CLIP_UPSCALE}:-2`);
  });

  it("the worker stores its clips under the recipe mark, which is what makes them current", () => {
    const key = blurClipKey("p1", 0, "abc");
    expect(`https://media.example/${key}`).toContain(BLUR_CLIP_MARK);
    expect(lacksCurrentClip([`https://media.example/${key}`])).toBe(false);
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

  it("asks the worker for a clip exactly when no current, iPhone-playable one exists", () => {
    expect(lacksCurrentClip([])).toBe(true);
    expect(lacksCurrentClip([undefined, null])).toBe(true);
    expect(lacksCurrentClip(["https://media.example/a.webm"])).toBe(true);
    expect(lacksCurrentClip(["https://media.example/a.webm", CURRENT])).toBe(false);
    expect(lacksCurrentClip([CURRENT])).toBe(false);
    // an older or browser-made MP4 plays meanwhile, but is remade (recipe 2)
    expect(lacksCurrentClip(["https://media.example/b.mp4"])).toBe(true);
    // teeth for recipe 3: a recipe-2 worker clip is no longer current — the stuttering 4 s loops are all remade
    expect(lacksCurrentClip(["https://media.example/sub-blur/v2/p/0-abc.mp4"])).toBe(true);
    expect(BLUR_CLIP_FPS).toBeGreaterThanOrEqual(30);
    expect(BLUR_CLIP_SECONDS).toBeGreaterThanOrEqual(6);
  });

  it("the worker's queue and the feed's ask are ONE rule (code review, 2026-10-30): the filter selects exactly what lacksCurrentClip flags", () => {
    for (const v of CLIP_CASES) expect(filterSelects(CLIP_NEEDS_WORK_FILTER, v), JSON.stringify(v)).toBe(lacksCurrentClip([v]));
  });

  it("teeth: the old filter (null or ending .webm) misses clips the feed kept asking for — the endless kick", () => {
    const old = "blur_video_url.is.null,blur_video_url.ilike.*.webm";
    const missed = CLIP_CASES.filter((v) => lacksCurrentClip([v]) && !filterSelects(old, v));
    expect(missed).toEqual([
      "",
      "https://media.example/sub-blur/p/0-abc.mp4",
      "https://media.example/sub-blur/p/0-abc.MP4?v=1",
      "https://media.example/sub-blur/p/0-abc.webm?v=2",
      "https://media.example/sub-blur/p/0-abc.webm#t=1",
      "http://media.example/sub-blur/p/0-abc.mp4",
      "HTTPS://media.example/sub-blur/p/0-abc.mp4",
      "data:video/mp4;base64,AAAA",
      "https://media.example/a.webmx/clip.mp4",
      "https://media.example/sub-blur/v2/p/0-abc.mp4",
      "http://media.example/sub-blur/v3/p/0-abc.mp4",
      "https://media.example/SUB-BLUR/V3/p/0-abc.mp4",
    ]);
    // and the filter without the recipe clause would never remake an old MP4 (teeth for recipe 2)
    const withoutMark = CLIP_NEEDS_WORK_FILTER.split(/,(?=blur_video_url\.)/).filter((c) => !c.includes(BLUR_CLIP_MARK)).join(",");
    expect(filterSelects(withoutMark, "https://media.example/sub-blur/p/0-abc.mp4")).toBe(false);
    expect(filterSelects(CLIP_NEEDS_WORK_FILTER, "https://media.example/sub-blur/p/0-abc.mp4")).toBe(true);
    // and the emulator itself bites: a filter that selects nothing disagrees with the rule
    expect(CLIP_CASES.every((v) => filterSelects("blur_video_url.is.null", v) === lacksCurrentClip([v]))).toBe(false);
  });

  it("checks every slide of an album, not just the first", () => {
    const mp4 = CURRENT;
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
