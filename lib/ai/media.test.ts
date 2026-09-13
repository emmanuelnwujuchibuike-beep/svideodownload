import { describe, expect, it } from "vitest";

import {
  AI_IMAGE_ACCEPT,
  AI_IMAGE_FORMATS,
  AI_IMAGE_MAX_BYTES,
  AI_MEDIA_ERRORS,
  AI_VIDEO_ACCEPT,
  AI_VIDEO_FORMATS,
  AI_VIDEO_MAX_BYTES,
  extensionForUpload,
  fileExtension,
  formatDuration,
  formatResolution,
  imageExtensionForUpload,
  inspectImageFile,
  inspectVideoFile,
  parseVideoUrl,
  resultFileName,
  type AiMediaErrorCode,
} from "./media";

/**
 * The platform's media gate, tested at the layer that decides.
 *
 * These rules are the only thing standing between a person and a dead end, and
 * they are pure, so there is no excuse for not pinning them. The cases below are
 * the ones that actually happen on real devices — an Android picker with no MIME
 * type, a renamed file, a link pasted without its scheme — not a survey of what
 * the functions can be made to return.
 *
 * Ported from `clean-media.test.ts` on 2026-09-13 when the module stopped
 * belonging to AI Clean; every video case is unchanged, and the image cases
 * are new for Character Replace's reference photo.
 */

const video = (name: string, size = 1024, type = "video/mp4") => inspectVideoFile({ name, size, type });
const image = (name: string, size = 1024, type = "image/jpeg") => inspectImageFile({ name, size, type });

describe("inspectVideoFile", () => {
  it("accepts every advertised format by MIME type", () => {
    for (const format of AI_VIDEO_FORMATS) {
      for (const mime of format.mimeTypes) {
        expect(video(`clip.${format.extension}`, 1024, mime), `${mime} was refused`).toEqual({ ok: true });
      }
    }
  });

  it("accepts a file whose picker reported no MIME type at all", () => {
    // Android's document picker does this constantly. Refusing here would make
    // the tool unusable on the devices it is designed for.
    expect(video("holiday.mov", 2048, "")).toEqual({ ok: true });
  });

  it("accepts an unfamiliar MIME string when the extension is one we take", () => {
    expect(video("clip.mp4", 2048, "application/octet-stream")).toEqual({ ok: true });
  });

  it("refuses a file that is neither a known type nor a known extension", () => {
    expect(video("notes.pdf", 2048, "application/pdf")).toEqual({ ok: false, code: "unsupported-file" });
    expect(video("photo.jpg", 2048, "image/jpeg")).toEqual({ ok: false, code: "unsupported-file" });
    // A video container we do not advertise is still a refusal, not a maybe.
    expect(video("clip.mkv", 2048, "video/x-matroska")).toEqual({ ok: false, code: "unsupported-file" });
  });

  it("refuses a video over the size ceiling, and takes one exactly at it", () => {
    expect(video("big.mp4", AI_VIDEO_MAX_BYTES + 1)).toEqual({ ok: false, code: "file-too-large" });
    expect(video("edge.mp4", AI_VIDEO_MAX_BYTES)).toEqual({ ok: true });
  });

  it("checks the kind before the size, so an oversized PDF is not called a large video", () => {
    expect(video("huge.pdf", AI_VIDEO_MAX_BYTES + 1, "application/pdf")).toEqual({
      ok: false,
      code: "unsupported-file",
    });
  });

  it("treats a zero-byte file as unreadable rather than as a valid video", () => {
    expect(video("empty.mp4", 0)).toEqual({ ok: false, code: "invalid-video" });
  });

  it("is not fooled by case", () => {
    expect(video("CLIP.MP4", 1024, "VIDEO/MP4")).toEqual({ ok: true });
  });
});

