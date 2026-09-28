import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { KLING_OMNI, KLING_OMNI_MODEL_NAME, klingElementRef, klingOmniImageBudget, klingVideoRef } from "./capabilities";
import { klingFullCharacter, defaultFullCharacterPrompt } from "./full-character";
import { klingImageToVideo } from "./image-to-video";
import { klingReferenceImage } from "./reference-image";
import { klingReferenceVideo } from "./reference-video";
import { KLING_IMPLEMENTED_FEATURE_IDS, KLING_UNAVAILABLE_FEATURES, klingCapabilityReport, klingFeatureGate, klingValidateBeforeBilling } from "./registry";
import { klingTextToVideo } from "./text-to-video";
import { KLING_FEATURE_IDS } from "./types";
import { KLING_O1_EDIT_LIMITS } from "../../character-replace/providers/kling-input";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const VIDEO = "https://storage.test/prepared.mp4";
const PHOTO = "https://storage.test/prepared-1.jpg";
const PHOTO2 = "https://storage.test/prepared-2.jpg";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE KLING 3.0 OMNI FEATURE HANDLERS (Part 3, 2026-09-28) — pinned
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every handler's validation and request body is pure, so all of it is
 * provable here without a key, a network or a database. What is NOT claimed:
 * that a real Kling account accepts these bodies. No credential exists on
 * this deployment and no live request has been made — Part 4's first task.
 *
 * Each guard has a case that fails on a bad fixture.
 */

describe("Omni capabilities — verified from Kling's own model guide, NOT inherited from O1", () => {
  it("🔴 the Omni limits are NOT the fal-era O1 limits — three differences that would each be a bug", () => {
    // O1 Video Edit tops out at ~10s; Omni makes 15
    expect(KLING_O1_EDIT_LIMITS.maxDurationSecondsForMembers).toBe(10);
    expect(KLING_OMNI.duration.maxSeconds).toBe(15);
    expect(KLING_OMNI.duration.maxSeconds).toBeGreaterThan(KLING_O1_EDIT_LIMITS.maxDurationSecondsForMembers);
    // O1 allows 4 references always; Omni allows 7 when there is no video
    expect(KLING_O1_EDIT_LIMITS.maxElementsAndImages).toBe(4);
    expect(KLING_OMNI.images.withoutVideo.max).toBe(7);
    // O1 imposes a 720px minimum edge on the INPUT; Omni expresses quality as a mode instead
    expect(KLING_O1_EDIT_LIMITS.minEdgePx).toBe(720);
    expect(KLING_OMNI.modes).toEqual(["std", "pro", "4k"]);
  });

  it("🔴 the two limit tables never import each other", () => {
    const omni = code("lib/ai/kling/features/capabilities.ts");
    expect(omni).not.toContain("kling-input");
    expect(omni).not.toContain("KLING_O1_EDIT_LIMITS");
    expect(code("lib/ai/character-replace/providers/kling-input.ts")).not.toContain("lib/ai/kling/");
  });

  it("the image budget depends on the video AND the elements — the rule an O1-shaped validator gets wrong", () => {
    expect(klingOmniImageBudget({ hasVideo: false, elementCount: 0 })).toBe(7);
    expect(klingOmniImageBudget({ hasVideo: true, elementCount: 0 })).toBe(4);
    expect(klingOmniImageBudget({ hasVideo: true, elementCount: 1 })).toBe(3);
    expect(klingOmniImageBudget({ hasVideo: true, elementCount: 9 })).toBe(0);
  });

  it("🔴 the reference VIDEO window is not the OUTPUT window — conflating them is the trap", () => {
    expect(KLING_OMNI.video.maxSeconds).toBe(10);
    expect(KLING_OMNI.duration.maxSeconds).toBe(15);
  });

  it("the prompt reference tokens are 1-based, matching the vendor's own syntax", () => {
    expect(klingElementRef(1)).toBe("<<<element_1>>>");
    expect(klingVideoRef(1)).toBe("<<<video_1>>>");
    expect(klingElementRef(3)).toBe("<<<element_3>>>");
  });
});

