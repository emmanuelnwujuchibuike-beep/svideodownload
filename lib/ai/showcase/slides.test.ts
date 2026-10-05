import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SHOWCASE,
  SHOWCASE_LIMITS,
  SHOWCASE_TARGETS,
  isShowcaseImageUrl,
  normalizeShowcase,
  slideHref,
  visibleSlides,
} from "@/lib/ai/showcase/slides";

const SUPA = "https://abc.supabase.co";
const IMG = `${SUPA}/storage/v1/object/public/ai-showcase/slides/1-720.webp`;
const IMG_LG = `${SUPA}/storage/v1/object/public/ai-showcase/slides/1-1280.webp`;

describe("the showcase slides", () => {
  it("every link target is a real page behind BOTH doors (truth rule)", () => {
    for (const [key, t] of Object.entries(SHOWCASE_TARGETS)) {
      for (const group of ["app/(marketing)/ai", "app/(app)/studio/ai"]) {
        const file = join(process.cwd(), group, t.path.slice(1), "page.tsx");
        expect(existsSync(file), `${key} → ${file}`).toBe(true);
      }
    }
  });

  it("resolves a target against the door it is shown on", () => {
    expect(slideHref("/ai", "text-to-video")).toBe("/ai/text-to-video");
    expect(slideHref("/studio/ai", "explore")).toBe("/studio/ai/character-replace");
  });

  it("cuts every field to the length the card was drawn for", () => {
    const long = "x".repeat(400);
    const [s] = normalizeShowcase(
      [{ id: "a", chip: long, title: long, highlight: long, description: long, alt: long, target: "lip-sync" }],
      SUPA,
    );
    expect(s?.chip.length).toBe(SHOWCASE_LIMITS.chip);
    expect(s?.title.length).toBe(SHOWCASE_LIMITS.title);
    expect(s?.highlight.length).toBe(SHOWCASE_LIMITS.highlight);
    expect(s?.description.length).toBe(SHOWCASE_LIMITS.description);
    expect(s?.alt.length).toBe(SHOWCASE_LIMITS.alt);
  });

  it("the defaults themselves fit the limits", () => {
    for (const s of DEFAULT_SHOWCASE) {
      expect(s.chip.length).toBeLessThanOrEqual(SHOWCASE_LIMITS.chip);
      expect(s.title.length).toBeLessThanOrEqual(SHOWCASE_LIMITS.title);
      expect(s.highlight.length).toBeLessThanOrEqual(SHOWCASE_LIMITS.highlight);
      expect(s.description.length).toBeLessThanOrEqual(SHOWCASE_LIMITS.description);
    }
  });

  it("accepts images ONLY from our own showcase bucket", () => {
    expect(isShowcaseImageUrl(IMG, SUPA)).toBe(true);
    for (const bad of [
      "https://evil.example/x.webp",
      "//evil.example/x.webp",
      "/brand/x.webp",
      "data:image/webp;base64,AAAA",
      `${SUPA}/storage/v1/object/public/wallpapers/x.webp`,
      `${SUPA}/storage/v1/object/public/ai-showcase/../wallpapers/x.webp`,
      "http://abc.supabase.co/storage/v1/object/public/ai-showcase/x.webp",
    ]) {
      expect(isShowcaseImageUrl(bad, SUPA), bad).toBe(false);
    }
    expect(isShowcaseImageUrl(IMG, undefined)).toBe(false);
  });

  it("drops a foreign image but keeps the slide's text", () => {
    const [s] = normalizeShowcase(
      [{ id: "a", title: "Hi", image: { sm: "https://evil.example/a.webp", lg: IMG_LG, width: 1, height: 1 } }],
      SUPA,
    );
    expect(s?.title).toBe("Hi");
    expect(s?.image).toBeNull();
    const [ok] = normalizeShowcase([{ id: "b", title: "Hi", image: { sm: IMG, lg: IMG_LG, width: 1280, height: 800 } }], SUPA);
    expect(ok?.image).toEqual({ sm: IMG, lg: IMG_LG, width: 1280, height: 800 });
  });

  it("rejects an unknown link target instead of trusting it", () => {
    const [s] = normalizeShowcase([{ id: "a", title: "Hi", target: "javascript:alert(1)" }], SUPA);
    expect(s?.target).toBe("explore");
  });

  it("drops headline-less, duplicate and surplus slides; strips control bytes", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, title: `T${i}` }));
    expect(normalizeShowcase(many, SUPA)).toHaveLength(SHOWCASE_LIMITS.slides);
    expect(normalizeShowcase([{ id: "a" }, { id: "b", title: "x" }, { id: "b", title: "y" }], SUPA)).toHaveLength(1);
    const [s] = normalizeShowcase([{ id: "a", title: "Turn\u0000 words\n\ninto" }], SUPA);
    expect(s?.title).toBe("Turn words into");
    expect(normalizeShowcase("nope", SUPA)).toEqual([]);
  });

  it("never saved → defaults; saved with every slide off → nothing (the admin hid it)", () => {
    expect(visibleSlides(null)).toBe(DEFAULT_SHOWCASE);
    expect(visibleSlides([{ ...DEFAULT_SHOWCASE[0]!, enabled: false }])).toEqual([]);
  });

  it("visitors make no request for the slides — the reader is a tag-busted data cache", () => {
    const server = readFileSync(join(process.cwd(), "lib/ai/showcase/server.ts"), "utf8");
    expect(server).toContain("{ tags: [SHOWCASE_TAG], revalidate: false }");
    // the data cache outlives a deploy: a code change to the starter slides or
    // the limits must be a NEW key, or it stays invisible until an admin saves
    expect(server).toContain('["ai-showcase-slides", JSON.stringify(DEFAULT_SHOWCASE), JSON.stringify(SHOWCASE_LIMITS)]');
    const route = readFileSync(join(process.cwd(), "app/api/admin/ai/showcase/route.ts"), "utf8");
    expect(route).toContain("revalidateTag(SHOWCASE_TAG);");
    expect(route).toContain('revalidatePath("/ai");');
    expect(route).toContain('revalidatePath("/studio/ai");');
    // the carousel itself must not fetch
    const carousel = readFileSync(join(process.cwd(), "features/ai/design/ai-showcase.tsx"), "utf8");
    expect(carousel).not.toContain("fetch(");
  });
});
