import { describe, expect, it } from "vitest";

import { AI_CLEAN_CONFIG, AI_CLEAN_LIMITS, buildAiCleanInput } from "./config";
import { AI_CLEAN_FORMATS, AI_CLEAN_MAX_BYTES } from "./clean-media";

/**
 * The one configuration object.
 *
 * These tests are not about behaviour — the object is a constant. They are
 * about the two ways a constant like this goes wrong silently: a version that
 * stops being pinned, and a parameter renamed to something the model does not
 * accept. Both would ship, deploy, and only be discovered by a member.
 */

describe("the pinned model", () => {
  it("🔴 names a real, fully-specified version — never a floating reference", () => {
    // A short hash, a tag, or an empty string would each mean "whatever is
    // current", which is exactly what pinning exists to prevent.
    expect(AI_CLEAN_CONFIG.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the version read from the model's Versions page", () => {
    // Pinned in committed code, so the model that ran is recorded in git beside
    // the code that called it. Changing this is a deliberate, reviewable act.
    expect(AI_CLEAN_CONFIG.version).toBe(
      "247c8385f3c6c322110a6787bd2d257acc3a3d60b9ed7da1726a628f72a42c4d",
    );
  });

  it("names the owner's model and provider", () => {
    expect(AI_CLEAN_CONFIG.model).toBe("hjunior29/video-text-remover");
    expect(AI_CLEAN_CONFIG.provider).toBe("replicate");
  });
});

describe("buildAiCleanInput", () => {
  const input = buildAiCleanInput("https://example.com/source.mp4");

  it("🔴 uses the field names from the model's published schema", () => {
    // Checked against the model page, not guessed. A renamed field is silently
    // ignored by the provider, which shows up as a job that ran with the
    // model's defaults instead of ours — and nothing anywhere reports it.
    expect(Object.keys(input).sort()).toEqual(
      ["conf_threshold", "detection_interval", "iou_threshold", "margin", "method", "resolution", "video"].sort(),
    );
  });

  it("passes the owner's specified configuration", () => {
    expect(input.method).toBe("hybrid");
    expect(input.resolution).toBe("720p");
    expect(input.conf_threshold).toBe(0.25);
    expect(input.iou_threshold).toBe(0.45);
    expect(input.margin).toBe(5);
    expect(input.detection_interval).toBe(5);
  });

  it("stays inside the ranges the model documents", () => {
    expect(AI_CLEAN_CONFIG.confidence).toBeGreaterThanOrEqual(0);
    expect(AI_CLEAN_CONFIG.confidence).toBeLessThanOrEqual(1);
    expect(AI_CLEAN_CONFIG.margin).toBeGreaterThanOrEqual(0);
    expect(AI_CLEAN_CONFIG.margin).toBeLessThanOrEqual(20);
    expect(AI_CLEAN_CONFIG.detectionInterval).toBeGreaterThanOrEqual(0);
    expect(AI_CLEAN_CONFIG.detectionInterval).toBeLessThanOrEqual(100);
    expect(["original", "1080p", "720p", "480p", "360p"]).toContain(AI_CLEAN_CONFIG.resolution);
    expect(["hybrid", "inpaint", "inpaint_ns", "blur", "black", "background"]).toContain(AI_CLEAN_CONFIG.method);
  });

  it("carries the video URL it was given, and nothing else about it", () => {
    expect(input.video).toBe("https://example.com/source.mp4");
  });
});

describe("the limits", () => {
  it("default to exactly what the interface already enforces", () => {
    // With nothing configured the picker and the server agree, so a file the
    // browser accepted can never be refused for a rule it did not know about.
    expect(AI_CLEAN_LIMITS.maxFileSize).toBe(AI_CLEAN_MAX_BYTES);
    for (const mime of AI_CLEAN_FORMATS.flatMap((f) => f.mimeTypes)) {
      expect(AI_CLEAN_LIMITS.allowedMimeTypes, mime).toContain(mime);
    }
  });

  it("cap the duration and the result, because both are costs", () => {
    expect(AI_CLEAN_LIMITS.maxDuration).toBeGreaterThan(0);
    // A result ceiling is a memory guard: the webhook buffers the file to store
    // it, so an unbounded output is an out-of-memory crash that then retries.
    expect(AI_CLEAN_LIMITS.maxResultSize).toBeGreaterThan(AI_CLEAN_LIMITS.maxFileSize);
  });
});
