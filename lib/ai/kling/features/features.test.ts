import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { KLING_LIP_SYNC, KLING_OMNI, KLING_RESOLUTIONS, KLING_VIDEO_RESOLUTIONS, klingElementRef, klingVideoRef } from "./capabilities";
import { klingImageToVideo } from "./image-to-video";
import { klingLipSync } from "./lip-sync";
import { klingCapabilityReport, klingFeatureGate, klingFeatureProvenForBilling, KLING_IMPLEMENTED_FEATURE_IDS, KLING_UNAVAILABLE_FEATURES } from "./registry";
import { klingTextToVideo } from "./text-to-video";
import { KLING_FEATURE_IDS } from "./types";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every pure module under features/ — the list the purity and boundary guards walk. */
const PURE_FILES = ["registry.ts", "capabilities.ts", "shared.ts", "types.ts", "unavailable.ts", "text-to-video.ts", "image-to-video.ts", "lip-sync.ts"];
const HANDLER_FILES = ["text-to-video.ts", "image-to-video.ts", "lip-sync.ts"];

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE DIRECT KLING FEATURE HANDLERS — pinned to the VERIFIED live contract
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 Part 3's version of this file asserted a request shape that the live API
 * rejects outright. It passed, because it only ever compared our code against
 * our own guesses: `image_list`, `element_list`, `video_list`, `multi_prompt`,
 * `mode`, `sound`, `end_frame`, `model_name`, a top-level `callback_url`. None of
 * those exist. A test can be green and prove nothing, which is the whole reason
 * the owner's §5 says to verify against the vendor.
 *
 * So these tests assert the shape that was read off the real API on 2026-09-28,
 * with the vendor's own error messages quoted in
 * `docs/AI_PROVIDER_MIGRATION_PART4_KLING_CONTRACT.md`. Every guard has a case
 * that fails on the OLD shape.
 */

describe("Kling settings — the verified vocabulary, not the guessed one", () => {
  it("🔴 resolution is lower-case 480p/720p/1080p/4k — `mode: std|pro|4k` never existed", () => {
    expect(KLING_RESOLUTIONS).toEqual(["480p", "720p", "1080p", "4k"]);
    // The exact string a mirror publishes, and the vendor refuses.
    expect(KLING_RESOLUTIONS as readonly string[]).not.toContain("720P");
    expect(KLING_RESOLUTIONS as readonly string[]).not.toContain("std");
    expect(KLING_RESOLUTIONS as readonly string[]).not.toContain("pro");
  });

  it("🔴 the audio modes usable on kling-v3-omni are native/off — `original` is refused BY THE MODEL", () => {
    expect(KLING_OMNI.audioModes).toEqual(["native", "off"]);
    expect(klingTextToVideo.validate({ prompt: "a cat", options: { aspectRatio: "16:9", audio: "original" as never } }).ok).toBe(false);
  });

  it("the content types are exactly the seven the vendor accepts", () => {
    expect(KLING_OMNI.contentTypes).toEqual(["prompt", "image", "video", "element", "first_frame", "last_frame", "voice"]);
    // `end_frame` was Part 3's guess and is rejected live.
    expect(KLING_OMNI.contentTypes as readonly string[]).not.toContain("end_frame");
  });

  it("🔴 the duration window is OURS to enforce — the vendor accepts 0, 1 and 20", () => {
    expect(KLING_OMNI.duration).toMatchObject({ minSeconds: 3, maxSeconds: 15 });
    for (const bad of [0, 1, 2, 16, 20, 2.5]) {
      expect(klingTextToVideo.validate({ prompt: "a cat", options: { aspectRatio: "16:9", durationSeconds: bad } }).ok, String(bad)).toBe(false);
    }
    expect(klingTextToVideo.validate({ prompt: "a cat", options: { aspectRatio: "16:9", durationSeconds: 15 } }).ok).toBe(true);
  });

  it("🔴 the reference VIDEO window (3–10 s) is not the OUTPUT window (3–15 s)", () => {
    expect(KLING_OMNI.video.maxSeconds).toBe(10);
    expect(KLING_OMNI.duration.maxSeconds).toBe(15);
    expect(KLING_OMNI.video.maxSeconds).toBeLessThan(KLING_OMNI.duration.maxSeconds);
  });

  it("🔴 the Omni table and the fal-era O1 table never import each other", () => {
    expect(code("lib/ai/kling/features/capabilities.ts")).not.toContain("character-replace/providers/kling-input");
    expect(code("lib/ai/character-replace/providers/kling-input.ts")).not.toContain("lib/ai/kling/features");
  });

  it("the prompt reference tokens are 1-based, matching the vendor's own syntax", () => {
    expect(klingElementRef(1)).toBe("<<<element_1>>>");
    expect(klingVideoRef(1)).toBe("<<<video_1>>>");
  });
});

