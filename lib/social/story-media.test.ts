import { describe, expect, it, vi } from "vitest";

import type { RangeRead } from "@/lib/media/mp4-probe";

vi.mock("server-only", () => ({}));
const { checkStoryVideo, STORY_VIDEO_MAX_SECONDS } = await import("./story-media");

/** Stories Part 4 (B7): the rule over the reader's facts — the reader itself is tested with real boxes in lib/media. */
const enc = (s: string) => new TextEncoder().encode(s);
const be32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const cat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let a = 0;
  for (const x of p) {
    o.set(x, a);
    a += x.length;
  }
  return o;
};
const box = (t: string, ...p: Uint8Array[]) => {
  const b = cat(...p);
  return cat(be32(8 + b.length), enc(t), b);
};
const z = (n: number) => new Uint8Array(n);
const file = (secs: number, codec: string) =>
  cat(
    box("ftyp", enc("isom"), z(4)),
    box("moov", box("mvhd", z(12), be32(1000), be32(Math.round(secs * 1000)), z(80)), box("trak", box("mdia", box("hdlr", z(8), enc("vide"), z(12)), box("minf", box("stbl", box("stsd", z(4), be32(1), be32(16), enc(codec), z(8))))))),
  );
const reader = (f: Uint8Array): RangeRead => async (s, e) => ({ bytes: f.subarray(s, e + 1), total: f.length });

describe("checkStoryVideo", () => {
  it("H.264 up to the limit: allowed", async () => {
    expect(await checkStoryVideo("x", reader(file(STORY_VIDEO_MAX_SECONDS, "avc1")))).toMatchObject({ ok: true, codec: "avc1" });
  });
  it("🔴 over the limit: too_long — whatever the browser might have claimed", async () => {
    expect(await checkStoryVideo("x", reader(file(STORY_VIDEO_MAX_SECONDS + 5, "avc1")))).toMatchObject({ ok: false, reason: "too_long" });
  });
  it("🔴 HEVC: refused with how to export it — the extension is never renamed", async () => {
    const v = await checkStoryVideo("x", reader(file(10, "hvc1")));
    expect(v).toMatchObject({ ok: false, reason: "codec" });
    expect(!v.ok && v.message).toContain("Most Compatible");
  });
  it("🔴 another codec (AV1, VP9…): refused; unreadable: refused, never published broken", async () => {
    expect(await checkStoryVideo("x", reader(file(10, "av01")))).toMatchObject({ ok: false, reason: "codec" });
    expect(await checkStoryVideo("x", async () => null)).toMatchObject({ ok: false, reason: "unreadable" });
  });
});
