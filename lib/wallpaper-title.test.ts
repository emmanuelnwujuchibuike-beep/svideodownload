import { describe, expect, it } from "vitest";

import { isMeaningfulFilename, wallpaperTitle } from "@/lib/wallpaper-title";

const base = { batchName: "", batchSize: 1, index: 1, filename: "IMG_8662.JPG", category: "Abstract" };

describe("isMeaningfulFilename", () => {
  it("rejects the camera and screenshot names that caused this", () => {
    for (const f of [
      "IMG_8662.JPG",
      "IMG4647.jpg",
      "IMG 8719.png",
      "DSC00021.jpg",
      "PXL_20240113_101500.jpg",
      "Screenshot 2026-08-03 at 10.17.png",
      "WhatsApp Image 2026-08-03.jpeg",
      "photo_1234.jpg",
      "image.png",
      "untitled.webp",
      "20240113101500.jpg",
      "a3f9c8d21b4e7f60.jpg",
      "download (3).jpg",
    ]) {
      expect(isMeaningfulFilename(f), `${f} should not be used as a title`).toBe(false);
    }
  });

  it("accepts names a person actually chose", () => {
    for (const f of ["neon-canyon.jpg", "Aurora Ridge.png", "midnight_forest.webp", "deep space blue.jpg"]) {
      expect(isMeaningfulFilename(f), `${f} should be usable as a title`).toBe(true);
    }
  });
});

describe("wallpaperTitle", () => {
  it("uses the operator's name above everything else", () => {
    expect(wallpaperTitle({ ...base, batchName: "Neon Canyon" })).toBe("Neon Canyon");
    // Even when the filename would have been acceptable.
    expect(wallpaperTitle({ ...base, batchName: "Neon Canyon", filename: "aurora-ridge.jpg" })).toBe("Neon Canyon");
  });

  it("numbers a multi-file batch so names stay distinct", () => {
    expect(wallpaperTitle({ ...base, batchName: "Neon", batchSize: 3, index: 2 })).toBe("Neon 2");
  });

  it("never captions a wallpaper with a camera filename", () => {
    expect(wallpaperTitle(base)).toBe("Abstract 01");
    expect(wallpaperTitle({ ...base, filename: "IMG4647.jpg", category: "Nature", index: 7 })).toBe("Nature 07");
  });

  it("keeps a filename that reads like a real name, title-cased", () => {
    expect(wallpaperTitle({ ...base, filename: "neon-canyon.jpg" })).toBe("Neon Canyon");
    expect(wallpaperTitle({ ...base, filename: "midnight_forest.webp" })).toBe("Midnight Forest");
  });

  it("falls back to a sane name when the category is blank", () => {
    expect(wallpaperTitle({ ...base, category: "" })).toBe("Wallpaper 01");
  });

  it("never exceeds the column limit", () => {
    expect(wallpaperTitle({ ...base, batchName: "x".repeat(400) })).toHaveLength(120);
  });
});