describe("Text to Video", () => {
  it("accepts a prompt and builds a single-shot request", () => {
    const input = { prompt: "a fox in snow", options: { durationSeconds: 8, mode: "pro" as const, aspectRatio: "9:16" as const } };
    expect(klingTextToVideo.validate(input)).toEqual({ ok: true });
    expect(klingTextToVideo.buildRequest(input)).toEqual({
      model_name: KLING_OMNI_MODEL_NAME,
      multi_shot: false,
      prompt: "a fox in snow",
      duration: "8",
      mode: "pro",
      aspect_ratio: "9:16",
    });
  });

  it("builds a multi-shot request with a 1-based index per shot, and drops the whole-video duration", () => {
    const input = { shots: [{ prompt: "wide", durationSeconds: 3 }, { prompt: "close", durationSeconds: 4 }], options: { durationSeconds: 7 } };
    expect(klingTextToVideo.validate(input)).toEqual({ ok: true });
    const body = klingTextToVideo.buildRequest(input);
    expect(body.multi_shot).toBe(true);
    expect(body.shot_type).toBe("customize");
    expect(body.multi_prompt).toEqual([{ index: 1, prompt: "wide", duration: "3" }, { index: 2, prompt: "close", duration: "4" }]);
    expect(body).not.toHaveProperty("duration");
    expect(body).not.toHaveProperty("prompt");
  });

  it("🔴 refuses nothing, both at once, an over-long prompt, too many shots and shots past the ceiling", () => {
    expect(klingTextToVideo.validate({}).ok).toBe(false);
    expect(klingTextToVideo.validate({ prompt: "a", shots: [{ prompt: "b" }] }).ok).toBe(false);
    expect(klingTextToVideo.validate({ prompt: "x".repeat(KLING_OMNI.prompt.maxChars + 1) }).ok).toBe(false);
    expect(klingTextToVideo.validate({ shots: Array.from({ length: 7 }, () => ({ prompt: "s" })) }).ok).toBe(false);
    expect(klingTextToVideo.validate({ shots: [{ prompt: "a", durationSeconds: 10 }, { prompt: "b", durationSeconds: 9 }] }).ok).toBe(false);
  });

  it("🔴 refuses a duration outside the model's window, and an invented mode or ratio", () => {
    expect(klingTextToVideo.validate({ prompt: "x", options: { durationSeconds: 2 } }).ok).toBe(false);
    expect(klingTextToVideo.validate({ prompt: "x", options: { durationSeconds: 16 } }).ok).toBe(false);
    expect(klingTextToVideo.validate({ prompt: "x", options: { durationSeconds: 5.5 } }).ok).toBe(false);
    expect(klingTextToVideo.validate({ prompt: "x", options: { mode: "ultra" as never } }).ok).toBe(false);
    expect(klingTextToVideo.validate({ prompt: "x", options: { aspectRatio: "4:3" as never } }).ok).toBe(false);
    // ...and accepts the edges
    expect(klingTextToVideo.validate({ prompt: "x", options: { durationSeconds: 3 } }).ok).toBe(true);
    expect(klingTextToVideo.validate({ prompt: "x", options: { durationSeconds: 15 } }).ok).toBe(true);
  });

  it("an omitted option is OMITTED, never silently defaulted", () => {
    expect(klingTextToVideo.buildRequest({ prompt: "x" })).toEqual({ model_name: KLING_OMNI_MODEL_NAME, multi_shot: false, prompt: "x" });
  });
});

