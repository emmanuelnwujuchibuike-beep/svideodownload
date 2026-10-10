import { describe, expect, it } from "vitest";

import { avatarRenderPx, avatarSrc } from "./avatar-url";

const AVATAR = "https://x.supabase.co/storage/v1/object/public/media/00d46d9a/avatar-1790745090148.jpg?v=1790745090822";

describe("avatars come from Supabase's image CDN at the size they are shown (owner, 2026-10-10)", () => {
  it("a stored avatar becomes a small square render that keeps its version", () => {
    const u = new URL(avatarSrc(AVATAR, 52));
    expect(u.pathname).toBe("/storage/v1/render/image/public/media/00d46d9a/avatar-1790745090148.jpg");
    expect(u.searchParams.get("v")).toBe("1790745090822");
    expect(u.searchParams.get("width")).toBe("128");
    expect(u.searchParams.get("height")).toBe("128");
    expect(u.searchParams.get("resize")).toBe("cover");
  });

  it("sizes share buckets, so nearby display sizes are one cached file", () => {
    expect(avatarRenderPx(36)).toBe(128);
    expect(avatarRenderPx(52)).toBe(128);
    expect(avatarRenderPx(64)).toBe(128);
    expect(avatarRenderPx(80)).toBe(192);
    expect(avatarRenderPx(160)).toBe(384);
    expect(avatarRenderPx(400)).toBe(384);
    expect(avatarSrc(AVATAR, 44)).toBe(avatarSrc(AVATAR, 52));
  });

  it("teeth: anything that is not a plain public object is left exactly as is", () => {
    for (const url of [
      "https://lh3.googleusercontent.com/a/abc=s96-c",
      "blob:https://frenzsave.com/1234",
      "https://x.supabase.co/storage/v1/object/public/media/u/avatar-1.gif?v=1",
      "https://x.supabase.co/storage/v1/render/image/public/media/u/avatar-1.jpg?width=128",
      "/brand/frenz-logo.png",
    ]) expect(avatarSrc(url, 52)).toBe(url);
    expect(avatarSrc(null)).toBe("");
  });
});