describe("Text to Video — the one handler verified END TO END", () => {
  it("builds { contents:[prompt], settings } — and NOTHING Part 3 sent", () => {
    const body = klingTextToVideo.buildRequest({ prompt: "  a cat walking  ", options: { aspectRatio: "16:9", resolution: "720p", durationSeconds: 5 } });
    expect(body).toEqual({
      contents: [{ type: "prompt", text: "a cat walking" }],
      settings: { aspect_ratio: "16:9", resolution: "720p", duration: 5 },
    });
    // 🔴 the fields that would have 400'd, or silently done nothing
    for (const dead of ["model_name", "prompt", "image_list", "element_list", "video_list", "multi_prompt", "mode", "sound", "duration", "callback_url"]) {
      expect(Object.keys(body), dead).not.toContain(dead);
    }
  });

  it("multi_shot is a boolean in settings, and a per-shot prompt list is NOT faked", () => {
    const body = klingTextToVideo.buildRequest({ prompt: "a cat", multiShot: true, options: { aspectRatio: "16:9" } });
    expect((body.settings as Record<string, unknown>).multi_shot).toBe(true);
    expect(JSON.stringify(body)).not.toContain("multi_prompt");
    expect(JSON.stringify(body)).not.toContain("shot_type");
  });

  it("🔴 requires an aspect ratio, because the vendor does when there is no first frame", () => {
    expect(klingTextToVideo.validate({ prompt: "a cat" }).ok).toBe(false);
    expect(klingTextToVideo.validate({ prompt: "a cat", options: { aspectRatio: "9:16" } }).ok).toBe(true);
  });

  it("🔴 refuses an empty prompt, an over-long one and an invented ratio", () => {
    expect(klingTextToVideo.validate({ prompt: "   ", options: { aspectRatio: "16:9" } }).ok).toBe(false);
    expect(klingTextToVideo.validate({ prompt: "x".repeat(KLING_OMNI.prompt.maxChars + 1), options: { aspectRatio: "16:9" } }).ok).toBe(false);
    expect(klingTextToVideo.validate({ prompt: "a cat", options: { aspectRatio: "4:3" as never } }).ok).toBe(false);
  });

  it("an omitted option is OMITTED, never silently defaulted", () => {
    const body = klingTextToVideo.buildRequest({ prompt: "a cat", options: { aspectRatio: "16:9" } });
    expect(body.settings).toEqual({ aspect_ratio: "16:9" });
  });

  it("🔴 every SHIPPED feature is proven by a real generation, and nothing else is", () => {
    // All three were run against the live API on 2026-09-28 and produced correct
    // output. Nothing reaches a member on the strength of a validation message.
    for (const id of ["text_to_video", "image_to_video", "lip_sync"]) {
      expect(klingFeatureProvenForBilling(id), id).toBe(true);
    }
    // Refused capabilities are not billable by construction.
    for (const id of ["reference_video", "reference_image", "full_character", "face_only", "face_skin", "upper_body"]) {
      expect(klingFeatureProvenForBilling(id), id).toBe(false);
    }
  });

  it("🔴 480p is refused although the settings enum lists it — the model will not render video at it", () => {
    expect(KLING_RESOLUTIONS as readonly string[]).toContain("480p");
    expect(KLING_VIDEO_RESOLUTIONS as readonly string[]).not.toContain("480p");
    // "video resolution value '480p' is invalid" — a refusal AFTER the charge if we allowed it.
    expect(klingTextToVideo.validate({ prompt: "a cat", options: { aspectRatio: "16:9", resolution: "480p" as never } }).ok).toBe(false);
    expect(klingTextToVideo.validate({ prompt: "a cat", options: { aspectRatio: "16:9", resolution: "720p" } }).ok).toBe(true);
  });
});

