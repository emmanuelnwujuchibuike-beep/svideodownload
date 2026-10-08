import { describe, expect, it } from "vitest";

import type { MediaFormat } from "@/types";

import { withQualityLadder } from "./quality-ladder";

/**
 * `withQualityLadder` used to trust that every extractor already returned its
 * video formats best-first, and only ever touched that ordering on the (rare)
 * "needs synthesized lower tiers" path. The far more common case — a source
 * that already has 4+ native tiers, or fewer than 4 but no `directUrl` to
 * synthesize from — returned the input completely unchanged, so a single
 * extractor with the order wrong would silently make "download the highest
 * quality" (the default `activeId`/tab pick in PreviewCard, and every batch
 * item) not actually be the highest quality. This file locks in that the
 * function now enforces the ordering itself, unconditionally.
 */

const video = (over: Partial<MediaFormat>): MediaFormat => ({
  formatId: over.formatId ?? "f",
  kind: "video",
  label: over.label ?? "video",
  ext: "mp4",
  resolution: over.resolution ?? null,
  fps: null,
  filesize: null,
  tbr: over.tbr ?? null,
  vcodec: over.vcodec ?? "h264",
  acodec: "aac",
  directUrl: over.directUrl ?? "https://example.com/v.mp4",
  httpHeaders: null,
  isSeparateItem: over.isSeparateItem,
});

describe("withQualityLadder — enforces best-first ordering unconditionally", () => {
  it("re-sorts an already-4+-tier list that arrived worst-first (no synthesis needed)", () => {
    // 4 native tiers — the early-return path that used to skip ordering
    // entirely, since it never fell through to the synthesis logic below.
    const formats = [
      video({ formatId: "a", resolution: "360p" }),
      video({ formatId: "b", resolution: "1080p" }),
      video({ formatId: "c", resolution: "720p" }),
      video({ formatId: "d", resolution: "480p" }),
    ];
    const out = withQualityLadder(formats).filter((f) => f.kind === "video");
    expect(out.map((f) => f.formatId)).toEqual(["b", "c", "d", "a"]);
  });

  it("sorts by bitrate when heights are equal or unknown", () => {
    // 4 native tiers, so the synthesis path never fires — isolates the sort.
    const formats = [
      video({ formatId: "low-tbr", resolution: "720p", tbr: 800 }),
      video({ formatId: "high-tbr", resolution: "720p", tbr: 3000 }),
      video({ formatId: "no-height", tbr: 500 }),
      video({ formatId: "filler", resolution: "480p" }),
    ];
    const out = withQualityLadder(formats).filter((f) => f.kind === "video");
    // Known heights always sort ahead of unknown ones, regardless of bitrate.
    expect(out.map((f) => f.formatId)).toEqual(["high-tbr", "low-tbr", "filler", "no-height"]);
  });

  it("puts a streamable tier ahead of one that converts on download (production TikTok shape, 2026-10-08)", () => {
    // native TikTok: bytevc1 1920p + 1280p, H.264 1024p — the default pick was the 16 s re-encode
    const formats = [
      video({ formatId: "tt-0", resolution: "1024p", vcodec: "h264" }),
      video({ formatId: "tt-1", resolution: "1920p", vcodec: "hevc" }),
      video({ formatId: "tt-2", resolution: "1280p", vcodec: "hevc" }),
      video({ formatId: "tt-3", resolution: "540p", vcodec: "av1" }),
    ];
    const out = withQualityLadder(formats).filter((f) => f.kind === "video");
    expect(out.map((f) => f.formatId)).toEqual(["tt-0", "tt-1", "tt-2", "tt-3"]);
  });

  it("an unknown codec is not assumed to convert (yt-dlp formats keep the height order)", () => {
    const formats = [
      video({ formatId: "1440", resolution: "1440p", vcodec: null }),
      video({ formatId: "2160", resolution: "2160p", vcodec: null }),
      video({ formatId: "720", resolution: "720p", vcodec: "h264" }),
      video({ formatId: "480", resolution: "480p", vcodec: "h264" }),
    ];
    const out = withQualityLadder(formats).filter((f) => f.kind === "video");
    expect(out.map((f) => f.formatId)).toEqual(["2160", "1440", "720", "480"]);
  });

  it("never reorders isSeparateItem entries relative to each other — order is content, not quality", () => {
    const formats = [
      video({ formatId: "story-1", resolution: "480p", isSeparateItem: true }),
      video({ formatId: "story-2", resolution: "1080p", isSeparateItem: true }),
      video({ formatId: "story-3", resolution: "720p", isSeparateItem: true }),
      video({ formatId: "story-4", resolution: "360p", isSeparateItem: true }),
    ];
    const out = withQualityLadder(formats).filter((f) => f.kind === "video");
    expect(out.map((f) => f.formatId)).toEqual(["story-1", "story-2", "story-3", "story-4"]);
  });

  it("sorts quality-ladder entries independently of interleaved separate items", () => {
    const formats = [
      video({ formatId: "story-1", resolution: "480p", isSeparateItem: true }),
      video({ formatId: "low", resolution: "360p" }),
      video({ formatId: "story-2", resolution: "1080p", isSeparateItem: true }),
      video({ formatId: "high", resolution: "1080p" }),
    ];
    const out = withQualityLadder(formats).filter((f) => f.kind === "video");
    // Separate items keep their positions AND their relative order;
    // non-separate entries keep their positions but are re-ranked among themselves.
    expect(out.map((f) => f.formatId)).toEqual(["story-1", "high", "story-2", "low"]);
  });

  it("does not touch non-video formats' order", () => {
    const formats = [
      video({ formatId: "v1", resolution: "1080p" }),
      video({ formatId: "v2", resolution: "720p" }),
      video({ formatId: "v3", resolution: "480p" }),
      video({ formatId: "v4", resolution: "360p" }),
      { formatId: "a1", kind: "audio", label: "audio", ext: "m4a", resolution: null, fps: null, filesize: null, tbr: null, vcodec: null, acodec: "aac", directUrl: null, httpHeaders: null } as MediaFormat,
    ];
    const out = withQualityLadder(formats);
    expect(out.map((f) => f.formatId)).toEqual(["v1", "v2", "v3", "v4", "a1"]);
  });

  it("still synthesizes lower tiers from the now-guaranteed-best source", () => {
    const formats = [video({ formatId: "only", resolution: "1080p", vcodec: "h264" })];
    const out = withQualityLadder(formats).filter((f) => f.kind === "video");
    expect(out[0]!.formatId).toBe("only");
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((f) => (f === out[0] ? true : (f.transcodeMaxHeight ?? 0) < 1080))).toBe(true);
  });
});
