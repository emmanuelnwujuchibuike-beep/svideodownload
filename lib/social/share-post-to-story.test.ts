import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { canReshareTo } from "@/lib/social/reshare-rules";

/** Owner, 2026-10-14: "I want users to be able to share feed and reels post to their story". */
const code = (f: string) => readFileSync(path.resolve(process.cwd(), f), "utf8");

describe("a feed post or reel onto your story", () => {
  it("a post reaches a story, and nowhere else through this path", () => {
    expect(canReshareTo("post", "story")).toBe(true);
    expect(canReshareTo("post", "post")).toBe(false);
    expect(canReshareTo("post", "reel")).toBe(false);
    expect(canReshareTo("post", "chat")).toBe(false);
  });

  it("🔴 never wider than the post's own audience: drafts, private, followers-only and blocks fail closed", () => {
    const s = code("lib/social/reshare.ts");
    const fn = s.slice(s.indexOf("async function resolvePostMedia"), s.indexOf("export interface ReshareInput"));
    expect(fn).toContain('post.status !== "published"');
    expect(fn).toContain('post.visibility === "private"');
    expect(fn).toMatch(/post\.visibility === "followers"[\s\S]*from\("follows"\)/);
    expect(fn).toContain('from("blocks")');
  });

  it("the API accepts it, and the author's reshare switch can't be aimed at a post", () => {
    expect(code("app/api/reshare/route.ts")).toContain('source: z.enum(["message", "story", "post"])');
    expect(code("lib/social/reshare.ts")).toContain('if (!hasSupabase || source === "post") return { ok: false };');
  });

  it("both sheets offer it", () => {
    expect(code("features/social/share-sheet.tsx")).toMatch(/label="Add to story"[\s\S]*?shareToStory\(postId, mediaIndex\)/);
    expect(code("features/social/repost/repost-sheet.tsx")).toMatch(/case "story":[\s\S]*?shareToStory\(postId\)/);
  });
});