describe("Image to Video — frames, and the right field names", () => {
  it("🔴 sends first_frame/last_frame with `url` — not image_list, not `end_frame`", () => {
    const body = klingImageToVideo.buildRequest({ firstFrameUrl: "https://x.test/a.jpg", lastFrameUrl: "https://x.test/b.jpg", prompt: "push in", options: { resolution: "720p" } });
    expect(body).toEqual({
      contents: [
        { type: "prompt", text: "push in" },
        { type: "first_frame", url: "https://x.test/a.jpg" },
        { type: "last_frame", url: "https://x.test/b.jpg" },
      ],
      settings: { resolution: "720p" },
    });
    expect(JSON.stringify(body)).not.toContain("end_frame");
    expect(JSON.stringify(body)).not.toContain("image_list");
  });

  it("the prompt is optional — a frame is already an instruction", () => {
    const body = klingImageToVideo.buildRequest({ firstFrameUrl: "https://x.test/a.jpg" });
    expect(body.contents).toEqual([{ type: "first_frame", url: "https://x.test/a.jpg" }]);
  });

  it("🔴 needs NO aspect ratio — the vendor exempts a request that has a first frame", () => {
    expect(klingImageToVideo.validate({ firstFrameUrl: "https://x.test/a.jpg" }).ok).toBe(true);
  });

  it("🔴 refuses a missing image, a non-https URL and a private address", () => {
    expect(klingImageToVideo.validate({ firstFrameUrl: "" }).ok).toBe(false);
    expect(klingImageToVideo.validate({ firstFrameUrl: "http://x.test/a.jpg" }).ok).toBe(false);
    expect(klingImageToVideo.validate({ firstFrameUrl: "https://169.254.169.254/a.jpg" }).ok).toBe(false);
    expect(klingImageToVideo.validate({ firstFrameUrl: "https://localhost/a.jpg" }).ok).toBe(false);
    expect(klingImageToVideo.validate({ firstFrameUrl: "https://x.test/a.jpg", lastFrameUrl: "http://x.test/b.jpg" }).ok).toBe(false);
  });
});

