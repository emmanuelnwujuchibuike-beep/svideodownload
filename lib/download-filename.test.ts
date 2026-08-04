import { describe, expect, it } from "vitest";

import {
  buildDownloadFilename,
  extensionOf,
  safeDownloadFilename,
  sanitizeBaseName,
} from "@/lib/download-filename";

/** The exact tweet that made the owner's X image save as a generic "File". */
const LONG_TWEET =
  "🚨 BREAKING: Bayern Munich are monitoring Benjamin Sesko closely as a potential long-term replacement option in attack";

describe("the regression this file exists for", () => {
  it("keeps the extension on a title long enough to overflow the limit", () => {
    const name = safeDownloadFilename(`${LONG_TWEET}.jpg`);
    expect(name.endsWith(".jpg"), `got ${name}`).toBe(true);
    // The old code produced "….jp" — a truncated extension is the actual bug.
    expect(name.endsWith(".jp")).toBe(false);
  });

  it("still respects the length limit while doing so", () => {
    expect(safeDownloadFilename(`${LONG_TWEET}.jpg`).length).toBeLessThanOrEqual(120);
  });

  it("never truncates the extension, whatever the title length", () => {
    for (let n = 1; n < 400; n += 7) {
      const name = buildDownloadFilename("a".repeat(n), "jpeg");
      expect(name.endsWith(".jpeg"), `length ${n} lost the extension: ${name}`).toBe(true);
      expect(name.length).toBeLessThanOrEqual(120);
    }
  });
});

describe("sanitizeBaseName", () => {
  it("collapses one emoji into a single separator, not one per surrogate", () => {
    expect(sanitizeBaseName("🚨 Breaking news")).toBe("Breaking news");
    expect(sanitizeBaseName("a 🚨 b")).toBe("a _ b");
  });

  it("strips leading and trailing dots, spaces and separators", () => {
    // A leading dot hides the file on Unix; a trailing dot or space is dropped
    // by Windows, producing a name that doesn't round-trip.
    expect(sanitizeBaseName("  .hidden name.  ")).toBe("hidden name");
    expect(sanitizeBaseName("__weird__")).toBe("weird");
  });

  it("removes characters that are illegal in a path segment", () => {
    expect(sanitizeBaseName("a/b\\c:d*e?f")).toBe("a_b_c_d_e_f");
  });

  it("escapes reserved Windows device names", () => {
    for (const reserved of ["CON", "prn", "AUX", "nul", "com1", "LPT9"]) {
      expect(sanitizeBaseName(reserved)).toBe(`${reserved}_file`);
    }
    expect(sanitizeBaseName("console")).toBe("console");
  });
});

describe("extensionOf", () => {
  it("finds a real extension", () => {
    expect(extensionOf("clip.mp4")).toBe("mp4");
    expect(extensionOf("img.JPEG")).toBe("jpeg");
  });

  it("does not mistake a dot in a title for an extension", () => {
    expect(extensionOf("Ep. 4 — the finale")).toBe("");
    expect(extensionOf("photo.finalversion")).toBe("");
    expect(extensionOf("no dot here")).toBe("");
  });
});

describe("buildDownloadFilename", () => {
  it("appends the extension", () => {
    expect(buildDownloadFilename("My clip", "mp4")).toBe("My clip.mp4");
  });

  it("tolerates a leading dot on the extension", () => {
    expect(buildDownloadFilename("My clip", ".mp4")).toBe("My clip.mp4");
  });

  it("falls back rather than producing a nameless or extension-only file", () => {
    expect(buildDownloadFilename("", "jpg")).toBe("download.jpg");
    expect(buildDownloadFilename("🚨", "jpg")).toBe("download.jpg");
    expect(buildDownloadFilename("")).toBe("download");
  });

  it("never leaves a dangling separator before the dot", () => {
    const name = buildDownloadFilename(`${"word ".repeat(40)}`, "mp4");
    expect(name).not.toMatch(/[\s._-]\.mp4$/);
  });

  it("works with no extension at all", () => {
    expect(buildDownloadFilename("plain title")).toBe("plain title");
  });
});

describe("safeDownloadFilename", () => {
  it("round-trips a normal name untouched", () => {
    expect(safeDownloadFilename("holiday.mp4")).toBe("holiday.mp4");
  });

  it("keeps a title's internal dots while using the real extension", () => {
    expect(safeDownloadFilename("Ep. 4 — the finale.mp4")).toBe("Ep. 4 _ the finale.mp4");
  });

  it("handles a name with no extension", () => {
    expect(safeDownloadFilename("just a name")).toBe("just a name");
  });
});
