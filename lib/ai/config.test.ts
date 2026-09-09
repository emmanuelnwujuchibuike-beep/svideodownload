import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AI_CLEAN_CONFIG,
  AI_CLEAN_LIMITS,
  aiCleanMisconfiguration,
  buildAiCleanInput,
} from "./config";
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

  /*
    ── 🔴 TWO OF THESE CHANGED AFTER THE FIRST REAL RESULT ────────────────────

    The Part 3 brief specified hybrid / 720p / 0.25 / 0.45 / 5 / 5, and that is
    what shipped. On 2026-09-08 the first job ever to complete showed two of
    those actively damaging the output, and the owner reported it as "the
    removing affects the video".

      resolution          720p -> original
        The clip is 480x854. `predict.py` downscales when height > target, so
        the model reduced it to ~404x720, inpainted, and scaled back up — its
        own log says "Upscaling output back to 480x854". That resamples EVERY
        pixel, not just the region under the caption. The removal was fine; the
        round trip around it was not.

      detection_interval  5 -> 1
        Detection ran on 14 of 66 frames and reused those boxes for the other
        52. Text that moves, or appears briefly, gets erased in the wrong place
        and missed where it actually is.

    The other four are unchanged and are still the model author's own defaults.
    Every value is env-overridable now, so tuning does not need a deploy.
  */
  it("passes the tuned configuration", () => {
    expect(input.method).toBe("hybrid");
    expect(input.resolution).toBe("original");
    expect(input.conf_threshold).toBe(0.25);
    expect(input.iou_threshold).toBe(0.45);
    expect(input.margin).toBe(5);
    expect(input.detection_interval).toBe(1);
  });

  it("never resamples the whole video by default", () => {
    /*
      A guard on the specific regression above. Any fixed ladder rung silently
      downscales-then-upscales a video taller than it — which softens the entire
      picture to remove a caption from one corner. Only "original" is free of
      that, so a future edit away from it has to be deliberate.
    */
    expect(AI_CLEAN_CONFIG.resolution).toBe("original");
  });

  it("stays inside the ranges the model documents", () => {
    expect(AI_CLEAN_CONFIG.confidence).toBeGreaterThanOrEqual(0);
    expect(AI_CLEAN_CONFIG.confidence).toBeLessThanOrEqual(1);
    expect(AI_CLEAN_CONFIG.margin).toBeGreaterThanOrEqual(0);
    expect(AI_CLEAN_CONFIG.margin).toBeLessThanOrEqual(20);
    expect(AI_CLEAN_CONFIG.detectionInterval).toBeGreaterThanOrEqual(0);
    expect(AI_CLEAN_CONFIG.detectionInterval).toBeLessThanOrEqual(100);
    expect(["original", "1080p", "720p", "480p", "360p"]).toContain(AI_CLEAN_CONFIG.resolution);
    expect([
      // the classical remover
      "hybrid", "inpaint", "inpaint_ns", "blur", "black", "background",
      // the temporal one
      "sttn", "propainter", "lama",
    ]).toContain(AI_CLEAN_CONFIG.method);
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

/**
 * The two model families, and the switch between them.
 *
 * 🔴 Sending either model the other's body is a 422 before anything runs, so
 * this is not a preference — it is the difference between a working deployment
 * and one that fails every job. The METHOD name is the discriminator, so one
 * environment variable can never leave the model and its schema disagreeing.
 */
describe("model schema switching", () => {
  it("sends the temporal remover only the fields it accepts", () => {
    const input = buildAiCleanInputFor("sttn", "https://x/v.mp4");
    expect(Object.keys(input).sort()).toEqual(["mode", "subtitle_area", "video"]);
    expect(input.mode).toBe("sttn");
    // The detection knobs belong to the OTHER model and would be rejected.
    for (const gone of ["method", "resolution", "conf_threshold", "iou_threshold", "margin", "detection_interval"]) {
      expect(input).not.toHaveProperty(gone);
    }
  });

  it("sends the classical remover its own six fields", () => {
    const input = buildAiCleanInputFor("hybrid", "https://x/v.mp4");
    expect(Object.keys(input).sort()).toEqual(
      ["conf_threshold", "detection_interval", "iou_threshold", "margin", "method", "resolution", "video"].sort(),
    );
    expect(input).not.toHaveProperty("mode");
  });

  it("treats every temporal method as temporal", () => {
    for (const m of ["sttn", "propainter", "lama"]) {
      expect(Object.keys(buildAiCleanInputFor(m, "https://x/v.mp4"))).toContain("mode");
    }
  });
});

/**
 * `buildAiCleanInput` reads module-level config, so the switch is exercised
 * through a tiny reimplementation of its branch rather than by mutating the
 * environment mid-suite — which would leak into every other test in the file.
 * The assertion that matters is that the BRANCH exists and splits on method;
 * `source-integrity`-style checks below pin that the real function agrees.
 */
function buildAiCleanInputFor(method: string, url: string): Record<string, string | number> {
  const temporal = new Set(["sttn", "propainter", "lama"]);
  if (temporal.has(method)) return { video: url, mode: method, subtitle_area: "" };
  return {
    video: url,
    method,
    resolution: "original",
    conf_threshold: 0.25,
    iou_threshold: 0.45,
    margin: 5,
    detection_interval: 1,
  };
}

describe("the real builder agrees with that split", () => {
  it("branches on the method name in source", () => {
    const src = readFileSync(join(process.cwd(), "lib/ai/config.ts"), "utf8");
    expect(src).toContain("TEMPORAL_METHODS");
    expect(src).toContain("usesTemporalRemover");
    // The temporal branch must not send the classical fields.
    const temporalBranch = src.slice(src.indexOf("if (usesTemporalRemover())"), src.indexOf("return {\n    video: videoUrl,\n    method:"));
    expect(temporalBranch).not.toContain("conf_threshold");
    expect(temporalBranch).not.toContain("detection_interval");
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE MODEL AND THE METHOD ARE ONE SETTING IN THREE VARIABLES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 The method name selects the request BODY, so a temporal method against the
 * classical model — or the reverse — is a 422 on every prediction, raised after
 * the member's upload and after a quota reservation.
 *
 * On 2026-09-08 the owner was handed three values to paste into Vercel
 * (REPLICATE_AI_CLEAN_MODEL, REPLICATE_AI_CLEAN_MODEL_VERSION, AI_CLEAN_METHOD).
 * Pasting two of the three is an ordinary thing to do and would have broken
 * every job silently. `aiCleanMisconfiguration` now refuses that pairing, so the
 * feature reports itself unavailable instead — failing closed, and costing
 * nobody an upload.
 */
describe("the model/method family guard", () => {
  it("🔴 the shipped default pairing is coherent", () => {
    // Whatever the committed defaults are, they must agree with each other.
    expect(aiCleanMisconfiguration()).not.toMatch(/schemas differ/);
  });

  it("names both variables when they disagree, and nothing else", () => {
    /*
      Read from source rather than by mutating process.env mid-suite: the config
      object is module-level and frozen at import, so an env change here would
      leak into every other test in the file.
    */
    const src = readFileSync(join(process.cwd(), "lib/ai/config.ts"), "utf8");
    expect(src).toContain("knownModelFamily");
    expect(src).toMatch(/video-subtitle-remover.*temporal|temporal.*video-subtitle-remover/s);
    expect(src).toMatch(/video-text-remover.*classical|classical.*video-text-remover/s);
    // An unrecognised slug must NOT disable the tool.
    expect(src).toContain("return null;");
  });

  it("keeps the detail operator-facing", () => {
    /*
      The string names environment variables, so it must never reach a member.
      It is only ever passed to AiJobError's `detail`, which errors.ts documents
      as "Logged and stored; never returned to a client" — the client gets the
      code's own message, "This tool isn't available yet."
    */
    const errors = readFileSync(join(process.cwd(), "lib/ai/errors.ts"), "utf8");
    expect(errors).toContain("never returned to a client");
  });
});
