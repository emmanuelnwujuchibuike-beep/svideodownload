import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildBlurClipArgs } from "@/lib/sub/blur-clip-plan";
import { BLUR_CLIP_WIDTH_FOR, BLUR_CSS_CLASS, BLUR_LEVELS, BLUR_STILL_WIDTH_FOR, blurAmountOf, blurBand, blurClass, blurClipWidth, blurLevelForAmount, blurPreviewsChange, blurStillWidth, DEFAULT_BLUR_LEVEL, isBlurLevel, normalizeBlurLevel } from "@/lib/sub/blur-level";

/**
 * How blurry a locked exclusive post looks — the creator's choice (owner, 2026-10-30: "Make users be able to set how
 * blurry they want the post to be"; "the auto play should be obvious movement not too much thick blurred").
 */
const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("blur levels", () => {
  it("three levels, Medium by default; anything unknown (a database before 0307) is the default", () => {
    expect(BLUR_LEVELS).toEqual(["light", "medium", "strong"]);
    expect(DEFAULT_BLUR_LEVEL).toBe("medium");
    for (const v of [undefined, null, "", "extreme", 3]) expect(normalizeBlurLevel(v), String(v)).toBe("medium");
    for (const v of BLUR_LEVELS) expect(normalizeBlurLevel(v)).toBe(v);
  });

  it("Medium and Strong keep the 24 px clip and 20 px still every post already has; Light stores more", () => {
    expect(BLUR_CLIP_WIDTH_FOR).toEqual({ light: 48, medium: 24, strong: 24 });
    expect(BLUR_STILL_WIDTH_FOR).toEqual({ light: 32, medium: 20, strong: 20 });
  });

  it("only a change to or from Light needs the stored previews made again", () => {
    expect(blurPreviewsChange("medium", "strong")).toBe(false);
    expect(blurPreviewsChange("strong", "medium")).toBe(false);
    expect(blurPreviewsChange("medium", "light")).toBe(true);
    expect(blurPreviewsChange("light", "strong")).toBe(true);
    expect(blurPreviewsChange("light", "light")).toBe(false);
  });

  /*
    Owner, 2026-10-30, after the first fix: "the videos in exclusive are cracking … looking like low quality". A FIXED 7 px
    blur could not hide a 24 px clip's pixels on a full-width card (each ≈ 16 CSS px). The blur is now a share of the
    frame's width — about the same part of one clip pixel at any size — with a px fallback for older Safari.
  */
  const css = readFileSync("app/globals.css", "utf8");
  const rule = (cls: string) => new RegExp(`\\.${cls} \\{\\s*filter: blur\\((\\d+(?:\\.\\d+)?)px\\);\\s*filter: blur\\((\\d+(?:\\.\\d+)?)cqw\\);\\s*\\}`).exec(css);
  it("🔴 no cracking: each level's blur is a share of its frame (cqw), sized to smooth one clip pixel, with a px fallback", () => {
    for (const level of BLUR_LEVELS) expect(rule(BLUR_CSS_CLASS[level]), level).not.toBeNull();
    const cqw = (l: (typeof BLUR_LEVELS)[number]) => Number(rule(BLUR_CSS_CLASS[l])![2]);
    // in clip pixels: (blur as % of the frame) ÷ (100% ÷ the clip's width)
    const inClipPixels = (l: (typeof BLUR_LEVELS)[number]) => (cqw(l) * BLUR_CLIP_WIDTH_FOR[l]) / 100;
    // Medium (the default) smooths about three-quarters of a clip pixel: enough for no blocks, little enough for movement
    expect(inClipPixels("medium")).toBeGreaterThanOrEqual(0.6);
    expect(inClipPixels("medium")).toBeLessThanOrEqual(0.9);
    // the levels rise in order, and Strong stays at about the old look
    expect(inClipPixels("light")).toBeLessThan(inClipPixels("medium"));
    expect(inClipPixels("medium")).toBeLessThan(inClipPixels("strong"));
    expect(css).toMatch(/\.sub-blur-frame \{\s*container-type: inline-size;\s*\}/);
    // teeth: the fixed 7 px of the first fix would not pass as "a share of the frame"
    expect(rule("sub-blur-medium")![2]).not.toBe("7");
  });

  it("every frame a blurred preview fills is the container its blur is measured against", () => {
    expect(code("features/sub/blurred-slides.tsx")).toContain("BLUR_FRAME_CLASS)}");
    expect((code("features/sub/sub-gallery.tsx").match(/ROUNDED_CLIP, BLUR_FRAME_CLASS\)/g) ?? []).length).toBe(2);
    expect(code("features/sub/sub-composer.tsx")).toContain("ROUNDED_CLIP, BLUR_FRAME_CLASS)");
  });

  it("the worker's clip is made at the post's width, bounded (teeth: a fixed 24 px clip fails)", () => {
    const vf = (w?: number) => {
      const args = buildBlurClipArgs("in.mp4", "out.mp4", w);
      return args[args.indexOf("-vf") + 1] ?? "";
    };
    expect(vf()).toContain("scale=24:-2");
    expect(vf(BLUR_CLIP_WIDTH_FOR.light)).toContain("scale=48:-2");
    expect(vf(4)).toContain("scale=8:-2");
    expect(vf(4000)).toContain("scale=64:-2");
  });

  it("every blurred preview on screen uses the creator's level — no blur-xl left on a locked preview", () => {
    for (const f of ["features/sub/blurred-clip.tsx", "features/sub/blurred-slides.tsx", "features/sub/sub-gallery.tsx", "features/sub/sub-composer.tsx"]) {
      const src = code(f);
      expect(src, f).not.toMatch(/(?<!backdrop-)blur-xl/);
      expect(src, f).not.toMatch(/blur-\[28px\]/);
    }
    expect(code("features/sub/blurred-clip.tsx")).toContain("blurClass(level)");
    expect(code("features/sub/blurred-slides.tsx")).toContain("blurClass(level)");
    expect(code("features/sub/exclusive-feed.tsx")).toContain("level={card.blurLevel}");
    expect(code("features/sub/sub-post-chat-card.tsx")).toContain("level={preview.blurLevel}");
    expect(code("features/sub/sub-gallery.tsx")).toContain("level={p.blurLevel}");
  });

  it("the creator sets it: at publish (with the clip made at its size) and later from the post", () => {
    const composer = code("features/sub/sub-composer.tsx");
    expect(composer).toContain("<BlurLevelPicker value={blurLevel} onChange={setBlurLevel}");
    expect(composer).toContain("makeBlurClip(it.file, blurClipWidth(blurLevel))");
    expect(composer).toMatch(/audience === "locked" \? \{ blurLevel \} : \{\}/);
    expect(code("app/api/sub/posts/route.ts")).toContain("blurLevel: z.string().max(8).refine(isBlurLevel).optional()");
    expect(code("app/api/sub/posts/[id]/route.ts")).toContain("setSubPostBlurLevel(user.id, id, body.blurLevel)");
    const viewer = code("features/sub/sub-gallery.tsx");
    expect(viewer).toContain('aria-label="How blurry visitors see this post"');
    expect(viewer).toContain("body: JSON.stringify({ blurLevel: next })");
    expect(code("features/sub/blur-clip-backfill.ts")).toContain("makeBlurClip(t.url, t.width)");
    expect(readFileSync("supabase/migrations/0307_sub_post_blur_level.sql", "utf8")).toMatch(/add column if not exists blur_level text not null default 'medium'/);
  });
});

