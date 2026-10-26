import { describe, expect, it } from "vitest";

import { isOwnUpload, parseUploadUrl } from "./owned-media";

/*
  Stories Part 1 (2026-10-26, audit S3): a story's media must be the member's OWN upload.
  The shapes below are the ones read off every story row on production that day.
*/
const R2 = "https://media.frenzsave.com";
const SB = "https://abc.supabase.co";
const bases = { r2PublicBase: R2, supabaseUrl: SB };
const ME = "0b6c2f1e-1d2c-4a8b-9c3d-1234567890ab";
const THEM = "9f8e7d6c-5b4a-4c3d-8e2f-ba0987654321";

describe("parseUploadUrl — the real key shapes", () => {
  it.each([
    [`${R2}/${ME}/images/1792999483123-k3j9x2.jpg`, "images"],
    [`${R2}/${ME}/videos/1792999483123-k3j9x2.mp4`, "videos"],
    [`${R2}/${ME}/images/1792999483123-k3j9x2-poster.jpg`, "images"],
    [`${R2}/${ME}/images/1792999483123.jpg`, "images"],
    [`${R2}/post-media/${ME}/videos/1782768190594-ab12cd.mp4`, "videos"],
    [`${R2}/post-media/${ME}/stories/1782768190594.mp4`, "stories"],
    [`${SB}/storage/v1/object/public/post-media/${ME}/images/1792999483123-k3j9x2.png`, "images"],
  ])("%s", (url, folder) => {
    const up = parseUploadUrl(url, bases);
    expect(up?.ownerId).toBe(ME);
    expect(up?.folder).toBe(folder);
  });

  it("the R2 key keeps its legacy prefix, so the right object is deleted", () => {
    expect(parseUploadUrl(`${R2}/post-media/${ME}/videos/1782768190594-ab12cd.mp4`, bases)?.key).toBe(`post-media/${ME}/videos/1782768190594-ab12cd.mp4`);
    expect(parseUploadUrl(`${SB}/storage/v1/object/public/post-media/${ME}/images/1792999483123.png`, bases)).toMatchObject({ backend: "supabase", key: `${ME}/images/1792999483123.png` });
  });
});

describe("parseUploadUrl — everything else is NOT our upload", () => {
  it.each([
    ["another site", `https://evil.example/${ME}/images/1792999483123-k3j9x2.jpg`],
    ["a lookalike host", `https://media.frenzsave.com.evil.example/${ME}/images/1792999483123-k3j9x2.jpg`],
    ["http", `http://media.frenzsave.com/${ME}/images/1792999483123-k3j9x2.jpg`],
    ["a query string (tracking)", `${R2}/${ME}/images/1792999483123-k3j9x2.jpg?u=1`],
    ["a fragment", `${R2}/${ME}/images/1792999483123-k3j9x2.jpg#x`],
    ["no owner id (old covers)", `${R2}/post-media/images/1782768190594-poster.jpg`],
    ["a traversal", `${R2}/${ME}/images/../../${THEM}/images/1792999483123.jpg`],
    ["an encoded traversal", `${R2}/${ME}%2F..%2F${THEM}/images/1792999483123.jpg`],
    ["an audio upload", `${R2}/${ME}/audios/1792999483123-k3j9x2.m4a`],
    ["a document", `${R2}/${ME}/documents/1792999483123-k3j9x2.pdf`],
    ["an AI result path", `${R2}/ai-results/${ME}/1792999483123.mp4`],
    ["the Supabase avatars bucket", `${SB}/storage/v1/object/public/avatars/${ME}/images/1792999483123.jpg`],
    ["credentials in the URL", `https://user:pw@media.frenzsave.com/${ME}/images/1792999483123-k3j9x2.jpg`],
    ["not a URL", "javascript:alert(1)"],
    ["empty", ""],
  ])("%s", (_label, url) => {
    expect(parseUploadUrl(url, bases)).toBeNull();
  });

  it("nothing parses when the deployment has no storage bases", () => {
    expect(parseUploadUrl(`${R2}/${ME}/images/1792999483123-k3j9x2.jpg`, {})).toBeNull();
  });
});

describe("isOwnUpload — whose, and what kind", () => {
  const img = `${R2}/${ME}/images/1792999483123-k3j9x2.jpg`;
  const vid = `${R2}/${ME}/videos/1792999483123-k3j9x2.mp4`;
  it("the uploader's own photo and video", () => {
    expect(isOwnUpload(img, ME, "image", bases)).toBe(true);
    expect(isOwnUpload(vid, ME, "video", bases)).toBe(true);
    expect(isOwnUpload(img, ME.toUpperCase(), "image", bases)).toBe(true);
  });
  it("🔴 never another member's file", () => {
    expect(isOwnUpload(img, THEM, "image", bases)).toBe(false);
  });
  it("🔴 never the wrong kind (a video posing as a photo, and back)", () => {
    expect(isOwnUpload(img, ME, "video", bases)).toBe(false);
    expect(isOwnUpload(vid, ME, "image", bases)).toBe(false);
  });
  it("never the retired stories/ folder for a NEW story", () => {
    expect(isOwnUpload(`${R2}/post-media/${ME}/stories/1782768190594.mp4`, ME, "video", bases)).toBe(false);
  });
});
