import { describe, expect, it } from "vitest";

import type { DownloadRecord } from "@/types";

import { computeUsage, estimateBytes, GUEST_LIMIT_BYTES } from "./usage";

const MB = 1024 * 1024;
const GB = 1024 ** 3;

function rec(over: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    id: crypto.randomUUID(),
    url: "https://example.com/v",
    platform: "youtube",
    platformName: "YouTube",
    title: "Clip",
    thumbnail: null,
    formatId: "best",
    kind: "video",
    qualityLabel: "1080p",
    size: null,
    createdAt: Date.now(),
    favorite: false,
    ...over,
  };
}

describe("estimateBytes", () => {
  it("uses the exact recorded size when present", () => {
    expect(estimateBytes(rec({ size: 123_456 }))).toBe(123_456);
  });
  it("falls back by kind and platform when size is missing", () => {
    expect(estimateBytes(rec({ size: null, kind: "audio" }))).toBe(5 * MB);
    expect(estimateBytes(rec({ size: null, kind: "image" }))).toBe(2 * MB);
    expect(estimateBytes(rec({ size: null, kind: "video", platform: "tiktok" }))).toBe(12 * MB);
    expect(estimateBytes(rec({ size: null, kind: "video", platform: "youtube" }))).toBe(38 * MB);
  });
  it("treats a zero or negative recorded size as unknown", () => {
    expect(estimateBytes(rec({ size: 0, kind: "audio" }))).toBe(5 * MB);
  });
});

describe("computeUsage — the 5 GB guest quota", () => {
  it("is empty and under limit with no downloads", () => {
    const u = computeUsage([]);
    expect(u.count).toBe(0);
    expect(u.usedBytes).toBe(0);
    expect(u.overLimit).toBe(false);
    expect(u.nearLimit).toBe(false);
    expect(u.remainingBytes).toBe(GUEST_LIMIT_BYTES);
    expect(u.topPlatform).toBeNull();
  });

  it("flags overLimit once used bytes reach the ceiling", () => {
    // One record whose exact size is exactly the limit.
    const u = computeUsage([rec({ size: GUEST_LIMIT_BYTES })]);
    expect(u.overLimit).toBe(true);
    expect(u.remainingBytes).toBe(0);
    expect(u.percentUsed).toBe(100);
  });

  it("does NOT flag overLimit just below the ceiling", () => {
    const u = computeUsage([rec({ size: GUEST_LIMIT_BYTES - 1 })]);
    expect(u.overLimit).toBe(false);
  });

  it("enters the near-limit warning band at 80%", () => {
    const u = computeUsage([rec({ size: Math.ceil(GUEST_LIMIT_BYTES * 0.85) })]);
    expect(u.nearLimit).toBe(true);
    expect(u.overLimit).toBe(false);
  });

  it("never gates a signed-in user (uncapped limit)", () => {
    const u = computeUsage([rec({ size: 50 * GB })], Infinity);
    expect(u.overLimit).toBe(false);
    expect(u.nearLimit).toBe(false);
    expect(u.remainingBytes).toBe(Infinity);
    expect(u.percentUsed).toBe(0);
  });
});

describe("computeUsage — analytics", () => {
  it("breaks usage down by kind and platform, largest first, summing to the total", () => {
    const items = [
      rec({ kind: "video", platform: "youtube", size: 40 * MB }),
      rec({ kind: "audio", platform: "youtube", size: 4 * MB }),
      rec({ kind: "video", platform: "tiktok", size: 10 * MB }),
    ];
    const u = computeUsage(items);
    expect(u.usedBytes).toBe(54 * MB);
    // by-kind sorted by bytes desc
    expect(u.byKind.map((k) => k.key)).toEqual(["video", "audio"]);
    expect(u.byKind[0]!.bytes).toBe(50 * MB);
    expect(u.byKind[0]!.count).toBe(2);
    // breakdowns sum to the whole
    expect(u.byKind.reduce((s, k) => s + k.bytes, 0)).toBe(u.usedBytes);
    expect(u.byPlatform.reduce((s, p) => s + p.bytes, 0)).toBe(u.usedBytes);
    expect(u.topPlatform!.key).toBe("youtube");
    expect(u.averageBytes).toBe(Math.round((54 * MB) / 3));
  });

  it("counts only the trailing week for this-week activity", () => {
    const now = 1_700_000_000_000;
    const old = now - 10 * 24 * 60 * 60 * 1000; // 10 days ago
    const items = [rec({ size: 10 * MB, createdAt: now }), rec({ size: 10 * MB, createdAt: old })];
    const u = computeUsage(items, GUEST_LIMIT_BYTES, now);
    expect(u.thisWeekCount).toBe(1);
    expect(u.thisWeekBytes).toBe(10 * MB);
    expect(u.firstAt).toBe(old);
    expect(u.lastAt).toBe(now);
  });
});
