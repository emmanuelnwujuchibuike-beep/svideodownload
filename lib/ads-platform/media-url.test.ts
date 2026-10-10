import { describe, expect, it } from "vitest";

import { sizedAdImageUrl, slotImageEdge } from "./media-url";

const ORIGINAL = "https://x.supabase.co/storage/v1/object/public/ad-creatives/a/b/c.png";

describe("ad images are served resized for the slot (owner, 2026-10-10: landing LCP)", () => {
  it("a Supabase public image goes through the renderer at the slot's retina edge", () => {
    expect(sizedAdImageUrl(ORIGINAL, slotImageEdge(320, 200))).toBe("https://x.supabase.co/storage/v1/render/image/public/ad-creatives/a/b/c.png?width=640&resize=contain&quality=75");
  });

  it("teeth: the renderer is always told to CONTAIN — its default (cover) crops the sides off a wide creative", () => {
    const url = new URL(sizedAdImageUrl(ORIGINAL, 640)!);
    expect(url.searchParams.get("resize")).toBe("contain");
    expect(url.searchParams.has("height")).toBe(false);
  });

  it("the edge is twice the slot's, between 640 and 1600 px", () => {
    expect(slotImageEdge(320, 200)).toBe(640);
    expect(slotImageEdge(1280, 800)).toBe(1600);
    expect(slotImageEdge(null, null)).toBe(640);
  });

  it("teeth: anything that is not a plain Supabase public object is left exactly as is", () => {
    expect(sizedAdImageUrl("https://cdn.example.com/a.png", 640)).toBe("https://cdn.example.com/a.png");
    expect(sizedAdImageUrl(`${ORIGINAL}?v=2`, 640)).toBe(`${ORIGINAL}?v=2`);
    expect(sizedAdImageUrl(null, 640)).toBeNull();
  });
});
