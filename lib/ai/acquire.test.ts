import { describe, expect, it } from "vitest";

import { AI_ERRORS } from "@/lib/ai/errors";
import {
  AI_ACTIVE_STATUSES,
  AI_JOB_STATUSES,
  canTransition,
  createJobRequestSchema,
  isActiveStatus,
  validateJobInput,
  aiFeature,
  type AiJobStatus,
} from "@/lib/ai/jobs";
import { AI_STALL_DEADLINE_MS } from "@/lib/ai/stall";

/**
 * Part 6's own guarantees, as tests rather than as comments.
 *
 * The two that matter most are the ones a future edit could break silently: a
 * `url` source that carries a fabricated size, and an `acquiring` job that can
 * reach `completed` without the provider ever running.
 */

const feature = aiFeature("ai_clean")!;

describe("the acquiring status", () => {
  it("is a real status the database can hold", () => {
    expect(AI_JOB_STATUSES).toContain("acquiring");
  });

  it("counts as still-running, so polling and the stall guard both see it", () => {
    expect(isActiveStatus("acquiring")).toBe(true);
    expect(AI_ACTIVE_STATUSES).toContain("acquiring");
  });

  it("has a stall deadline — an acquisition that dies must not hang forever", () => {
    expect(AI_STALL_DEADLINE_MS.acquiring).toBeGreaterThan(0);
  });

  /*
    🔴 THE ONE THAT PROTECTS THE MONEY AND THE PICTURE.

    `acquiring` means our worker has the video and the provider has NOT been
    asked for anything. If it could reach `finalizing` or `completed`, a future
    edit could hand somebody back their own untouched video and call it cleaned
    — the same class of mistake as the Part 4 rule that `processing` may not
    reach `completed` directly.
  */
  it("can only move forward to processing", () => {
    expect(canTransition("acquiring", "processing")).toBe(true);
    expect(canTransition("acquiring", "finalizing")).toBe(false);
    expect(canTransition("acquiring", "completed")).toBe(false);
  });

  it("can still fail, be cancelled and expire", () => {
    for (const to of ["failed", "cancelled", "expired"] as AiJobStatus[]) {
      expect(canTransition("acquiring", to), to).toBe(true);
    }
  });

  it("is reachable from queued, and from nowhere else", () => {
    expect(canTransition("queued", "acquiring")).toBe(true);
    for (const from of ["processing", "finalizing", "completed", "failed", "cancelled", "expired"] as AiJobStatus[]) {
      expect(canTransition(from, "acquiring"), from).toBe(false);
    }
  });
});

describe("the create body for a link", () => {
  const base = { feature: "ai_clean", clientRequestId: "9f2c1b8e4a7d4f0e" };

  it("accepts a url source with no size and no mimeType", () => {
    const parsed = createJobRequestSchema.safeParse({
      ...base,
      source: { kind: "url", url: "https://vm.tiktok.com/ZMabcdef/" },
    });
    expect(parsed.success).toBe(true);
  });

  /*
    🔴 A LINK MAY NOT CARRY MEASUREMENTS.

    Those two fields are what the upload path's ceilings are checked against.
    A body that sets them on a link is either a confused client or somebody
    hoping one of the two paths reads them — and the real numbers cannot exist
    yet, because nothing has been fetched. Refused rather than ignored.
  */
  it("REFUSES a url source that also claims a size or a mimeType", () => {
    for (const extra of [{ size: 1024 }, { mimeType: "video/mp4" }, { size: 1, mimeType: "video/mp4" }]) {
      const parsed = createJobRequestSchema.safeParse({
        ...base,
        source: { kind: "url", url: "https://vm.tiktok.com/ZMabcdef/", ...extra },
      });
      expect(parsed.success, JSON.stringify(extra)).toBe(false);
    }
  });

  it("REFUSES a url source with no url", () => {
    expect(createJobRequestSchema.safeParse({ ...base, source: { kind: "url" } }).success).toBe(false);
  });

  it("REFUSES an upload that carries a url", () => {
    const parsed = createJobRequestSchema.safeParse({
      ...base,
      source: { kind: "upload", size: 1024, mimeType: "video/mp4", url: "https://tiktok.com/x" },
    });
    expect(parsed.success).toBe(false);
  });

  /*
    🔴 BACKWARDS COMPATIBILITY. Every client shipped before Part 6 sends a body
    with no `kind` at all, and the schema is `.strict()` — so if `kind` were
    required, the upload flow would break on every browser holding an older
    bundle the moment this deployed.
  */
  it("still accepts a Part-3-era upload body with no kind", () => {
    const parsed = createJobRequestSchema.safeParse({
      ...base,
      source: { size: 1024, mimeType: "video/mp4", name: "clip.mp4" },
    });
    expect(parsed.success).toBe(true);
  });

  it("still refuses the fields a client may never send", () => {
    for (const field of ["user_id", "provider", "status", "result_path", "source_kind", "source_url"]) {
      const parsed = createJobRequestSchema.safeParse({
        ...base,
        source: { kind: "url", url: "https://tiktok.com/@a/video/1", [field]: "x" },
      });
      expect(parsed.success, field).toBe(false);
    }
  });
});

describe("validateJobInput for a link", () => {
  it("passes a url source through without inventing measurements", () => {
    expect(validateJobInput(feature, { kind: "url", url: "https://tiktok.com/@a/video/1" })).toEqual({ ok: true });
  });

  it("refuses a url source with an empty url", () => {
    expect(validateJobInput(feature, { kind: "url", url: "   " })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });

  it("still enforces every upload ceiling", () => {
    expect(validateJobInput(feature, { size: 0, mimeType: "video/mp4" }).ok).toBe(false);
    expect(validateJobInput(feature, { size: feature.maxBytes + 1, mimeType: "video/mp4" })).toEqual({
      ok: false,
      code: "FILE_TOO_LARGE",
    });
    expect(validateJobInput(feature, { size: 10, mimeType: "application/pdf" })).toEqual({
      ok: false,
      code: "UNSUPPORTED_FORMAT",
    });
  });
});

describe("the new failure codes", () => {
  it("say something useful and leak nothing internal", () => {
    for (const code of ["ACQUISITION_FAILED", "UNSUPPORTED_SOURCE"] as const) {
      const spec = AI_ERRORS[code];
      expect(spec.message.length, code).toBeGreaterThan(10);
      // No hostnames, no paths, no provider names, no status codes.
      expect(spec.message, code).not.toMatch(/http|yt-dlp|replicate|worker|supabase|\/api\//i);
    }
  });

  /*
    422, not 500. The request was fine and our side did not break — the video at
    the other end could not be collected, which is a different thing and should
    not read as an outage to anything watching status codes.
  */
  it("answer 422, because nothing on our side failed", () => {
    expect(AI_ERRORS.ACQUISITION_FAILED.status).toBe(422);
    expect(AI_ERRORS.UNSUPPORTED_SOURCE.status).toBe(422);
  });
});