describe("Image to Video — a picture that BECOMES the clip", () => {
  it("sends the image as a frame, with its type", () => {
    const body = klingImageToVideo.buildRequest({ firstFrameUrl: PHOTO, endFrameUrl: PHOTO2, prompt: "she turns" });
    expect(body.image_list).toEqual([{ image: PHOTO, type: "first_frame" }, { image: PHOTO2, type: "end_frame" }]);
    expect(body.prompt).toBe("she turns");
  });

  it("the prompt is optional — two frames are already an instruction", () => {
    expect(klingImageToVideo.validate({ firstFrameUrl: PHOTO }).ok).toBe(true);
    expect(klingImageToVideo.buildRequest({ firstFrameUrl: PHOTO })).not.toHaveProperty("prompt");
  });

  it("🔴 refuses a missing image, a non-https URL and a private address", () => {
    expect(klingImageToVideo.validate({ firstFrameUrl: "" }).ok).toBe(false);
    expect(klingImageToVideo.validate({ firstFrameUrl: "http://storage.test/a.jpg" }).ok).toBe(false);
    expect(klingImageToVideo.validate({ firstFrameUrl: "https://169.254.169.254/latest/meta-data" }).ok).toBe(false);
    expect(klingImageToVideo.validate({ firstFrameUrl: "https://localhost/a.jpg" }).ok).toBe(false);
  });

  it("🔴 is a DIFFERENT request from reference-image — frames carry `type`, references do not", () => {
    const frames = klingImageToVideo.buildRequest({ firstFrameUrl: PHOTO });
    const refs = klingReferenceImage.buildRequest({ prompt: "a portrait", styleImageUrls: [PHOTO] });
    expect((frames.image_list as Record<string, unknown>[])[0]).toHaveProperty("type");
    expect((refs.image_list as Record<string, unknown>[])[0]).not.toHaveProperty("type");
  });
});

describe("Reference Image — photos the model learns from", () => {
  it("builds element_list for a subject and image_list for style, with the prompt naming the element", () => {
    const input = { prompt: `make ${klingElementRef(1)} walk on a beach`, elements: [{ imageUrls: [PHOTO, PHOTO2] }], styleImageUrls: [PHOTO] };
    expect(klingReferenceImage.validate(input)).toEqual({ ok: true });
    const body = klingReferenceImage.buildRequest(input);
    expect(body.element_list).toEqual([{ element_id: 1, images: [PHOTO, PHOTO2] }]);
    expect(body.image_list).toEqual([{ image: PHOTO }]);
    expect(body.prompt).toContain("<<<element_1>>>");
  });

  it("carries an element's clip and bound voice when supplied", () => {
    const body = klingReferenceImage.buildRequest({ prompt: "p", elements: [{ imageUrls: [], clipUrl: VIDEO, voiceUrl: "https://storage.test/v.mp3" }] });
    expect(body.element_list).toEqual([{ element_id: 1, video: VIDEO, audio: "https://storage.test/v.mp3" }]);
  });

  it("🔴 counts element photos AND style photos against ONE budget of seven", () => {
    const six = Array.from({ length: 6 }, (_, i) => `https://storage.test/s${i}.jpg`);
    expect(klingReferenceImage.validate({ prompt: "p", elements: [{ imageUrls: [PHOTO, PHOTO2] }], styleImageUrls: six }).ok).toBe(false);
    expect(klingReferenceImage.validate({ prompt: "p", elements: [{ imageUrls: [PHOTO] }], styleImageUrls: six }).ok).toBe(true);
  });

  it("🔴 refuses a missing prompt, no references at all, an over-large element and a bad clip length", () => {
    expect(klingReferenceImage.validate({ prompt: "", styleImageUrls: [PHOTO] }).ok).toBe(false);
    expect(klingReferenceImage.validate({ prompt: "p" }).ok).toBe(false);
    expect(klingReferenceImage.validate({ prompt: "p", elements: [{ imageUrls: [PHOTO, PHOTO, PHOTO, PHOTO, PHOTO] }] }).ok).toBe(false);
    expect(klingReferenceImage.validate({ prompt: "p", elements: [{ imageUrls: [], clipUrl: VIDEO, clipDurationSeconds: 20 }] }).ok).toBe(false);
    expect(klingReferenceImage.validate({ prompt: "p", elements: [{ imageUrls: [], clipUrl: VIDEO, clipDurationSeconds: 5 }] }).ok).toBe(true);
    expect(klingReferenceImage.validate({ prompt: "p", elements: [{ imageUrls: [] }] }).ok).toBe(false);
  });
});

