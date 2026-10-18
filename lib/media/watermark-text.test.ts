import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MARK_SIZE } from "./watermark-mark-geometry";

/**
 * Owner, 2026-10-17: "In all watermarks, no Frenz and Frenzsave, only domain and username" —
 * every watermark reads exactly the creator's profile address, frenzsave.com/<handle>.
 * (The renderer imports next/og, so its pure helpers are read from source; the words are the
 * same expression the download mark and the private-post badge both use.)
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const MARK = src("lib/media/watermark-mark.tsx");

describe("the download watermark (feed, reels, posts — photos and videos)", () => {
  it("draws ONLY the address: no logo, no Frenzsave wordmark, no @handle", () => {
    expect(MARK).not.toMatch(/<img\b/);
    expect(MARK).not.toContain("OG_ICON_BASE64");
    expect(MARK).not.toMatch(/>\s*Frenzsave\s*</);
    expect(MARK).not.toContain("@{handle}");
    expect(MARK).toContain("return h && !isReservedHandle(h) ? `frenzsave.com${profilePath(h)}` : \"frenzsave.com\";");
  });

  it("the text is the /:handle address; a handle-less creator (the 'frenzsave' fallback) is just the domain", async () => {
    // the same rule, executed: profilePath + the reserved list (the fallback name is reserved)
    const { profilePath, isReservedHandle } = await import("@/lib/social/profile-url");
    const text = (h: string) => (h && !isReservedHandle(h) ? `frenzsave.com${profilePath(h)}` : "frenzsave.com");
    expect(text("chris")).toBe("frenzsave.com/chris");
    expect(text("frenzsave")).toBe("frenzsave.com");
    expect(text("")).toBe("frenzsave.com");
  });

  it("the longest address (a 20-character handle) fits the canvas on one line", () => {
    const fit = (t: string) => Math.max(36, Math.min(76, Math.floor((MARK_SIZE.width - 80) / (t.length * 0.56))));
    expect(MARK).toContain("Math.max(36, Math.min(76, Math.floor((MARK_SIZE.width - 80) / (text.length * 0.56))))");
    const longest = `frenzsave.com/${"x".repeat(20)}`;
    expect(fit(longest) * longest.length * 0.56).toBeLessThanOrEqual(MARK_SIZE.width - 80);
    expect(fit("frenzsave.com/abc")).toBe(76);
  });

  it("the browser asks for the NEW mark (the old one is cached immutable for a year)", () => {
    expect(src("lib/media/watermark-image.ts")).toContain("/api/watermark/mark?h=${encodeURIComponent(handle)}&v=2");
  });

  it("feed and reels downloads go through the same watermarked download, marked with the CREATOR's handle", () => {
    for (const f of ["features/feed/feed-post-card.tsx", "features/feed/reel-viewer.tsx"]) expect(src(f), f).toContain("downloadPost(");
    expect(src("lib/media/download-post.ts")).toContain("/api/posts/");
    const route = src("app/api/posts/[id]/download/route.ts");
    expect(route).toContain('.select("handle").eq("id", post.publisher_id)');
  });
});
