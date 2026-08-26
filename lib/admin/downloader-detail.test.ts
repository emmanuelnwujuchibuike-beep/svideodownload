import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { formatLabel } = await import("./downloader-detail");

/**
 * `downloads.format` is a PACKED string written by features/history/sync.ts:
 * formatId~|~kind~|~qualityLabel~|~size~|~status~|~failureReason.
 *
 * 🔴 Caught live, 2026-08-26: a real row decoded to
 * "TT-SD~|~VIDEO~|~HD · NO WATERMARK~|~2285689~|~~|~", and using that raw
 * string as a GROUPING KEY (the admin "byFormat" breakdown) put nearly every
 * download in its own one-off bucket, since `size` (field 4) differs on
 * almost every download. Four downloads that should have grouped as one "HD ·
 * NO WATERMARK" bucket showed as four. This pins the decode so it can't
 * regress back to using the raw string.
 */
describe("formatLabel", () => {
  it("extracts the quality label, not the whole packed string", () => {
    expect(formatLabel("TT-SD~|~VIDEO~|~HD · NO WATERMARK~|~2285689~|~~|~")).toBe("HD · NO WATERMARK");
  });

  it("🔴 two downloads differing only in size decode to the SAME label", () => {
    // This is the actual regression: size must never leak into the grouping key.
    const a = formatLabel("TT-SD~|~VIDEO~|~HD · NO WATERMARK~|~2285689~|~~|~");
    const b = formatLabel("TT-SD~|~VIDEO~|~HD · NO WATERMARK~|~9999999~|~~|~");
    expect(a).toBe(b);
  });

  it("falls back to kind when there is no quality label", () => {
    expect(formatLabel("best~|~audio~|~~|~1024~|~~|~")).toBe("AUDIO");
  });

  it("falls back to the format id when neither quality nor kind is present", () => {
    expect(formatLabel("mp4-best~|~~|~~|~~|~~|~")).toBe("MP4-BEST");
  });

  it("returns null for null/empty input", () => {
    expect(formatLabel(null)).toBeNull();
    expect(formatLabel("")).toBeNull();
  });

  it("handles an old, unpacked row (no separator at all) as a bare formatId", () => {
    // Pre-encoding rows (or any row that never carried the packed fields)
    // split into a single-element array — the whole string is the "formatId".
    expect(formatLabel("mp4")).toBe("MP4");
  });
});
