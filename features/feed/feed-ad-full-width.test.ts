import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// owner, 2026-10-24: "make the feed ads to be full width like posts"
describe("feed ads are full width like posts", () => {
  it("the feed slot asks for the post frame", () => {
    expect(readFileSync("features/feed/feed-ad-slot.tsx", "utf8")).toContain('<AdSurface zone="feed_inline" fullBleed feedFrame onResolved={setFilled} />');
  });
  it("the paid card drops its 320 px cap and uses the post media frame (feed-frame.ts), filling it like a post", () => {
    const card = readFileSync("features/ads-platform/serve/self-ad-card.tsx", "utf8");
    expect(card).toContain('feedFrame ? "w-full" : "mx-auto w-full max-w-[320px]"');
    const banner = readFileSync("features/ads-platform/serve/self-ad-banner.tsx", "utf8");
    expect(banner).toContain("feedFrameStyle(current.w && current.h ? current.w / current.h : null)");
    expect(banner).toContain('fit={variant === "strip" || feedFrame ? "cover" : "contain"}');
  });
});
