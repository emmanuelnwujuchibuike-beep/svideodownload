import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { postHref, postViewHref, reelsViewHref } from "./post-url";

/**
 * Owner, 2026-10-17 (screenshot of a video's post page): "remove this page, make a route to this
 * page lead to the reels page instantly, all route of view should open in reels viewer". A VIDEO
 * post opens in the Reels viewer; a photo/text post keeps its page (the Reels deck is video-only).
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const ID = "11111111-2222-4333-8444-555555555555";

describe("where tapping a post goes", () => {
  it("a video opens in the Reels viewer, starting on it", () => {
    expect(reelsViewHref(ID)).toBe(`/reels?start=${ID}`);
    expect(postViewHref({ id: ID, mediaKind: "video" })).toBe(`/reels?start=${ID}`);
    expect(postViewHref({ id: ID, media_kind: "video", slug: "x-1111", category: "music", createdAt: "2026-10-14T00:00:00Z" })).toBe(`/reels?start=${ID}`);
  });
  it("a photo or text post keeps its own page (canonical URL unchanged)", () => {
    const photo = { id: ID, mediaKind: "image", slug: "x-1111", category: "music", createdAt: "2026-10-14T00:00:00Z" };
    expect(postViewHref(photo)).toBe(postHref(photo));
    expect(postViewHref({ id: ID, mediaKind: "text" })).toBe(`/p/${ID}`);
    expect(postViewHref({ id: ID })).toBe(`/p/${ID}`);
  });
});

describe("both post pages send a video to Reels before rendering anything", () => {
  for (const f of ["app/p/[id]/page.tsx", "app/(marketing)/[downloader]/[year]/[month]/[slug]/page.tsx"]) {
    it(f, () => {
      const s = src(f);
      const r = s.indexOf('if (post.media_kind === "video") redirect(reelsViewHref(post.id));');
      expect(r).toBeGreaterThan(-1);
      // before the canonical-slug hop (one redirect, not two) and before the page is rendered
      expect(r).toBeLessThan(s.indexOf("<PostPageView"));
      if (f.startsWith("app/p/")) expect(r).toBeLessThan(s.indexOf("if (post.slug && post.category)"));
    });
  }
});

describe("a shared video link still previews as the post, and nothing lists dead pages", () => {
  it("the Reels page builds the post's share preview from ?start, still noindex, without the post page's client code", () => {
    const reels = src("app/(app)/reels/page.tsx");
    expect(reels).toContain("export async function generateMetadata(");
    expect(reels).toContain("const meta = postPageMetadata(post, postHref(post));");
    expect(reels).toContain("return { ...meta, alternates: undefined, robots: REELS_METADATA.robots };");
    expect(reels).toContain('import { postPageMetadata } from "@/lib/social/post-metadata";');
    expect(reels).not.toContain("@/features/social/post-page-view");
  });
  it("the post sitemaps leave video posts out (their pages redirect to a noindex deck)", () => {
    for (const f of ["app/posts-sitemap.xml/route.ts", "app/news-sitemap.xml/route.ts"]) {
      const s = src(f);
      expect((s.match(/\.neq\("media_kind", "video"\)/g) ?? []).length, f).toBe(2);
    }
  });
  it("in-app taps go straight to Reels (no redirect hop): profile grid, explore, feed, discover", () => {
    for (const f of ["components/social/post-grid.tsx", "features/explore/explore-card.tsx", "features/feed/feed-post-card.tsx", "lib/social/discover.ts"]) expect(src(f), f).toContain("postViewHref(");
  });
});
