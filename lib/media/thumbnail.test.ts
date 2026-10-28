import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const sharp = (await import("sharp")).default;
const { makeThumbnail, THUMB_QUALITY, THUMB_WIDTH } = await import("./thumbnail");

/**
 * The wallpaper grid copy (owner, 2026-10-24: Pro wallpapers "should always be in high quality"). The old 640 px LONG
 * edge made a tall 9:16 wallpaper 360×640 — half what a phone tile needs. Width-bounded now, at a higher quality.
 */
const tall = async (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 90, b: 200 } } }).jpeg().toBuffer();

describe("wallpaper thumbnail", () => {
  it("a tall 1776×3160 upload becomes 720 px WIDE with its full height ratio (not 360×640)", async () => {
    const t = await makeThumbnail(new Uint8Array(await tall(1776, 3160)));
    const meta = await sharp(t!.buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(THUMB_WIDTH);
    expect(meta.height).toBe(Math.round((3160 * THUMB_WIDTH) / 1776));
  });
  it("never enlarges a small original (a 600 px upload stays 600)", async () => {
    const t = await makeThumbnail(new Uint8Array(await tall(600, 1066)));
    expect((await sharp(t!.buffer).metadata()).width).toBe(600);
  });
  it("the grid quality is high, and the width covers a phone tile at 3x", () => {
    expect(THUMB_QUALITY).toBeGreaterThanOrEqual(80);
    expect(THUMB_WIDTH).toBeGreaterThanOrEqual(585);
  });
  // owner, 2026-10-28: "the wallpaper itself shouldn't load unless clicked" — the header is a 1170 px render of the
  // original (still full phone width at 3x), never the small thumbnail and never the multi-megabyte original
  it("the featured header uses a full-width render, never the thumbnail or the raw original", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("features/wallpapers/wallpaper-explore.tsx", "utf8");
    expect(src).toContain("<img src={sizedWallpaperUrl(featured.url, WALLPAPER_HEADER_WIDTH)}");
    expect(src).not.toContain("<img src={featured.thumbUrl}");
    expect(src).not.toContain("<img src={featured.url}");
  });
  it("a sized wallpaper is a contain render of a Supabase object, and anything else is left alone", async () => {
    const { sizedWallpaperUrl } = await import("@/lib/wallpapers");
    expect(sizedWallpaperUrl("https://x.supabase.co/storage/v1/object/public/wallpapers/a.jpg", 420)).toBe("https://x.supabase.co/storage/v1/render/image/public/wallpapers/a.jpg?width=420&resize=contain&quality=72");
    expect(sizedWallpaperUrl("/api/wallpaper?id=1&size=thumb", 420)).toBe("/api/wallpaper?id=1&size=thumb");
  });
});
