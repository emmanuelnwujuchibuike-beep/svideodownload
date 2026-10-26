import { describe, expect, it, vi } from "vitest";

import { httpRangeReader, probeMp4, type RangeRead } from "./mp4-probe";

/**
 * Stories Part 4 (B7): the reader that tells a story video's length and codec from its own index. Files are built here
 * box by box, the way cameras and encoders lay them out — index first (web MP4) and index last (an iPhone .mov).
 */
const enc = (s: string) => new TextEncoder().encode(s);
const be32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const box = (type: string, ...payload: Uint8Array[]) => {
  const body = cat(...payload);
  return cat(be32(8 + body.length), enc(type), body);
};
const zeros = (n: number) => new Uint8Array(n);

/** mvhd v0: version/flags, created, modified, timescale, duration, then the rest (zeros) */
const mvhd = (timescale: number, duration: number) => box("mvhd", zeros(4), zeros(8), be32(timescale), be32(duration), zeros(80));
const mvhdV1 = (timescale: number, duration: number) => box("mvhd", new Uint8Array([1, 0, 0, 0]), zeros(16), be32(timescale), be32(0), be32(duration), zeros(80));
const trak = (handler: string, codec: string) =>
  box("trak", box("mdia", box("hdlr", zeros(4), zeros(4), enc(handler), zeros(12)), box("minf", box("stbl", box("stsd", zeros(4), be32(1), be32(16), enc(codec), zeros(8))))));
const moov = (secs: number, codec = "avc1", v1 = false) => box("moov", v1 ? mvhdV1(600, secs * 600) : mvhd(1000, secs * 1000), trak("soun", "mp4a"), trak("vide", codec));
const ftyp = (brand = "isom") => box("ftyp", enc(brand), zeros(4), enc("isommp42"));
const mdat = (n: number) => box("mdat", zeros(n));

/** A range reader over a buffer, counting reads (a real one is a request each). */
function reader(file: Uint8Array) {
  const calls: [number, number][] = [];
  const read: RangeRead = async (s, e) => (calls.push([s, e]), { bytes: file.subarray(s, Math.min(e + 1, file.length)), total: file.length });
  return { read, calls };
}

describe("probeMp4", () => {
  it("a web MP4 (index first): H.264, 15 s — from ONE read of the head", async () => {
    const r = reader(cat(ftyp(), moov(15), mdat(500_000)));
    expect(await probeMp4(r.read)).toEqual({ container: "mp4", durationSec: 15, videoCodec: "avc1" });
    expect(r.calls).toHaveLength(1);
  });

  it("an iPhone .mov (index LAST, behind 2 MB of video): HEVC, 42 s — the video itself is never downloaded", async () => {
    const r = reader(cat(ftyp("qt  "), box("wide"), mdat(2_000_000), moov(42, "hvc1")));
    expect(await probeMp4(r.read)).toEqual({ container: "mov", durationSec: 42, videoCodec: "hvc1" });
    const fetched = r.calls.reduce((n, [s, e]) => n + (e - s + 1), 0);
    expect(fetched).toBeLessThan(100_000);
  });

  it("a version-1 movie header (64-bit durations) reads the same", async () => {
    expect(await probeMp4(reader(cat(ftyp(), moov(90, "avc1", true))).read)).toMatchObject({ durationSec: 90 });
  });

  it("the codec is the VIDEO track's, not the first track's (audio comes first here)", async () => {
    expect(await probeMp4(reader(cat(ftyp(), moov(10, "av01"))).read)).toMatchObject({ videoCodec: "av01" });
  });

  it("🔴 not an MP4 (a WebM, an image renamed .mp4): not_mp4 — never guessed", async () => {
    expect(await probeMp4(reader(cat(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), zeros(100))).read)).toEqual({ error: "not_mp4" });
    expect(await probeMp4(reader(cat(enc("\x89PNG\r\n\x1a\n"), zeros(100))).read)).toEqual({ error: "not_mp4" });
  });

  it("🔴 nothing readable, or a truncated file: unreadable", async () => {
    expect(await probeMp4(async () => null)).toEqual({ error: "unreadable" });
    expect(await probeMp4(reader(cat(ftyp(), mdat(1000)).subarray(0, 40)).read)).toEqual({ error: "unreadable" });
  });
});

describe("httpRangeReader", () => {
  it("asks for exactly the range, and reads the total from Content-Range", async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { "content-range": "bytes 0-2/9000" } }));
    expect(await httpRangeReader("https://media.test/v.mp4", f as unknown as typeof fetch)(0, 2)).toEqual({ bytes: new Uint8Array([1, 2, 3]), total: 9000 });
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ Range: "bytes=0-2" });
  });
  it("🔴 a server that ignores the range (200, the whole file) is not read", async () => {
    const f = vi.fn(async () => new Response(new Uint8Array(10), { status: 200 }));
    expect(await httpRangeReader("https://media.test/v.mp4", f as unknown as typeof fetch)(0, 2)).toBeNull();
  });
});
