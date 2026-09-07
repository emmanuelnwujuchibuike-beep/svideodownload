import { describe, expect, it } from "vitest";

import {
  AI_RESULT_BUCKET,
  AI_SIGNED_URL_TTL_SECONDS,
  AI_SOURCE_BUCKET,
  aiResultKey,
  aiSourceKey,
  pathBelongsTo,
} from "./storage";

const USER = "9f2c1b8e-4a7d-4f0e-9c3b-1a2d5e6f7a8b";
const JOB = "11111111-2222-3333-4444-555555555555";

describe("object keys", () => {
  it("put the owner first, so a bucket policy can be written against the prefix", () => {
    // storage.foldername(name)[1] = auth.uid()::text is the standard Supabase
    // shape. A key that buries the owner cannot be secured that way later
    // without rewriting every path already stored.
    expect(aiSourceKey(USER, "ai_clean", JOB, "mp4").startsWith(`${USER}/`)).toBe(true);
    expect(aiResultKey(USER, "ai_clean", JOB, "mp4").startsWith(`${USER}/`)).toBe(true);
  });

  it("name the role, so source and result can never collide", () => {
    expect(aiSourceKey(USER, "ai_clean", JOB, "mp4")).toBe(`${USER}/aiclean/${JOB}/source.mp4`);
    expect(aiResultKey(USER, "ai_clean", JOB, "mp4")).toBe(`${USER}/aiclean/${JOB}/result.mp4`);
  });

  it("🔴 cannot be talked out of their own directory", () => {
    // Every segment is sanitised, so a hostile id cannot climb out of the
    // owner's prefix and write over somebody else's object.
    const key = aiSourceKey("../../admin", "ai_clean", "../root", "../../sh");
    expect(key).not.toContain("..");
    expect(key).not.toContain("//");
    expect(key.split("/")).toHaveLength(4);
  });

  it("always ends in a usable extension", () => {
    expect(aiSourceKey(USER, "ai_clean", JOB, "")).toMatch(/\.bin$/);
    expect(aiSourceKey(USER, "ai_clean", JOB, ".MP4")).toMatch(/\.mp4$/);
  });
});

describe("pathBelongsTo", () => {
  it("accepts a path this job really produced", () => {
    expect(pathBelongsTo(aiResultKey(USER, "ai_clean", JOB, "mp4"), USER, JOB)).toBe(true);
  });

  it("🔴 refuses another member's object, and another job's", () => {
    // The check that has to hold before anything mints a signed URL: a signed
    // URL is authority over an object, and the request asking for one arrives
    // carrying an id.
    const other = "00000000-0000-0000-0000-000000000000";
    expect(pathBelongsTo(aiResultKey(other, "ai_clean", JOB, "mp4"), USER, JOB)).toBe(false);
    expect(pathBelongsTo(aiResultKey(USER, "ai_clean", other, "mp4"), USER, JOB)).toBe(false);
  });

  it("refuses traversal and absolute paths outright", () => {
    expect(pathBelongsTo(`${USER}/aiclean/${JOB}/../../../etc/passwd`, USER, JOB)).toBe(false);
    expect(pathBelongsTo(`/${USER}/aiclean/${JOB}/result.mp4`, USER, JOB)).toBe(false);
    expect(pathBelongsTo("", USER, JOB)).toBe(false);
    expect(pathBelongsTo(`${USER}/${JOB}/result.mp4`, USER, JOB)).toBe(false);
  });
});

describe("the buckets", () => {
  it("are two, and separate", () => {
    expect(AI_SOURCE_BUCKET).not.toBe(AI_RESULT_BUCKET);
  });

  it("hand out links that expire in minutes, not hours", () => {
    expect(AI_SIGNED_URL_TTL_SECONDS).toBeGreaterThan(60);
    expect(AI_SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(15 * 60);
  });
});