describe("Reference Video — `feature`, which is NOT the base clip", () => {
  it("sends refer_type feature, and the prompt can name the video", () => {
    const input = { videoUrl: VIDEO, prompt: `in the style of ${klingVideoRef(1)}`, videoDurationSeconds: 6 };
    expect(klingReferenceVideo.validate(input)).toEqual({ ok: true });
    const body = klingReferenceVideo.buildRequest(input);
    expect(body.video_list).toEqual([{ video: VIDEO, refer_type: "feature" }]);
    expect(body.prompt).toContain("<<<video_1>>>");
  });

  it("🔴 is a DIFFERENT request from full-character — `feature` vs `base`", () => {
    const reference = klingReferenceVideo.buildRequest({ videoUrl: VIDEO, prompt: "p" });
    const replace = klingFullCharacter.buildRequest({ videoUrl: VIDEO, character: { imageUrls: [PHOTO] } });
    expect((reference.video_list as Record<string, unknown>[])[0]!.refer_type).toBe("feature");
    expect((replace.video_list as Record<string, unknown>[])[0]!.refer_type).toBe("base");
    expect(reference).not.toHaveProperty("element_list");
    expect(replace).toHaveProperty("element_list");
  });

  it("🔴 enforces the VIDEO window (3–10 s), not the output window (3–15 s)", () => {
    expect(klingReferenceVideo.validate({ videoUrl: VIDEO, prompt: "p", videoDurationSeconds: 2 }).ok).toBe(false);
    expect(klingReferenceVideo.validate({ videoUrl: VIDEO, prompt: "p", videoDurationSeconds: 12 }).ok).toBe(false);
    expect(klingReferenceVideo.validate({ videoUrl: VIDEO, prompt: "p", videoDurationSeconds: 10 }).ok).toBe(true);
    // ...while the OUTPUT may still be 15 s
    expect(klingReferenceVideo.validate({ videoUrl: VIDEO, prompt: "p", videoDurationSeconds: 5, options: { durationSeconds: 15 } }).ok).toBe(true);
  });

  it("🔴 refuses native sound alongside a reference video — the vendor's rule", () => {
    expect(klingReferenceVideo.validate({ videoUrl: VIDEO, prompt: "p", options: { sound: "on" } }).ok).toBe(false);
    expect(klingReferenceVideo.validate({ videoUrl: VIDEO, prompt: "p", options: { sound: "off" } }).ok).toBe(true);
  });

  it("🔴 refuses an over-size clip and too many stills for the four-reference budget", () => {
    expect(klingReferenceVideo.validate({ videoUrl: VIDEO, prompt: "p", videoBytes: 300 * 1024 * 1024 }).ok).toBe(false);
    const four = Array.from({ length: 4 }, (_, i) => `https://storage.test/s${i}.jpg`);
    expect(klingReferenceVideo.validate({ videoUrl: VIDEO, prompt: "p", styleImageUrls: four }).ok).toBe(false);
  });
});

