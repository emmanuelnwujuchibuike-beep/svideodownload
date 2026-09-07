import { describe, expect, it } from "vitest";

import {
  AI_CLEAN_ACCEPT,
  AI_CLEAN_ERRORS,
  AI_CLEAN_FORMATS,
  AI_CLEAN_MAX_BYTES,
  fileExtension,
  formatResolution,
  inspectVideoFile,
  parseVideoUrl,
  type AICleanErrorCode,
} from "./clean-media";

/**
 * AI Clean's gate, tested at the layer that decides.
 *
 * These rules are the only thing standing between a person and a dead end, and
 * they are pure, so there is no excuse for not pinning them. The cases below are
 * the ones that actually happen on real devices — an Android picker with no MIME
 * type, a renamed file, a link pasted without its scheme — not a survey of what
 * the functions can be made to return.
 */

const ok = (name: string, size = 1024, type = "video/mp4") => inspectVideoFile({ name, size, type });

describe("inspectVideoFile", () => {
  it("accepts every advertised format by MIME type", () => {
    for (const format of AI_CLEAN_FORMATS) {
      for (const mime of format.mimeTypes) {
        expect(ok(`clip.${format.extension}`, 1024, mime), `${mime} was refused`).toEqual({ ok: true });
      }
    }
  });

  it("accepts a file whose picker reported no MIME type at all", () => {
    // Android's document picker does this constantly. Refusing here would make
    // the tool unusable on the devices it is designed for.
    expect(ok("holiday.mov", 2048, "")).toEqual({ ok: true });
  });

  it("accepts an unfamiliar MIME string when the extension is one we take", () => {
    expect(ok("clip.mp4", 2048, "application/octet-stream")).toEqual({ ok: true });
  });

  it("refuses a file that is neither a known type nor a known extension", () => {
    expect(ok("notes.pdf", 2048, "application/pdf")).toEqual({ ok: false, code: "unsupported-file" });
    expect(ok("photo.jpg", 2048, "image/jpeg")).toEqual({ ok: false, code: "unsupported-file" });
    // A video container we do not advertise is still a refusal, not a maybe.
    expect(ok("clip.mkv", 2048, "video/x-matroska")).toEqual({ ok: false, code: "unsupported-file" });
  });

  it("refuses a video over the size ceiling, and takes one exactly at it", () => {
    expect(ok("big.mp4", AI_CLEAN_MAX_BYTES + 1)).toEqual({ ok: false, code: "file-too-large" });
    expect(ok("edge.mp4", AI_CLEAN_MAX_BYTES)).toEqual({ ok: true });
  });

  it("checks the kind before the size, so an oversized PDF is not called a large video", () => {
    expect(ok("huge.pdf", AI_CLEAN_MAX_BYTES + 1, "application/pdf")).toEqual({
      ok: false,
      code: "unsupported-file",
    });
  });

  it("treats a zero-byte file as unreadable rather than as a valid video", () => {
    expect(ok("empty.mp4", 0)).toEqual({ ok: false, code: "invalid-video" });
  });

  it("is not fooled by case", () => {
    expect(ok("CLIP.MP4", 1024, "VIDEO/MP4")).toEqual({ ok: true });
  });
});

describe("fileExtension", () => {
  it("reads the last extension, lower-cased", () => {
    expect(fileExtension("my.holiday.clip.MOV")).toBe("mov");
  });

  it("returns empty for a name with no extension, or a trailing dot", () => {
    expect(fileExtension("clip")).toBe("");
    expect(fileExtension("clip.")).toBe("");
  });
});

describe("parseVideoUrl", () => {
  it("keeps an absolute https link, normalised", () => {
    expect(parseVideoUrl("  https://example.com/clip.mp4  ")).toBe("https://example.com/clip.mp4");
  });

  it("upgrades a bare host to https rather than refusing it", () => {
    // This is how links arrive from a share sheet.
    expect(parseVideoUrl("example.com/clip")).toBe("https://example.com/clip");
  });

  it("refuses anything that is not a web address", () => {
    for (const bad of ["", "   ", "hello", "hello world", "https://", "example.", "/clip.mp4"]) {
      expect(parseVideoUrl(bad), `"${bad}" was accepted`).toBeNull();
    }
  });

  it("🔴 refuses every non-http scheme", () => {
    /*
      The one that matters. `javascript:` and `data:` reaching a link field is
      how a paste becomes an execution, and `file:` is a read of the visitor's
      own disk. None of them are fetched here — nothing in Part 1 fetches
      anything — but the value flows into state and, later, to a server, and a
      filter that only holds while nothing uses its output is not a filter.
    */
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "ftp://example.com/clip.mp4"]) {
      expect(parseVideoUrl(bad), `"${bad}" was accepted`).toBeNull();
    }
  });
});

describe("formatResolution", () => {
  it("formats a measured size", () => {
    expect(formatResolution(1920, 1080)).toBe("1920 × 1080");
  });

  it("returns null — never a zero — for anything unmeasured", () => {
    // The preview renders null as an em-dash. "Not measured" and "measured as
    // nothing" are different claims, and this is where that rule is enforced.
    expect(formatResolution(null, null)).toBeNull();
    expect(formatResolution(0, 0)).toBeNull();
    expect(formatResolution(1920, null)).toBeNull();
    expect(formatResolution(-4, 1080)).toBeNull();
  });
});

describe("the copy table covers every failure the type allows", () => {
  it("gives every code a title, a sentence and a way out", () => {
    const codes: AICleanErrorCode[] = [
      "unsupported-file",
      "file-too-large",
      "invalid-video",
      "invalid-url",
      "upload-failed",
      "processing-failed",
    ];
    for (const code of codes) {
      const copy = AI_CLEAN_ERRORS[code];
      expect(copy, `${code} has no copy`).toBeTruthy();
      expect(copy.title.length, `${code} has no title`).toBeGreaterThan(0);
      expect(copy.body.length, `${code}'s body is too thin to help`).toBeGreaterThan(20);
      expect(copy.action.length, `${code} offers no way out`).toBeGreaterThan(0);
    }
    // Nothing extra: an orphaned entry means a code was renamed and its copy left.
    expect(Object.keys(AI_CLEAN_ERRORS).sort()).toEqual([...codes].sort());
  });
});

describe("the accept attribute offers both signals", () => {
  it("names every extension and every MIME type the checker will take", () => {
    for (const format of AI_CLEAN_FORMATS) {
      expect(AI_CLEAN_ACCEPT, `.${format.extension} missing from accept`).toContain(`.${format.extension}`);
      for (const mime of format.mimeTypes) {
        expect(AI_CLEAN_ACCEPT, `${mime} missing from accept`).toContain(mime);
      }
    }
  });
});