describe("Lip Sync — a REAL separate Kling endpoint (§6, and Part 3 was wrong)", () => {
  it("🔴 it exists and is available — Part 3 put it in the unavailable list", () => {
    expect(klingLipSync.available).toBe(true);
    expect(KLING_IMPLEMENTED_FEATURE_IDS).toContain("lip_sync");
    expect(KLING_UNAVAILABLE_FEATURES.map((f) => f.id)).not.toContain("lip_sync");
  });

  it("🔴 submits to its OWN path and its OWN model, never Omni's", () => {
    expect(klingLipSync.path).toBe("/v1/videos/lip-sync");
    expect(klingLipSync.model).not.toBe("kling-v3-omni");
    expect(klingLipSync.path).not.toContain("omni");
  });

  it("builds the verified audio2video body", () => {
    const body = klingLipSync.buildRequest({ mode: "audio2video", videoUrl: "https://x.test/a.mp4", audioUrl: "https://x.test/a.mp3" });
    expect(body).toEqual({ input: { mode: "audio2video", video_url: "https://x.test/a.mp4", audio_type: "url", audio_url: "https://x.test/a.mp3" } });
  });

  it("builds the verified text2video body, in snake_case", () => {
    const body = klingLipSync.buildRequest({ mode: "text2video", videoUrl: "https://x.test/a.mp4", text: "hello", voiceId: "v1", voiceLanguage: "en", voiceSpeed: 1.2 });
    expect(body).toEqual({ input: { mode: "text2video", video_url: "https://x.test/a.mp4", text: "hello", voice_id: "v1", voice_language: "en", voice_speed: 1.2 } });
    // the vendor's error names voiceSpeed internally; we send only what was verified
    expect(JSON.stringify(body)).not.toContain("voiceSpeed");
  });

  it("takes video_url OR video_id, and 🔴 refuses BOTH rather than choosing", () => {
    expect(klingLipSync.buildRequest({ mode: "audio2video", videoId: "vid_1", audioUrl: "https://x.test/a.mp3" })).toEqual({
      input: { mode: "audio2video", video_id: "vid_1", audio_type: "url", audio_url: "https://x.test/a.mp3" },
    });
    expect(klingLipSync.validate({ mode: "audio2video", videoUrl: "https://x.test/a.mp4", videoId: "vid_1", audioUrl: "https://x.test/a.mp3" }).ok).toBe(false);
    expect(klingLipSync.validate({ mode: "audio2video", audioUrl: "https://x.test/a.mp3" }).ok).toBe(false);
  });

  it("🔴 typed speech is English/Chinese ONLY, and the refusal names the real alternative", () => {
    expect(KLING_LIP_SYNC.voiceLanguages).toEqual(["zh", "en"]);
    const verdict = klingLipSync.validate({ mode: "text2video", videoUrl: "https://x.test/a.mp4", text: "hola", voiceId: "v1", voiceLanguage: "es" as never });
    expect(verdict.ok).toBe(false);
    // It must not merely say "unsupported" — a member can act on the real path.
    expect(verdict.ok === false && verdict.reason).toMatch(/generate the audio first/i);
  });

  it("enforces the voice speed ceiling the vendor states, and refuses a bad mode", () => {
    const base = { mode: "text2video", videoUrl: "https://x.test/a.mp4", text: "hi", voiceId: "v1", voiceLanguage: "en" } as const;
    expect(klingLipSync.validate({ ...base, voiceSpeed: 2.5 }).ok).toBe(false);
    expect(klingLipSync.validate({ ...base, voiceSpeed: 0.1 }).ok).toBe(false);
    expect(klingLipSync.validate({ ...base, voiceSpeed: 2 }).ok).toBe(true);
    expect(klingLipSync.validate({ mode: "audio" as never, videoUrl: "https://x.test/a.mp4", audioUrl: "https://x.test/a.mp3" } as never).ok).toBe(false);
  });

  it("🔴 generates no speech and calls no other vendor — one capability, one request (§3)", () => {
    const source = code("lib/ai/kling/features/lip-sync.ts").toLowerCase();
    for (const forbidden of ["elevenlabs", "tts(", "texttospeech", "replicate", "fal"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});

describe("🔴 Character Replace has NO engine on the direct API — verified, not assumed", () => {
  it("all four scopes are unavailable, and reference_image with them", () => {
    for (const id of ["full_character", "upper_body", "face_only", "face_skin", "reference_image"]) {
      const verdict = klingFeatureGate(id);
      expect(verdict.available, id).toBe(false);
    }
  });

  it("🔴 the reason is the ELEMENT finding, not Part 3's 'no region control'", () => {
    const full = klingFeatureGate("full_character");
    expect(full.available).toBe(false);
    if (full.available) throw new Error("unreachable");
    // Part 3 declared Full Character AVAILABLE. The live API refuses it, and the
    // reason must name the mechanism so nobody re-enables it on a guess.
    expect(full.reason).toMatch(/element/i);
    expect(full.reason).toMatch(/Element id not found|element-creation|cannot be given a character/i);
  });

  it("every refusal carries a concrete limitation and a revisit condition, not a shrug", () => {
    for (const f of KLING_UNAVAILABLE_FEATURES) {
      expect(f.unavailableReason.length, f.id).toBeGreaterThan(120);
      expect(f.revisitWhen.length, f.id).toBeGreaterThan(20);
      expect(f.unavailableReason, f.id).not.toMatch(/\b(TODO|later|for now|not yet implemented)\b/i);
    }
  });

  it("🔴 nothing is quietly routed elsewhere to make a refused scope 'work' (§1, §7)", () => {
    const report = klingCapabilityReport();
    const refused = report.filter((r) => !r.available);
    expect(refused.length).toBeGreaterThan(0);
    for (const file of HANDLER_FILES) {
      const source = code(`lib/ai/kling/features/${file}`).toLowerCase();
      for (const vendor of ["replicate", "fal-ai", "fal/", "kie", "wan-video"]) {
        expect(source, `${file} / ${vendor}`).not.toContain(vendor);
      }
    }
  });
});

describe("The capability gate — the billing-safety property (§13)", () => {
  it("every feature the migration names has a verdict, and the verdicts partition cleanly", () => {
    const report = klingCapabilityReport();
    expect(report.map((r) => r.id).sort()).toEqual([...KLING_FEATURE_IDS].sort());
    const available = report.filter((r) => r.available).map((r) => r.id).sort();
    expect(available).toEqual([...KLING_IMPLEMENTED_FEATURE_IDS].sort());
  });

  it("🔴 an unsupported feature is refused BEFORE any input is looked at", () => {
    // No input at all, and still a definite answer — this is what makes it free
    // to call before reserving a member's money.
    for (const id of ["full_character", "face_only", "reference_image"]) {
      expect(klingFeatureGate(id).available, id).toBe(false);
    }
  });

  it("an unknown id is refused rather than defaulting to something", () => {
    expect(klingFeatureGate("video_extend").available).toBe(false);
    expect(klingFeatureGate("").available).toBe(false);
    expect(klingFeatureProvenForBilling("video_extend")).toBe(false);
  });

  it("🔴 the gate is PURE — no client, no database, no storage, no clock", () => {
    for (const file of PURE_FILES) {
      const source = code(`lib/ai/kling/features/${file}`);
      for (const forbidden of ["server-only", "kling/client", "supabase", "createAdminClient", "fetch(", "Date.now()"]) {
        expect(source, `${file} / ${forbidden}`).not.toContain(forbidden);
      }
    }
    // ...and the ONE file that does touch the network is the one that says so
    expect(src("lib/ai/kling/features/submit.ts").startsWith('import "server-only";')).toBe(true);
  });
});

describe("The handlers stay inside their boundary", () => {
  it("🔴 no handler mentions pricing, credits, a wallet or a quote — billing is not the adapter's business", () => {
    for (const file of [...PURE_FILES, "submit.ts"]) {
      const source = code(`lib/ai/kling/features/${file}`);
      for (const forbidden of ["priceCents", "chargeAiBalance", "reserve_product_charge", "reserveJobFunding", "creditMultiplier", "AI_QUOTE_SIGNING_SECRET"]) {
        expect(source.toLowerCase(), `${file} / ${forbidden}`).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it("🔴 unavailable.ts names the other vendors in PROSE only — to refuse them, never to import them", () => {
    const unavailable = code("lib/ai/kling/features/unavailable.ts");
    expect(unavailable).toContain("fal.ai capability mapping");
    const imports = unavailable.match(/^import .*$/gm) ?? [];
    expect(imports).toEqual(['import type { KlingUnavailableFeature } from "@/lib/ai/kling/features/types";']);
  });

  /*
    🔴 STILL TRUE AS OF THIS COMMIT, AND DELIBERATELY SO.

    The handlers are now correct against the live API, but no production path
    imports them yet: Character Replace has no engine on this API (see above), so
    what the product does about that is the owner's decision and routing waits on
    it. This guard is what stops routing being opened by accident in the meantime
    — and it is the guard to UPDATE, consciously, when routing is wired.
  */
  it("🔴 nothing in app/, server/ or the provider resolver imports a handler yet — routing is not open", () => {
    for (const file of [
      "lib/ai/providers/resolve.ts",
      "lib/ai/providers/config.ts",
      "lib/ai/kling/provider.ts",
      "app/api/webhooks/kling/route.ts",
      "lib/ai/character-replace/start-job.ts",
      "lib/ai/lip-sync/start-job.ts",
      "lib/ai/submit.ts",
    ]) {
      expect(src(file), file).not.toContain("lib/ai/kling/features/");
    }
  });

  it("each handler owns its own request construction — the registry assembles no body (§4)", () => {
    const registry = code("lib/ai/kling/features/registry.ts");
    // A directory lists handlers; it does not build requests or branch on features.
    expect(registry).not.toContain("contents:");
    expect(registry).not.toContain("settings:");
    expect(registry).not.toMatch(/switch\s*\(\s*(feature|id)\s*\)/);
  });
});