describe("inspectImageFile", () => {
  it("accepts every advertised format by MIME type and by extension", () => {
    for (const format of AI_IMAGE_FORMATS) {
      for (const mime of format.mimeTypes) {
        expect(image(`me.${format.extension}`, 1024, mime), `${mime} was refused`).toEqual({ ok: true });
      }
      expect(image(`me.${format.extension}`, 1024, ""), `.${format.extension} was refused`).toEqual({ ok: true });
    }
  });

  it("refuses a video, a HEIC and a document as a photo — each with the IMAGE code", () => {
    // The image codes are their own, so the copy says "photo" and never "video".
    expect(image("clip.mp4", 2048, "video/mp4")).toEqual({ ok: false, code: "unsupported-image" });
    expect(image("IMG_0001.HEIC", 2048, "image/heic")).toEqual({ ok: false, code: "unsupported-image" });
    expect(image("notes.pdf", 2048, "application/pdf")).toEqual({ ok: false, code: "unsupported-image" });
  });

  it("refuses an oversized photo and an empty one", () => {
    expect(image("huge.png", AI_IMAGE_MAX_BYTES + 1, "image/png")).toEqual({ ok: false, code: "image-too-large" });
    expect(image("edge.png", AI_IMAGE_MAX_BYTES, "image/png")).toEqual({ ok: true });
    expect(image("empty.jpg", 0)).toEqual({ ok: false, code: "invalid-image" });
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

describe("extensionForUpload", () => {
  it("prefers the name, then the MIME type, then mp4", () => {
    expect(extensionForUpload("clip.mov", "video/mp4")).toBe("mov");
    expect(extensionForUpload("clip", "video/webm")).toBe("webm");
    expect(extensionForUpload(undefined, "application/octet-stream")).toBe("mp4");
  });

  it("stores every JPEG as .jpg, whichever spelling the picker used", () => {
    expect(imageExtensionForUpload("me.jpeg", "image/jpeg")).toBe("jpg");
    expect(imageExtensionForUpload("me.JPG", "")).toBe("jpg");
    expect(imageExtensionForUpload(undefined, "image/png")).toBe("png");
    expect(imageExtensionForUpload("me", "image/webp")).toBe("webp");
    expect(imageExtensionForUpload(undefined, "")).toBe("jpg");
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
      own disk. The value flows into state and, later, to a server, and a
      filter that only holds while nothing uses its output is not a filter.
    */
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "ftp://example.com/clip.mp4"]) {
      expect(parseVideoUrl(bad), `"${bad}" was accepted`).toBeNull();
    }
  });
});

describe("formatResolution / formatDuration", () => {
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

  it("writes a duration as m:ss and refuses to invent one", () => {
    expect(formatDuration(84)).toBe("1:24");
    expect(formatDuration(725)).toBe("12:05");
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(59.6)).toBe("1:00");
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
    expect(formatDuration(-1)).toBeNull();
  });
});

describe("the copy table covers every failure the type allows", () => {
  it("gives every code a title, a sentence and a way out", () => {
    const codes: AiMediaErrorCode[] = [
      "unsupported-file",
      "file-too-large",
      "invalid-video",
      "video-too-short",
      "video-resolution-too-large",
      "video-resolution-too-small",
      "unsupported-image",
      "image-too-large",
      "image-too-small",
      "invalid-image",
      "invalid-url",
      "upload-failed",
      "processing-failed",
    ];
    for (const code of codes) {
      const copy = AI_MEDIA_ERRORS[code];
      expect(copy, `${code} has no copy`).toBeTruthy();
      expect(copy.title.length, `${code} has no title`).toBeGreaterThan(0);
      expect(copy.body.length, `${code}'s body is too thin to help`).toBeGreaterThan(20);
      expect(copy.action.length, `${code} offers no way out`).toBeGreaterThan(0);
    }
    // Nothing extra: an orphaned entry means a code was renamed and its copy left.
    expect(Object.keys(AI_MEDIA_ERRORS).sort()).toEqual([...codes].sort());
  });

  it("never says 'AI Clean' — the tool is gone", () => {
    for (const copy of Object.values(AI_MEDIA_ERRORS)) {
      expect(`${copy.title} ${copy.body} ${copy.action}`).not.toMatch(/AI Clean|cleanup|cleaned/i);
    }
  });
});

describe("the accept attributes offer both signals", () => {
  it("names every extension and every MIME type the checkers will take", () => {
    for (const format of AI_VIDEO_FORMATS) {
      expect(AI_VIDEO_ACCEPT, `.${format.extension} missing from accept`).toContain(`.${format.extension}`);
      for (const mime of format.mimeTypes) {
        expect(AI_VIDEO_ACCEPT, `${mime} missing from accept`).toContain(mime);
      }
    }
    for (const format of AI_IMAGE_FORMATS) {
      expect(AI_IMAGE_ACCEPT, `.${format.extension} missing from accept`).toContain(`.${format.extension}`);
    }
    // 🔴 Explicit types, not `image/*`: that is what makes iOS convert HEIC on
    // the way in rather than handing the page a file it cannot decode.
    expect(AI_IMAGE_ACCEPT).not.toContain("image/*");
    expect(AI_IMAGE_ACCEPT).not.toMatch(/heic|heif/i);
  });
});

/**
 * 🔴 Every hostile character here is written as an ESCAPE (`\u202E`), never as
 * the character itself. `source-integrity.test.ts` exists to catch raw NUL and
 * control bytes in source, and an earlier version of this file was the thing
 * it caught. Escapes are also the only readable form: a line containing an
 * invisible right-to-left override looks identical to one that does not.
 */
describe("resultFileName", () => {
  it("keeps the member's own name, so the file is findable in a Downloads folder", () => {
    expect(resultFileName("holiday.mp4")).toBe("holiday-frenz-ai.mp4");
    expect(resultFileName("My Trip 2026.MOV", "replaced")).toBe("My-Trip-2026-replaced.mp4");
  });

  it("falls back when there is nothing usable to keep", () => {
    // The suffix decorates a real name; with no name there is one fallback.
    expect(resultFileName(null)).toBe("frenz-ai-video.mp4");
    expect(resultFileName(null, "replaced")).toBe("frenz-ai-video.mp4");
    expect(resultFileName("", "replaced")).toBe("frenz-ai-video.mp4");
    expect(resultFileName("...", "replaced")).toBe("frenz-ai-video.mp4");
    expect(resultFileName("///", "replaced")).toBe("frenz-ai-video.mp4");
  });

  it("🔴 strips anything that could escape a filename", () => {
    const hostile = [
      "../../etc/passwd.mp4",
      "..\\..\\windows\\system32.mp4",
      'video";rm -rf /.mp4',
      "clip\n\rmalicious.mp4",
      "<script>alert(1)</script>.mp4",
      "nul\u0000byte.mp4",
      // A right-to-left override: the classic trick for disguising an
      // extension, so that "exe" renders as though it were "mp4".
      "clip\u202Eexe.mp4",
    ];

    for (const name of hostile) {
      const out = resultFileName(name);
      expect(out, name).toMatch(/\.mp4$/);
      expect(out, name).not.toContain("/");
      expect(out, name).not.toContain("\\");
      expect(out, name).not.toContain("..");
      expect(out, name).not.toContain('"');
      expect(out, name).not.toContain("<");
      // No control characters and no direction overrides survive.
      expect(/[\u0000-\u001F\u202A-\u202E]/.test(out), name).toBe(false);
    }
  });

  it("always ends in .mp4, which is what is actually stored", () => {
    expect(resultFileName("clip.webm", "replaced")).toBe("clip-replaced.mp4");
    expect(resultFileName("no-extension", "replaced")).toBe("no-extension-replaced.mp4");
  });

  it("keeps letters from any alphabet, because names are not only ASCII", () => {
    // Combining marks included — see the \p{M} note in resultFileName.
    expect(resultFileName("Ọjọ́-ìbí.mp4", "replaced")).toBe("Ọjọ́-ìbí-replaced.mp4");
  });

  it("bounds the length", () => {
    expect(resultFileName("a".repeat(300) + ".mp4").length).toBeLessThanOrEqual(80);
  });
});
