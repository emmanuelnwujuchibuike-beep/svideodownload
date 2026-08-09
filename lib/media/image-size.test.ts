import { describe, expect, it } from "vitest";

import { imageSize } from "./image-size";

/*
 * Real headers, built byte by byte. Every one is the exact layout the encoders
 * emit — the point of these tests is that the arithmetic matches the SPEC, so
 * feeding them bytes produced by the same assumptions the parser makes would
 * prove nothing.
 */

function bytes(...parts: (number[] | Uint8Array)[]): Uint8Array {
  const flat: number[] = [];
  for (const p of parts) flat.push(...Array.from(p));
  return new Uint8Array(flat);
}

const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16be = (n: number) => [(n >>> 8) & 255, n & 255];

function pngHeader(w: number, h: number): Uint8Array {
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    u32be(13),
    [0x49, 0x48, 0x44, 0x52], // "IHDR"
    u32be(w),
    u32be(h),
    [8, 6, 0, 0, 0],
  );
}

/** SOI, an APP0 segment to skip past, then SOF0. */
function jpegHeader(w: number, h: number): Uint8Array {
  return bytes(
    [0xff, 0xd8],
    [0xff, 0xe0],
    u16be(16),
    [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xc0],
    u16be(17),
    [8],
    u16be(h),
    u16be(w),
    [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
  );
}

function riff(chunkId: string, body: number[]): Uint8Array {
  return bytes(
    [0x52, 0x49, 0x46, 0x46], // "RIFF"
    [0, 0, 0, 0],
    [0x57, 0x45, 0x42, 0x50], // "WEBP"
    Array.from(chunkId, (c) => c.charCodeAt(0)),
    [0, 0, 0, 0],
    body,
  );
}

describe("imageSize — PNG", () => {
  it("reads IHDR", () => {
    expect(imageSize(pngHeader(2160, 3840))).toEqual({ width: 2160, height: 3840 });
  });

  it("handles a genuinely huge panorama, and refuses an impossible one", () => {
    // A naive (b<<24 | …) without `>>>0` sign-extends past 2^31 and yields a
    // negative width; the bounds check is what turns any such mis-read into a
    // null rather than a nonsense row in the database.
    expect(imageSize(pngHeader(70_000, 10))).toEqual({ width: 70_000, height: 10 });
    expect(imageSize(pngHeader(0x8000_0010, 10))).toBeNull();
    expect(imageSize(pngHeader(0, 1080))).toBeNull();
  });

  it("rejects a PNG signature with the wrong chunk", () => {
    const b = pngHeader(100, 100);
    b[12] = 0x69; // "iHDR"
    expect(imageSize(b)).toBeNull();
  });
});

describe("imageSize — JPEG", () => {
  it("walks past other segments to the frame header", () => {
    expect(imageSize(jpegHeader(3840, 2160))).toEqual({ width: 3840, height: 2160 });
  });

  it("reads height BEFORE width, which is the order JPEG stores them", () => {
    // Swapping these is the classic bug and every square test image hides it.
    expect(imageSize(jpegHeader(1080, 1920))).toEqual({ width: 1080, height: 1920 });
  });

  it("ignores markers that merely sit near SOF in the numbering", () => {
    // 0xC4 is a Huffman table, not a frame. Reading it as SOF yields garbage.
    const b = bytes(
      [0xff, 0xd8],
      [0xff, 0xc4],
      u16be(6),
      [0, 1, 2, 3],
      [0xff, 0xc0],
      u16be(11),
      [8],
      u16be(600),
      u16be(400),
      [1, 1, 0x11, 0],
    );
    expect(imageSize(b)).toEqual({ width: 400, height: 600 });
  });

  it("gives up at the scan rather than reading entropy data as a header", () => {
    const b = bytes([0xff, 0xd8], [0xff, 0xda], u16be(8), [0, 0, 0, 0, 0, 0], [0xff, 0xc0], u16be(11), [8], u16be(9), u16be(9));
    expect(imageSize(b)).toBeNull();
  });
});

describe("imageSize — WebP", () => {
  it("reads VP8X, which stores the canvas size minus one", () => {
    // 24-bit little-endian, (value - 1). 4096 → 0x0FFF.
    const body = [0, 0, 0, 0, 0xff, 0x0f, 0x00, 0x3f, 0x1f, 0x00];
    expect(imageSize(riff("VP8X", body))).toEqual({ width: 4096, height: 8000 });
  });

  it("reads VP8L's 14-bit packed fields", () => {
    // signature 0x2f, then width-1 in the low 14 bits, height-1 in the next 14.
    const w = 1080;
    const h = 1920;
    const packed = (w - 1) | ((h - 1) << 14);
    const body = [0x2f, packed & 255, (packed >>> 8) & 255, (packed >>> 16) & 255, (packed >>> 24) & 255];
    expect(imageSize(riff("VP8L", body))).toEqual({ width: w, height: h });
  });

  it("reads a lossy VP8 key frame", () => {
    const body = [0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x38, 0x04, 0x80, 0x07];
    expect(imageSize(riff("VP8 ", body))).toEqual({ width: 1080, height: 1920 });
  });

  it("rejects a RIFF that is not a WebP", () => {
    const b = riff("VP8X", [0, 0, 0, 0, 0xff, 0x0f, 0, 0x3f, 0x1f, 0]);
    b[8] = 0x41; // "AEBP"
    expect(imageSize(b)).toBeNull();
  });
});

describe("imageSize — AVIF", () => {
  it("finds ispe inside the property boxes", () => {
    const b = bytes(
      u32be(24),
      [0x66, 0x74, 0x79, 0x70], // "ftyp"
      [0x61, 0x76, 0x69, 0x66], // "avif"
      u32be(0),
      [0x61, 0x76, 0x69, 0x66],
      [0x6d, 0x69, 0x66, 0x31],
      u32be(20),
      [0x69, 0x73, 0x70, 0x65], // "ispe"
      u32be(0),
      u32be(2160),
      u32be(3840),
    );
    expect(imageSize(b)).toEqual({ width: 2160, height: 3840 });
  });

  it("rejects a non-image ISOBMFF brand", () => {
    const b = bytes(u32be(16), [0x66, 0x74, 0x79, 0x70], [0x6d, 0x70, 0x34, 0x32], u32be(0), u32be(0), u32be(0), u32be(0));
    expect(imageSize(b)).toBeNull();
  });
});

describe("imageSize — refusals", () => {
  it("returns null rather than throwing on junk", () => {
    // It runs on operator uploads; a throw here would fail the whole batch.
    expect(imageSize(new Uint8Array(0))).toBeNull();
    expect(imageSize(new Uint8Array(64))).toBeNull();
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("refuses a truncated header instead of reading past the end", () => {
    expect(imageSize(pngHeader(100, 100).slice(0, 20))).toBeNull();
  });
});
