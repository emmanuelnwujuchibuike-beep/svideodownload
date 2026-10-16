import { describe, expect, it } from "vitest";

import { classifyVerification, isSubReference, isUuid, SUB_ABANDON_GRACE_MS, subReturnPath } from "./guards";
import { checkUpload, sniffMedia, SUB_MAX_IMAGE_BYTES } from "./upload-check";

const BS = String.fromCharCode(92); // a backslash, spelled out so no escaping hides it

// Frenz Exclusive Part 2 (2026-10-16) — the pure guards behind the hardening.
describe("subReturnPath — the /sub/return open redirect (audit S3)", () => {
  /** The check /sub/return used before Part 2, kept here so the tests prove they have teeth. */
  const OLD = (n: string) => (n.startsWith("/") && !n.startsWith("//") ? n : "/");
  const lands = (path: string) => new URL(path, "https://frenzsave.com").host;

  it("keeps an ordinary internal path, with its query", () => {
    expect(subReturnPath("/u/amaka?tab=sub")).toBe("/u/amaka?tab=sub");
    expect(subReturnPath("/members")).toBe("/members");
  });
  it("refuses a backslash path that a browser reads as another host — the old check let it through", () => {
    const attack = `/${BS}evil.com`;
    expect(lands(OLD(attack))).toBe("evil.com"); // the defect, reproduced
    expect(subReturnPath(attack)).toBe("/");
    expect(lands(subReturnPath(attack))).toBe("frenzsave.com");
    expect(subReturnPath(`/${BS}${BS}evil.com`)).toBe("/");
  });
  it("refuses protocol-relative, absolute and malformed destinations", () => {
    for (const bad of ["//evil.com", "https://evil.com", "http://evil.com/x", "javascript:alert(1)", "evil.com", "", "/x\u0000y", "/a\nb", "x".repeat(600)]) {
      expect(subReturnPath(bad), JSON.stringify(bad)).toBe("/");
      expect(lands(subReturnPath(bad))).toBe("frenzsave.com");
    }
    expect(subReturnPath(undefined)).toBe("/");
    expect(subReturnPath(["/a"])).toBe("/");
  });
  it("uses the given fallback for anything refused", () => {
    expect(subReturnPath("//evil.com", "/u/amaka")).toBe("/u/amaka");
  });
});

describe("identifier guards", () => {
  it("isUuid accepts a UUID and nothing that could extend a PostgREST filter", () => {
    expect(isUuid("00000000-0000-4000-8000-000000000001")).toBe(true);
    for (const bad of ["", "not-a-uuid", "00000000-0000-4000-8000-00000000000", "00000000-0000-4000-8000-000000000001,and(x.eq.1)", "00000000-0000-4000-8000-000000000001)", null, 42]) expect(isUuid(bad)).toBe(false);
  });
  it("isSubReference accepts only the shape startSubCheckout creates", () => {
    expect(isSubReference(`frenz_sub_${"a1".repeat(16)}`)).toBe(true);
    for (const bad of ["frenz_sub_", "frenz_sub_xyz", `frenz_ad_${"a1".repeat(16)}`, `frenz_sub_${"a1".repeat(16)}&x=1`, `FRENZ_SUB_${"A1".repeat(16)}`]) expect(isSubReference(bad)).toBe(false);
  });
});

describe("classifyVerification — the checkout race (audit S1)", () => {
  const MIN = 60_000;
  it("an unfinished checkout two minutes old is NOT terminal (the old code failed it here)", () => {
    expect(classifyVerification("abandoned", 2 * MIN)).toEqual({ kind: "pending" });
    expect(classifyVerification("failed", 2 * MIN)).toEqual({ kind: "pending" });
  });
  it("only past the 30-minute grace does abandoned become a (still recoverable) failure", () => {
    expect(SUB_ABANDON_GRACE_MS).toBeGreaterThanOrEqual(30 * MIN);
    expect(classifyVerification("abandoned", 29 * MIN).kind).toBe("pending");
    expect(classifyVerification("abandoned", 31 * MIN)).toEqual({ kind: "fail", source: "verify_abandoned" });
    expect(classifyVerification("failed", 31 * MIN)).toEqual({ kind: "fail", source: "verify_failed" });
  });
  it("success settles, a reversal is final at once, anything else waits", () => {
    expect(classifyVerification("success", 0)).toEqual({ kind: "settle" });
    expect(classifyVerification("reversed", 0)).toEqual({ kind: "fail", source: "provider_reversed" });
    for (const s of ["ongoing", "pending", "processing", "queued", undefined, null, "weird"]) expect(classifyVerification(s, 10 * 60 * MIN).kind).toBe("pending");
    expect(classifyVerification("abandoned", Number.NaN).kind).toBe("pending");
  });
});

describe("upload check — the bytes, not the browser's word", () => {
  const bytes = (...xs: (number | string)[]) => {
    const out: number[] = [];
    for (const x of xs) {
      if (typeof x === "number") out.push(x);
      else out.push(...x.split("").map((c) => c.charCodeAt(0)));
    }
    while (out.length < 32) out.push(0);
    return new Uint8Array(out);
  };
  const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
  const PNG = bytes(0x89, "PNG", 0x0d, 0x0a);
  const MP4 = bytes(0, 0, 0, 0x20, "ftypisom");
  const MOV = bytes(0, 0, 0, 0x14, "ftypqt  ");
  const OLD_MOV = bytes(0, 0, 0, 0x08, "wide");
  const WEBM = bytes(0x1a, 0x45, 0xdf, 0xa3);
  const HTML = bytes("<!doctype html><script>");
  const SVG = bytes("<svg xmlns=");
  const EXE = bytes("MZ");

  it("recognises real photos and videos", () => {
    expect(sniffMedia(JPEG)).toBe("image");
    expect(sniffMedia(PNG)).toBe("image");
    expect(sniffMedia(bytes("RIFF", 0, 0, 0, 0, "WEBP"))).toBe("image");
    expect(sniffMedia(bytes(0, 0, 0, 0x1c, "ftypavif"))).toBe("image");
    for (const v of [MP4, MOV, OLD_MOV, WEBM]) expect(sniffMedia(v)).toBe("video");
  });
  it("refuses HTML, SVG and executables wearing a media name", () => {
    for (const x of [HTML, SVG, EXE]) {
      expect(sniffMedia(x)).toBeNull();
      expect(checkUpload("image", { prefix: x, size: 100 }).ok).toBe(false);
    }
  });
  it("refuses a kind mismatch, a missing file and an oversized one", () => {
    expect(checkUpload("image", { prefix: MP4, size: 100 }).ok).toBe(false);
    expect(checkUpload("video", { prefix: JPEG, size: 100 }).ok).toBe(false);
    expect(checkUpload("image", null).ok).toBe(false);
    expect(checkUpload("image", { prefix: JPEG, size: SUB_MAX_IMAGE_BYTES + 1 }).ok).toBe(false);
    expect(checkUpload("image", { prefix: JPEG, size: Number.NaN }).ok).toBe(false);
    expect(checkUpload("image", { prefix: JPEG, size: 2_000_000 }).ok).toBe(true);
    expect(checkUpload("video", { prefix: MOV, size: 200_000_000 }).ok).toBe(true);
  });
});
