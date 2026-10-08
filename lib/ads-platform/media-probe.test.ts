import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { imageSize, probeMedia, probeMp4, sniff, type RangeReader } from "./media-probe";

/**
 * The server's verdict on a creative comes from its BYTES. These fixtures are
 * real files made with ffmpeg (2026-10-07), and the expected numbers are what
 * ffprobe reported for them — not what the parser was written to say:
 *
 *   moov-end.mp4      160×90, 2.5 s, moov AFTER mdat (how a phone writes it)
 *   portrait-16s.mp4  90×160, 16 s, faststart
 *   rotated.mp4       stored 160×90 with a 90° display matrix → shown 90×160
 *   webm-3s.webm      96×54, 3 s, VP9
 *   card.*            320×200 png / jpg / webp (lossy + lossless) / avif
 */
const fx = (name: string) => new Uint8Array(readFileSync(join(__dirname, "__fixtures__", name)));

/** A reader over a buffer that records every range it was asked for. */
function reader(b: Uint8Array) {
  const reads: [number, number][] = [];
  const read: RangeReader = async (offset, length) => {
    reads.push([offset, length]);
    return b.subarray(offset, Math.min(b.length, offset + length));
  };
  return { read, reads };
}

describe("sniff — the real type, whatever the browser declared", () => {
  it.each([
    ["card.png", "image/png"],
    ["card.jpg", "image/jpeg"],
    ["card.webp", "image/webp"],
    ["card-lossless.webp", "image/webp"],
    ["card.avif", "image/avif"],
    ["moov-end.mp4", "video/mp4"],
    ["webm-3s.webm", "video/webm"],
  ])("%s → %s", (file, mime) => {
    expect(sniff(fx(file))?.mime).toBe(mime);
  });
  it("an HTML page, a script or an SVG renamed .jpg is NOT an image", () => {
    const enc = (s: string) => new TextEncoder().encode(s.padEnd(64, " "));
    expect(sniff(enc("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(sniff(enc("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>"))).toBeNull();
    expect(sniff(enc("MZ\x90\x00 windows executable"))).toBeNull();
    expect(sniff(new Uint8Array(4))).toBeNull();
  });
});

describe("image dimensions", () => {
  it.each(["card.png", "card.jpg", "card.webp", "card-lossless.webp", "card.avif"])("%s is 320×200", (file) => {
    const b = fx(file);
    expect(imageSize(b, sniff(b)!.mime)).toEqual({ width: 320, height: 200 });
  });

  it("a JPEG whose EXIF says 'rotate 90°' is reported as the browser shows it (portrait)", () => {
    const jpg = fx("card.jpg");
    // APP1 Exif, big-endian TIFF, IFD0 with one entry: Orientation (0x0112) = 6
    const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0];
    const payload = [...new TextEncoder().encode("Exif\0\0"), ...tiff];
    const app1 = [0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
    const rotated = new Uint8Array([...jpg.subarray(0, 2), ...app1, ...jpg.subarray(2)]);
    expect(imageSize(rotated, "image/jpeg")).toEqual({ width: 200, height: 320 });
  });

  it("a truncated header is 'unknown', never a guess", () => {
    expect(imageSize(fx("card.png").subarray(0, 20), "image/png")).toBeNull();
    expect(imageSize(fx("card.jpg").subarray(0, 40), "image/jpeg")).toBeNull();
  });
});

describe("video duration and size — from the moov box, wherever it is", () => {
  it("moov at the END: 2.5 s, 160×90, and the whole file is never read", async () => {
    const b = fx("moov-end.mp4");
    const r = reader(b);
    const facts = await probeMp4(r.read, b.length);
    expect(facts?.durationSeconds).toBeCloseTo(2.5, 2);
    expect([facts?.width, facts?.height]).toEqual([160, 90]);
    // headers of each top-level box, then the moov box once — mdat is skipped over
    expect(r.reads.every(([, len]) => len < b.length)).toBe(true);
  });

  it("portrait faststart: 16 s, 90×160", async () => {
    const b = fx("portrait-16s.mp4");
    const facts = await probeMp4(reader(b).read, b.length);
    expect(facts?.durationSeconds).toBeCloseTo(16, 2);
    expect([facts?.width, facts?.height]).toEqual([90, 160]);
  });

  it("a 90° display matrix (how a phone records portrait) swaps to what viewers see", async () => {
    const b = fx("rotated.mp4");
    const facts = await probeMp4(reader(b).read, b.length);
    expect([facts?.width, facts?.height]).toEqual([90, 160]);
  });

  it("WebM: 3 s, 96×54", async () => {
    const b = fx("webm-3s.webm");
    const facts = await probeMedia(reader(b).read, b.length);
    expect(facts).toMatchObject({ mime: "video/webm", mediaType: "video", width: 96, height: 54 });
    expect(facts!.durationSeconds).toBeCloseTo(3, 1);
  });

  it("a truncated or junk MP4 is 'unknown' (null), which the validator refuses", async () => {
    const b = fx("moov-end.mp4");
    const cut = b.subarray(0, Math.floor(b.length / 2));
    const facts = await probeMedia(reader(cut).read, cut.length);
    expect(facts?.durationSeconds ?? null).toBeNull();
    const junk = new Uint8Array(64).fill(7);
    expect(await probeMedia(reader(junk).read, junk.length)).toBeNull();
  });
});

describe("probeMedia — the one entry point", () => {
  it("image facts: type, size, no duration", async () => {
    const b = fx("card.webp");
    expect(await probeMedia(reader(b).read, b.length)).toEqual({ mime: "image/webp", mediaType: "image", width: 320, height: 200, durationSeconds: null });
  });
  it("video facts", async () => {
    const b = fx("portrait-16s.mp4");
    const f = await probeMedia(reader(b).read, b.length);
    expect(f).toMatchObject({ mime: "video/mp4", mediaType: "video", width: 90, height: 160 });
    expect(f!.durationSeconds).toBeCloseTo(16, 2);
  });
});
