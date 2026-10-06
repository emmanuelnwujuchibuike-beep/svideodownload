import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SHOWCASE,
  SHOWCASE_LIMITS,
  SHOWCASE_PAGES,
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

  it("every page that reads the slides is dropped on save, and every listed page reads them", () => {
    const appDir = join(process.cwd(), "app");
    const pages = (readdirSync(appDir, { recursive: true }) as string[])
      .filter((f) => /(^|[\\/])page\.tsx$/.test(f))
      .map((f) => ({
        url: "/" + f.replace(/\\/g, "/").replace(/(^|\/)page\.tsx$/, "").split("/").filter((s) => s && !/^\(.*\)$/.test(s)).join("/"),
        src: readFileSync(join(appDir, f), "utf8"),
      }));
    const readers = pages.filter((p) => p.src.includes("getShowcaseSlides()")).map((p) => p.url).sort();
    expect(readers.length).toBeGreaterThan(0);
    expect(readers).toEqual([...SHOWCASE_PAGES].sort());
  });

  it("on a phone the showcase is ONLY on the welcome and Explore pages (owner, 2026-10-05)", () => {
    const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    // the two pages that show it at every width
    for (const f of ["features/ai/frenz-ai-welcome.tsx", "features/ai/frenz-ai-explore.tsx"]) {
      expect(read(f), f).toContain("<AiShowcase");
      expect(read(f), f).not.toContain("desktopOnly");
    }
    // every tool page that renders it does so for large screens only
    for (const f of [
      "features/ai/video/text-to-video-workspace.tsx",
      "features/ai/video/image-to-video-workspace.tsx",
      "features/ai/text-to-audio/text-to-audio-workspace.tsx",
      "features/ai/voice-clone/voice-cloning-workspace.tsx",
      "features/ai/lip-sync/lip-sync-workspace.tsx",
      "features/ai/text-to-audio/audio-library.tsx",
      "features/ai/voice-clone/voice-library.tsx",
      "features/ai/frenz-ai-history-page.tsx",
      "features/ai/frenz-ai-usage-page.tsx",
    ]) {
      const showcases = read(f).match(/<AiShowcase\b[^>]*>/g) ?? [];
      expect(showcases.length, f).toBeGreaterThan(0);
      for (const tag of showcases) expect(tag, f).toContain("desktopOnly");
    }
    // and "large screens only" really hides it below lg
    expect(read("features/ai/design/ai-showcase.tsx")).toContain('desktopOnly && "hidden lg:block"');
  });

  it("a slide's video is accepted only from our bucket, and only MP4/WebM", () => {
    const ok = `${SUPA}/storage/v1/object/public/ai-showcase/slides/1.mp4`;
    const [a] = normalizeShowcase([{ id: "a", title: "Hi", video: { url: ok, bytes: 900_000 } }], SUPA);
    expect(a?.video).toEqual({ url: ok, bytes: 900_000 });
    for (const bad of [
      "https://evil.example/x.mp4",
      `${SUPA}/storage/v1/object/public/ai-showcase/slides/1.mov`,
      `${SUPA}/storage/v1/object/public/ai-showcase/slides/1.webp`,
      `${SUPA}/storage/v1/object/public/wallpapers/x.mp4`,
    ]) {
      const [b] = normalizeShowcase([{ id: "a", title: "Hi", video: { url: bad, bytes: 1 } }], SUPA);
      expect(b?.video, bad).toBeNull();
    }
  });

  it("a visitor downloads a clip only while its slide plays, and the route never carries video bytes", () => {
    const card = readFileSync(join(process.cwd(), "features/ai/design/ai-showcase.tsx"), "utf8");
    // the <video> element exists only when the carousel says this slide plays
    expect(card).toContain("{slide.video && playing ? (");
    expect(card).toContain("playing={motionOk && i === active}");
    expect(card).toContain("const motionOk = onScreen && tabVisible && !paused && !reduced && !saveData;");
    const route = readFileSync(join(process.cwd(), "app/api/admin/ai/showcase/route.ts"), "utf8");
    expect(route).toContain(".createSignedUploadUrl(key)");
    expect(route).toContain('if (body.kind !== "video") return bad("Unknown upload.");');
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
    expect(route).toContain("for (const page of SHOWCASE_PAGES) revalidatePath(page);");
    // the carousel itself must not fetch
    const carousel = readFileSync(join(process.cwd(), "features/ai/design/ai-showcase.tsx"), "utf8");
    expect(carousel).not.toContain("fetch(");
    // …and must not make the ROUTER fetch either: autoplay scrolls each slide's
    // link into view, and a viewport prefetch is a server render per slide
    expect(carousel).toContain('<Link href={href} prefetch={false} className={frame} data-ai-members="">');
  });
});