describe("Full Character — the one replacement scope Omni serves", () => {
  it("builds a base video plus one character element, and keeps the source audio by default", () => {
    const input = { videoUrl: VIDEO, character: { imageUrls: [PHOTO, PHOTO2] }, videoDurationSeconds: 8 };
    expect(klingFullCharacter.validate(input)).toEqual({ ok: true });
    const body = klingFullCharacter.buildRequest(input);
    expect(body.video_list).toEqual([{ video: VIDEO, refer_type: "base", keep_original_sound: true }]);
    expect(body.element_list).toEqual([{ element_id: 1, images: [PHOTO, PHOTO2] }]);
    expect(body.model_name).toBe(KLING_OMNI_MODEL_NAME);
  });

  it("the default prompt names both references and lists what to preserve", () => {
    const prompt = defaultFullCharacterPrompt();
    expect(prompt).toContain("<<<video_1>>>");
    expect(prompt).toContain("<<<element_1>>>");
    for (const preserved of ["movements", "expressions", "camera", "lighting", "background"]) expect(prompt).toContain(preserved);
    expect(klingFullCharacter.buildRequest({ videoUrl: VIDEO, character: { imageUrls: [PHOTO] } }).prompt).toBe(prompt);
    // ...and a caller's own prompt wins
    expect(klingFullCharacter.buildRequest({ videoUrl: VIDEO, character: { imageUrls: [PHOTO] }, prompt: "mine" }).prompt).toBe("mine");
  });

  it("🔴 counts the base video against the four-reference budget, leaving three photos", () => {
    const three = [PHOTO, PHOTO2, PHOTO];
    expect(klingFullCharacter.validate({ videoUrl: VIDEO, character: { imageUrls: three } }).ok).toBe(true);
    expect(klingFullCharacter.validate({ videoUrl: VIDEO, character: { imageUrls: [...three, PHOTO2] } }).ok).toBe(false);
  });

  it("🔴 refuses a missing video, a character with nothing in it, and sound alongside the video", () => {
    expect(klingFullCharacter.validate({ videoUrl: "", character: { imageUrls: [PHOTO] } }).ok).toBe(false);
    expect(klingFullCharacter.validate({ videoUrl: VIDEO, character: { imageUrls: [] } }).ok).toBe(false);
    expect(klingFullCharacter.validate({ videoUrl: VIDEO, character: { imageUrls: [PHOTO] }, options: { sound: "on" } }).ok).toBe(false);
  });

  it("🔴 submits ONE generation — no voice stage, no lip-sync stage, no second vendor (§6)", () => {
    const body = klingFullCharacter.buildRequest({ videoUrl: VIDEO, character: { imageUrls: [PHOTO] } });
    // one request, one model, one video, one element
    expect(Object.keys(body).sort()).toEqual(["element_list", "model_name", "multi_shot", "prompt", "video_list"]);
    const source = code("lib/ai/kling/features/full-character.ts");
    for (const forbidden of ["elevenlabs", "replicate", "lipSync", "lip_sync", "pipeline", "planPipeline"]) {
      expect(source.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe("The capability gate — the billing-safety property (§5)", () => {
  it("every feature named by the migration has a verdict, and the verdicts partition cleanly", () => {
    const report = klingCapabilityReport();
    expect(report.map((r) => r.id).sort()).toEqual([...KLING_FEATURE_IDS].sort());
    const available = report.filter((r) => r.available).map((r) => r.id).sort();
    const refused = report.filter((r) => !r.available).map((r) => r.id).sort();
    expect(available).toEqual([...KLING_IMPLEMENTED_FEATURE_IDS].sort());
    expect(refused).toEqual(["face_only", "face_skin", "lip_sync", "upper_body"]);
  });

  it("🔴 every refusal carries a CONCRETE documented limitation, not a shrug", () => {
    expect(KLING_UNAVAILABLE_FEATURES).toHaveLength(4);
    for (const feature of KLING_UNAVAILABLE_FEATURES) {
      expect(feature.available).toBe(false);
      expect(feature.unavailableReason.length, feature.id).toBeGreaterThan(120);
      expect(feature.revisitWhen.length, feature.id).toBeGreaterThan(20);
      // a reason that just says "not supported" would be useless to Part 4
      expect(feature.unavailableReason.toLowerCase(), feature.id).toMatch(/kling|omni/);
    }
  });

  it("🔴 lip sync is refused, and the reason says WHY rather than deferring to the fal adapter", () => {
    const verdict = klingFeatureGate("lip_sync");
    expect(verdict.available).toBe(false);
    expect(verdict.available === false && verdict.reason).toContain("not a documented mode");
  });

  it("🔴 an unsupported feature is refused BEFORE any input is even looked at", () => {
    for (const id of ["face_only", "face_skin", "upper_body", "lip_sync"]) {
      const verdict = klingValidateBeforeBilling(id as never, {} as never);
      expect(verdict.ok, id).toBe(false);
      expect(verdict.ok === false && verdict.kind, id).toBe("unsupported");
    }
  });

  it("an unknown id is refused rather than defaulting to something", () => {
    expect(klingFeatureGate("video_extend").available).toBe(false);
    expect(klingFeatureGate("").available).toBe(false);
  });

  it("🔴 the gate is PURE — no client, no database, no storage, no clock", () => {
    for (const file of ["registry.ts", "capabilities.ts", "shared.ts", "types.ts", "unavailable.ts", "text-to-video.ts", "image-to-video.ts", "reference-image.ts", "reference-video.ts", "full-character.ts"]) {
      const source = code(`lib/ai/kling/features/${file}`);
      for (const forbidden of ["server-only", "kling/client", "supabase", "createAdminClient", "fetch(", "Date.now()"]) {
        expect(source, `${file} / ${forbidden}`).not.toContain(forbidden);
      }
    }
    // ...and the ONE file that does touch the network is the one that says so
    expect(src("lib/ai/kling/features/submit.ts").startsWith('import "server-only";')).toBe(true);
  });
});

describe("Part 3 stays inside its boundary", () => {
  it("🔴 nothing in app/, server/ or the provider resolver imports a handler — no production routing (§9)", () => {
    for (const file of ["lib/ai/providers/resolve.ts", "lib/ai/providers/config.ts", "lib/ai/kling/provider.ts", "app/api/webhooks/kling/route.ts", "server/services/ai-character-replace-prepare-service.ts", "lib/ai/character-replace/start-job.ts", "lib/ai/lip-sync/start-job.ts", "lib/ai/submit.ts"]) {
      expect(src(file), file).not.toContain("lib/ai/kling/features/");
    }
  });

  it("🔴 the Kling adapter still supports NO feature — Part 3 did not open production routing", async () => {
    const { klingProvider } = await import("../provider");
    for (const feature of ["ai_character_replace", "ai_lip_sync", "ai_text_to_audio", "ai_voice_clone"] as const) {
      expect(klingProvider.supports(feature), feature).toBe(false);
    }
  });

  it("🔴 no handler mentions pricing, credits, a wallet or a quote — billing was not redesigned (§5, §16)", () => {
    for (const file of ["registry.ts", "submit.ts", "shared.ts", "capabilities.ts", "text-to-video.ts", "image-to-video.ts", "reference-image.ts", "reference-video.ts", "full-character.ts"]) {
      const source = code(`lib/ai/kling/features/${file}`);
      for (const forbidden of ["priceCents", "chargeAiBalance", "reserve_product_charge", "reserveJobFunding", "creditMultiplier", "AI_QUOTE_SIGNING_SECRET", "quote"]) {
        expect(source.toLowerCase(), `${file} / ${forbidden}`).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it("🔴 no handler reaches for another vendor — no fake compatibility layer (§3)", () => {
    /*
      unavailable.ts is excluded on purpose: its refusal reasons NAME the other
      vendors, to say explicitly that their answers were not inherited. That is
      the opposite of a compatibility layer, and it is the text Part 4 reads.
    */
    const handlers = ["registry.ts", "submit.ts", "text-to-video.ts", "image-to-video.ts", "reference-image.ts", "reference-video.ts", "full-character.ts"];
    for (const file of handlers) {
      const source = code(`lib/ai/kling/features/${file}`).toLowerCase();
      for (const forbidden of ["replicate", "fal/", "fal-ai", "elevenlabs", "anthropic"]) {
        expect(source, `${file} / ${forbidden}`).not.toContain(forbidden);
      }
    }
    // unavailable.ts names them, and says it is refusing rather than reusing
    const unavailable = code("lib/ai/kling/features/unavailable.ts");
    expect(unavailable).toContain("fal.ai capability mapping");
    // it names them in prose only: its single import is its own type
    const imports = unavailable.match(/^import .*$/gm) ?? [];
    expect(imports).toEqual(['import type { KlingUnavailableFeature } from "@/lib/ai/kling/features/types";']);
  });
});