describe("the blurred slideshow and tiles (owner, 2026-10-30)", () => {
  const slides = code("features/sub/blurred-slides.tsx");

  it("🔴 the page scrolls over it: the row lets the browser pan BOTH ways (teeth: pan-x alone blocks a vertical drag)", () => {
    expect(slides).toContain("[touch-action:pan-x_pan-y]");
    expect(slides).not.toMatch(/"touch-pan-x"/);
  });

  it("🔴 it plays by itself on an iPhone: the snap is RELEASED before the smooth glide (teeth: a smooth scroll on a snapped row is pulled back)", () => {
    expect(slides).toMatch(/el\.style\.scrollSnapType = "none";[\s\S]{0,80}el\.scrollTo\(\{ left: to, behavior: "smooth" \}\)/);
    // and lands exactly on the slide edge, snap restored, once the glide settles
    expect(slides).toMatch(/el\.scrollLeft = to;\s*el\.style\.scrollSnapType = "";/);
    // a finger mid-glide gives the row straight back to the snap
    expect(slides).toMatch(/const hold = \(\) => \{\s*holding = true;[\s\S]{0,120}stopGlide\(\);/);
  });

  it("🔴 edge to edge: a show starts flush on its first slide and every layer covers its frame", () => {
    expect(slides).toContain("el.scrollLeft = 0;");
    expect(slides).toContain("className={BLUR_COVER}");
    expect(slides).not.toContain("-inset-5");
    expect(code("features/sub/blur-frame.ts")).toContain('BLUR_COVER = "absolute inset-0 h-full w-full scale-[1.15] object-cover"');
  });

  it("🔴 the profile tiles are really rounded on an iPhone (a playing, blurred clip escaped the corners)", () => {
    const gallery = code("features/sub/sub-gallery.tsx");
    expect((gallery.match(/ROUNDED_CLIP[,)]/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(code("features/sub/blur-frame.ts")).toContain("[-webkit-mask-image:-webkit-radial-gradient(white,black)]");
    expect(gallery).not.toContain("-inset-5");
  });

  it("only an on-screen clip plays (no autoPlay attribute — iOS decodes a limited number of videos at once)", () => {
    const clip = code("features/sub/blurred-clip.tsx");
    expect(clip).not.toMatch(/\n\s+autoPlay\n/);
    expect(clip).toMatch(/\n\s+muted\n\s+loop\n\s+playsInline/);
    expect(clip).toContain("if (inView) tryPlay();");
    expect(clip).toContain("else v.pause();");
  });
});

/**
 * The blur SLIDER (0310 — owner, 2026-10-30: "drag it to the right to increase and drag to left to reduce like reducing
 * volume"). A position falls in a band; the BAND sets what the stored preview holds, so no position shows more than Light.
 */
describe("the blur slider", () => {
  it("stores b0…b100 and refuses anything else", () => {
    for (const v of ["b0", "b5", "b35", "b99", "b100", "light", "medium", "strong"]) expect(isBlurLevel(v), v).toBe(true);
    for (const v of ["b101", "b-1", "b05", "b", "b1.5", "B50", "50", "", null]) expect(isBlurLevel(v), String(v)).toBe(false);
    expect(blurLevelForAmount(42)).toBe("b42");
    expect(blurLevelForAmount(-20)).toBe("b0");
    expect(blurLevelForAmount(250)).toBe("b100");
    expect(blurAmountOf("b42")).toBe(42);
    expect(blurAmountOf("medium")).toBe(50);
  });

  it("🔴 the far left is exactly Light — no position ever stores more detail than Light", () => {
    expect(blurBand("b0")).toBe("light");
    for (let n = 0; n <= 100; n++) {
      expect(blurClipWidth(`b${n}`)).toBeLessThanOrEqual(BLUR_CLIP_WIDTH_FOR.light);
      expect(blurStillWidth(`b${n}`)).toBeLessThanOrEqual(BLUR_STILL_WIDTH_FOR.light);
    }
    // the bands split at 35 and 70; named levels are their own band
    expect([34, 35, 69, 70].map((n) => blurBand(`b${n}`))).toEqual(["light", "medium", "medium", "strong"]);
    expect(BLUR_LEVELS.map((l) => blurBand(l))).toEqual(["light", "medium", "strong"]);
    // teeth: a position stores what its band stores, not the default's size
    expect(blurClipWidth("b10")).toBe(BLUR_CLIP_WIDTH_FOR.light);
    expect(blurClipWidth("b90")).toBe(BLUR_CLIP_WIDTH_FOR.strong);
    expect(blurPreviewsChange("b10", "b60")).toBe(true);
    expect(blurPreviewsChange("b40", "b95")).toBe(false);
  });

  it("every step's CSS blur exists, with a px fallback, and smooths its clip at least as much as Light smooths its own", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const step = (n: number) => new RegExp(`\\.sub-blur-s${n} \\{\\s*filter: blur\\((\\d+(?:\\.\\d+)?)px\\);\\s*filter: blur\\((\\d+(?:\\.\\d+)?)cqw\\);\\s*\\}`).exec(css);
    const lightCover = (1.25 * BLUR_CLIP_WIDTH_FOR.light) / 100;
    let last = 0;
    for (let n = 0; n <= 10; n++) {
      const m = step(n);
      expect(m, `sub-blur-s${n}`).not.toBeNull();
      const cqw = Number(m![2]);
      expect(cqw).toBeGreaterThanOrEqual(last); // rises left to right, like a volume
      last = cqw;
      // the clip a position at this step stores (its band), covered at least as well as Light covers its 48 px clip
      const amount = n * 10;
      expect((cqw * blurClipWidth(`b${amount}`)) / 100, `s${n}`).toBeGreaterThanOrEqual(lightCover - 1e-9);
    }
    expect(blurClass("b0")).toBe("sub-blur-s0");
    expect(blurClass("b100")).toBe("sub-blur-s10");
    expect(blurClass("b47")).toBe("sub-blur-s5");
    expect(blurClass("light")).toBe(BLUR_CSS_CLASS.light);
  });

  it("0310 widens 0307's check to the slider, and a database before it stores the band (never a failed save)", () => {
    const sql = readFileSync("supabase/migrations/0310_sub_blur_slider.sql", "utf8");
    expect(sql).toMatch(/drop constraint if exists sub_posts_blur_level_check/);
    expect(sql).toContain("blur_level ~ '^b([0-9]|[1-9][0-9]|100)$'");
    const posts = readFileSync("lib/sub/posts.ts", "utf8");
    expect(posts).toMatch(/blur_level_check\|check constraint\|23514/);
    expect(posts).toContain("const band = blurBand(level);");
  });
});
