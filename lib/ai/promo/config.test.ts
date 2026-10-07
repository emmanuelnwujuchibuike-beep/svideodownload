import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_PROMO_TIMING, EMPTY_PROMO, PROMO_FEATURES, normalizePromo, promoStages } from "@/lib/ai/promo/config";
import { SHOWCASE_TARGETS } from "@/lib/ai/showcase/slides";

/** Brief C — the Frenz AI landing promotion (docs/FRENZ_AI_REDESIGN_BRIEFS.md). */

const SUPA = "https://example.supabase.co";
const ours = (name: string) => `${SUPA}/storage/v1/object/public/ai-showcase/promo/${name}`;
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the promotion's stages fall back gracefully (§20)", () => {
  const video = { url: ours("a.mp4"), poster: ours("p.webp"), enabled: true };
  const image = { before: ours("b.webp"), after: ours("c.webp"), enabled: true };
  it("all media → intro, video, image", () => {
    expect(promoStages({ video, image, timing: DEFAULT_PROMO_TIMING })).toEqual(["intro", "video", "image"]);
  });
  it("no video → intro, image; no image → intro, video; nothing → intro only", () => {
    expect(promoStages({ video: null, image, timing: DEFAULT_PROMO_TIMING })).toEqual(["intro", "image"]);
    expect(promoStages({ video, image: null, timing: DEFAULT_PROMO_TIMING })).toEqual(["intro", "video"]);
    expect(promoStages(EMPTY_PROMO)).toEqual(["intro"]);
  });
  it("a switched-off stage is skipped like a missing one", () => {
    expect(promoStages({ video: { ...video, enabled: false }, image, timing: DEFAULT_PROMO_TIMING })).toEqual(["intro", "image"]);
  });
});

describe("only our own media, and only safe timing, reach the landing", () => {
  it("refuses a URL outside the bucket's promo folder, and a non-video clip", () => {
    const p = normalizePromo(
      {
        video: { url: "https://evil.example/x.mp4", poster: null },
        image: { before: ours("b.webp"), after: `${SUPA}/storage/v1/object/public/ai-showcase/slides/x.webp` },
      },
      SUPA,
    );
    expect(p.video).toBeNull();
    expect(p.image).toBeNull(); // "after" is a showcase slide, not a promo upload
    expect(normalizePromo({ video: { url: ours("a.mov") } }, SUPA).video).toBeNull();
  });
  it("clamps timing to its bounds and defaults what is missing", () => {
    const p = normalizePromo({ timing: { delay: -5, intro: 999, video: "x" } }, SUPA);
    expect(p.timing).toEqual({ delay: 0, intro: 10, video: DEFAULT_PROMO_TIMING.video, image: DEFAULT_PROMO_TIMING.image });
  });
  it("garbage is the empty promotion, never a crash", () => {
    expect(normalizePromo(null, SUPA)).toEqual(EMPTY_PROMO);
    expect(normalizePromo("x", SUPA)).toEqual(EMPTY_PROMO);
  });
});

describe("the tile's rotating names come from the existing tool registry (§2)", () => {
  it("every generation tool, not the studio door or history", () => {
    expect(PROMO_FEATURES).toEqual(["Text to Video", "Image to Video", "Lip Sync", "Text to Audio", "Voice Cloning"]);
    for (const name of PROMO_FEATURES) expect(Object.values(SHOWCASE_TARGETS).map((t) => t.label)).toContain(name);
  });
});

describe("the landing pays nothing up front (§8–§9, §19)", () => {
  it("the landing hero shows the Frenz AI tile with the promotion, read with its other cached settings", () => {
    const hero = read("components/landing/hero.tsx");
    expect(hero).toContain("getAiPromo(),");
    expect(hero).toContain("aiPromo={aiPromo}");
    expect(hero).toMatch(/\n\s*showFrenzAi\n/);
  });
  it("the tile's name rotation is CSS — the tile itself ships no client script", () => {
    const tile = read("features/downloads/frenz-ai-cta.tsx");
    expect(tile).not.toContain('"use client"');
    expect(tile).toContain("rotorCss(PROMO_FEATURES.length)");
  });
  it("the media driver is fetched only after load + the delay, and never polls", () => {
    const loader = read("features/downloads/ai-promo-loader.tsx");
    expect(loader).toContain('window.addEventListener("load", start, { once: true })');
    expect(loader).toContain('import("@/features/downloads/ai-promo-driver")');
    const driver = read("features/downloads/ai-promo-driver.tsx");
    expect(driver).not.toMatch(/setInterval|fetch\(|supabase/);
    expect(driver).toContain("IntersectionObserver");
  });
  it("the config is read from cache and refreshed only by an admin save", () => {
    expect(read("lib/ai/promo/server.ts")).toContain("revalidate: false");
    const route = read("app/api/admin/ai/promo/route.ts");
    expect(route).toContain("revalidateTag(PROMO_TAG);");
    expect(route).toContain('revalidatePath("/");');
  });
});

/*
  Owner, 2026-10-06: "it delays and it reloads each time the pages opens or when
  the page make any movement". The driver paused at half-visibility and, on
  pausing, reset to the intro and unmounted the clip.
*/
describe("the promotion never restarts or re-buffers on a scroll", () => {
  const driver = read("features/downloads/ai-promo-driver.tsx");
  it("pauses only when the tile is wholly off screen", () => {
    expect(driver).toContain("{ threshold: 0 }");
    expect(driver).not.toContain("intersectionRatio >= 0.5");
  });
  it("a pause keeps the stage — it never resets to the intro", () => {
    expect(driver).not.toMatch(/if \(!running\) \{\s*setStage\("intro"\)/);
  });
  it("the clip is loaded once and only paused, never unmounted by the cycle", () => {
    expect(driver).toContain('preload="auto"');
    expect(driver).not.toMatch(/running && \(stage === "video"/);
    expect(driver).toContain("v.pause();");
  });
  it("the player arrives right after load; the delay runs while the clip warms", () => {
    expect(read("features/downloads/ai-promo-loader.tsx")).not.toContain("promo.timing.delay * 1000");
    expect(driver).toContain("setTimeout(() => setStarted(true), promo.timing.delay * 1000)");
  });
});
