import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { canBecomeOriginalSound, type OriginalSoundSource } from "@/lib/social/original-sound";
import { LIBRARY_CHIPS, LIBRARY_GENRE_TILES, chipById, isLibraryTab, isPersonalTab, reelsLabel } from "@/lib/social/sound-library-shared";
import { buildSoundMixArgs, SOUND_MIX_MAX_SECONDS, soundMixKey } from "@/lib/social/sound-mix-plan";
import { SOUND_GENRES, SOUND_MOODS } from "@/lib/social/sounds-shared";

/**
 * 0308 — reels' own audio as sounds, and "Use this sound" replacing a reel's audio (owner, 2026-10-30). These read the
 * exact ffmpeg command and the rules that decide what becomes a sound; each has a case that fails on the wrong shape.
 */
describe("the sound mix (a reel made with 'Use this sound')", () => {
  const args = buildSoundMixArgs("https://media.example/reel.mp4", "https://media.example/origin.mp4", "/tmp/out.mp4");
  const at = (flag: string, from = 0) => args.indexOf(flag, from);

  it("keeps the reel's picture untouched and takes ONLY the sound's audio (the reel's own audio is dropped)", () => {
    expect(args[at("-map") + 1]).toBe("0:v:0");
    expect(args[at("-map", at("-map") + 1) + 1]).toBe("1:a:0");
    expect(args.filter((a) => a === "-map")).toHaveLength(2);
    expect(args[at("-c:v") + 1]).toBe("copy");
    expect(args[at("-c:a") + 1]).toBe("aac");
  });

  it("loops the SOUND, not the reel: -stream_loop sits right before the sound's -i (teeth: before the reel's would loop the picture)", () => {
    const loop = at("-stream_loop");
    const firstInput = at("-i");
    const secondInput = at("-i", firstInput + 1);
    expect(args[firstInput + 1]).toBe("https://media.example/reel.mp4");
    expect(args[secondInput + 1]).toBe("https://media.example/origin.mp4");
    expect(loop).toBeGreaterThan(firstInput);
    expect(loop).toBeLessThan(secondInput);
    expect(args[loop + 1]).toBe("-1");
  });

  it("ends with the reel (-shortest) and can never write an endless file", () => {
    expect(args).toContain("-shortest");
    expect(args[at("-t") + 1]).toBe(String(SOUND_MIX_MAX_SECONDS));
    expect(args[at("-movflags") + 1]).toBe("+faststart");
    expect(args.at(-1)).toBe("/tmp/out.mp4");
  });

  it("stores the mixed reel under a new key every time (no cache serves the old audio)", () => {
    expect(soundMixKey("p1", "a")).not.toBe(soundMixKey("p1", "b"));
    expect(soundMixKey("p1", "a")).toMatch(/^reels\/sound-mix\/p1-a\.mp4$/);
  });
});

describe("what becomes an original sound", () => {
  const reel: OriginalSoundSource = { media_kind: "video", platform: "frenz", status: "published", visibility: "public", media_url: "https://media.example/r.mp4", sound_id: null };

  it("a member's own public video reel does", () => {
    expect(canBecomeOriginalSound(reel)).toBe(true);
  });

  it("teeth: a video saved from another platform never does (that audio isn't theirs to be credited with)", () => {
    expect(canBecomeOriginalSound({ ...reel, platform: "tiktok" })).toBe(false);
  });

  it("nor a photo, a private or unpublished post, one without a file, or one that already carries a sound", () => {
    expect(canBecomeOriginalSound({ ...reel, media_kind: "image" })).toBe(false);
    expect(canBecomeOriginalSound({ ...reel, visibility: "private" })).toBe(false);
    expect(canBecomeOriginalSound({ ...reel, status: "removed" })).toBe(false);
    expect(canBecomeOriginalSound({ ...reel, media_url: null })).toBe(false);
    expect(canBecomeOriginalSound({ ...reel, sound_id: "s1" })).toBe(false);
  });
});

describe("the Sounds library's vocabulary (design/frenz-sounds.html)", () => {
  it("every chip is a real creator-set tag — never a label no sound can carry (teeth)", () => {
    for (const c of LIBRARY_CHIPS) {
      if (c.mood) expect(SOUND_MOODS as readonly string[], c.label).toContain(c.mood);
      else expect(SOUND_GENRES as readonly string[], c.label).toContain(c.genre);
      expect(!!c.mood !== !!c.genre, `${c.label} is exactly one of mood or genre`).toBe(true);
    }
    expect(chipById("not-a-tag")).toBeNull();
  });

  it("every genre tile opens a chip that exists", () => {
    for (const t of LIBRARY_GENRE_TILES) expect(chipById(t.chip), t.label).not.toBeNull();
  });

  it("For you and Saved are personal (never CDN-cached); Trending and New are not", () => {
    expect(isPersonalTab("following")).toBe(true);
    expect(isPersonalTab("saved")).toBe(true);
    expect(isPersonalTab("trending")).toBe(false);
    expect(isLibraryTab("trending")).toBe(true);
    expect(isLibraryTab("everything")).toBe(false);
    const route = readFileSync("app/api/sounds/library/route.ts", "utf8");
    expect(route).toMatch(/personal \? "private, no-store"/);
  });

  it("the sound ring opens at once: a prefetching Link to the sound page, warmed only for the ACTIVE reel (owner, 2026-10-30)", () => {
    const src = readFileSync("features/feed/sound-ring-link.tsx", "utf8");
    // the sound page is prefetched once its sound is known
    expect(src).toMatch(/<Link href=\{href\} prefetch/);
    // teeth: the route that MAKES a sound is never a prefetching Link (a prefetch would make one per reel scrolled past)
    const fallback = src.slice(src.indexOf("/api/sounds/from-post/${postId}`} aria-label") - 40);
    expect(fallback).toMatch(/^[\s\S]*<a href=/);
    expect(src).not.toMatch(/<Link href=\{`\/api\/sounds\/from-post/);
    // warmed only while the reel is the active one, after a moment
    expect(src).toContain("if (soundId || warmed || !active) return;");
    expect(readFileSync("features/feed/reel-viewer.tsx", "utf8")).toContain("<SoundRingLink postId={item.id} soundId={item.sound?.id ?? null} active={isActive}");
  });
});

describe("the sound pages (owner, 2026-10-30: \"remove the footer from the sound page\" · \"I still see the old sound page\")", () => {
  const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("neither the sound page nor the Sounds library renders the site footer (teeth: the old page did)", () => {
    for (const p of ["app/sound/[id]/page.tsx", "app/sounds/page.tsx"]) {
      expect(code(p), p).not.toMatch(/<SiteFooter\b/);
      expect(code(p), p).not.toMatch(/import \{ SiteFooter \}/);
    }
  });

  it("the sound page is the design's dark card: its actions inside it, the counts said in proper English", () => {
    const hero = code("features/social/sound-hero.tsx");
    expect(hero).toContain("bg-zinc-950");
    expect(hero).toContain("Use this sound");
    expect(hero).toContain('fetch("/api/sounds/saves", { method: "POST"');
    expect(hero).toContain("{reelsLabel(usageCount)}");
    expect(reelsLabel(1)).toBe("1 reel");
    expect(reelsLabel(2)).toBe("2 reels");
  });
});
