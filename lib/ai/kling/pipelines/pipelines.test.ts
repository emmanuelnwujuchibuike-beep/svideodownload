import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { klingImageToVideoPipeline } from "./image-to-video";
import { klingLipSyncPipeline } from "./lip-sync";
import {
  isKlingRunnableFeature,
  isKlingVideoAiFeature,
  klingCapability,
  klingCapabilityReport,
  klingPipeline,
  klingPipelineFor,
  KLING_PIPELINES,
  KLING_RUNNABLE_FEATURES,
  KLING_UNSUPPORTED_PIPELINES,
  KLING_VIDEO_AI_FEATURES,
} from "./registry";
import { klingTextToVideoPipeline } from "./text-to-video";
import { isSupportedPipeline, KLING_PIPELINE_FEATURES } from "./types";
import { normalizeKlingPricing, KLING_PRICING_DEFAULTS, type KlingPricingConfig } from "../pricing";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PIPELINE_FILES = ["types.ts", "registry.ts", "unsupported.ts", "text-to-video.ts", "image-to-video.ts", "lip-sync.ts"];

/** A configuration where everything is on sale and priced, so `available` is reachable. */
const livePricing = (): KlingPricingConfig =>
  normalizeKlingPricing({
    ...KLING_PRICING_DEFAULTS,
    matrix: Object.fromEntries(
      Object.entries(KLING_PRICING_DEFAULTS.matrix).map(([k, v]) => [k, { ...v, enabled: true, priceUsdCentsPerSecond: 10 }]),
    ),
  });

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 5 — PIPELINE ISOLATION AND PROVIDER ISOLATION (§28, §40)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §40 asks four questions and expects "NO" to all of them:
 *
 *   Can any production video feature still execute through Replicate?
 *   Can any production video feature still execute through fal.ai?
 *   Can Kling automatically fall back to another video provider?
 *   Can one Kling feature secretly trigger another Kling feature?
 *
 * These are the tests that answer them, and they are written so that they FAIL
 * if somebody later adds the fallback back. A guard that cannot fail proves
 * nothing.
 */

describe("§4 — the feature → pipeline map is explicit and complete", () => {
  it("every feature the product names has exactly one entry", () => {
    for (const f of KLING_PIPELINE_FEATURES) {
      expect(klingPipelineFor(f), f).not.toBeNull();
    }
    // …and the two sets partition cleanly.
    const runnable = KLING_PIPELINE_FEATURES.filter((f) => isKlingRunnableFeature(f));
    const refused = KLING_UNSUPPORTED_PIPELINES.map((p) => p.feature);
    expect([...runnable, ...refused].sort()).toEqual([...KLING_PIPELINE_FEATURES].sort());
  });

  it("🔴 each pipeline names the Kling endpoint that owns it", () => {
    expect(klingTextToVideoPipeline.endpoint).toBe("/omni-video/kling-v3-omni");
    expect(klingImageToVideoPipeline.endpoint).toBe("/omni-video/kling-v3-omni");
    // Lip Sync is a DIFFERENT endpoint and a different model — the whole point of §11.
    expect(klingLipSyncPipeline.endpoint).toBe("/v1/videos/lip-sync");
    expect(klingLipSyncPipeline.model).not.toBe(klingTextToVideoPipeline.model);
  });

  it("🔴 the registry is a MAP, not a dispatcher — it builds no request (§2)", () => {
    const registry = code("lib/ai/kling/pipelines/registry.ts");
    expect(registry).not.toContain("contents:");
    expect(registry).not.toContain("settings:");
    expect(registry).not.toMatch(/switch\s*\(\s*(feature|id)\s*\)/);
    // and it does not reach for the network
    expect(registry).not.toContain("fetch(");
  });

  it("an unknown feature is refused rather than defaulting to something", () => {
    expect(klingPipelineFor("video_extend")).toBeNull();
    expect(klingPipelineFor("")).toBeNull();
    expect(isKlingRunnableFeature("full_character")).toBe(false);
  });
});

describe("🔴 §40 — NO production video path can reach Replicate or fal.ai", () => {
  it("no pipeline file mentions another video vendor at all", () => {
    for (const file of PIPELINE_FILES) {
      const source = code(`lib/ai/kling/pipelines/${file}`).toLowerCase();
      for (const vendor of ["replicate", "fal-ai", "fal/", "kie", "wan-video", "runway", "pika"]) {
        // unsupported.ts names fal.ai in PROSE to say its answer was not inherited;
        // comments are stripped above, so a hit here is real code.
        expect(source, `${file} / ${vendor}`).not.toContain(vendor);
      }
    }
  });

  it("🔴 every video feature's job row declares provider `kling`", () => {
    for (const f of KLING_RUNNABLE_FEATURES) {
      const p = KLING_PIPELINES[f];
      expect(p.supported, f).toBe(true);
      // The ai_jobs.feature value this pipeline owns must be one the isolation
      // guards recognise as a Kling video feature.
      expect(isKlingVideoAiFeature(p.aiFeature), f).toBe(true);
    }
    expect(KLING_VIDEO_AI_FEATURES).toContain("ai_text_to_video");
    expect(KLING_VIDEO_AI_FEATURES).toContain("ai_image_to_video");
    expect(KLING_VIDEO_AI_FEATURES).toContain("ai_lip_sync");
  });

  it("🔴 NO FALLBACK: an unsupported feature stays unsupported whatever the configuration", () => {
    const pricing = livePricing();
    for (const configured of [true, false]) {
      for (const p of KLING_UNSUPPORTED_PIPELINES) {
        const verdict = klingCapability(p.feature, { configured, pricing });
        // Not "temporarily_unavailable", not "admin_disabled", and above all not
        // quietly satisfied by another vendor.
        expect(verdict.state, `${p.feature}/${configured}`).toBe("unsupported");
      }
    }
  });

  it("🔴 an unsupported feature has no endpoint to call — it is not a disabled pipeline", () => {
    for (const p of KLING_UNSUPPORTED_PIPELINES) {
      const entry = klingPipelineFor(p.feature)!;
      expect(isSupportedPipeline(entry), p.feature).toBe(false);
      expect((entry as unknown as { endpoint?: string }).endpoint, p.feature).toBeUndefined();
    }
  });
});

describe("🔴 §3 — one feature never triggers another", () => {
  it("no pipeline imports another pipeline's module", () => {
    for (const file of ["text-to-video.ts", "image-to-video.ts", "lip-sync.ts"]) {
      const source = code(`lib/ai/kling/pipelines/${file}`);
      const others = ["text-to-video", "image-to-video", "lip-sync"].filter((o) => !file.startsWith(o));
      for (const other of others) {
        expect(source, `${file} imports ${other}`).not.toContain(`pipelines/${other}`);
      }
    }
  });

  it("no pipeline reaches for ElevenLabs, voice cloning or a second generation", () => {
    for (const file of ["text-to-video.ts", "image-to-video.ts", "lip-sync.ts"]) {
      const source = code(`lib/ai/kling/pipelines/${file}`).toLowerCase();
      for (const forbidden of ["elevenlabs", "voice-clone", "voiceclone", "text-to-audio", "texttoaudio"]) {
        expect(source, `${file} / ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("each pipeline builds only its OWN request shape", () => {
    const t2v = klingTextToVideoPipeline.buildRequest({ prompt: "a cat", options: { aspectRatio: "16:9" } });
    const i2v = klingImageToVideoPipeline.buildRequest({ firstFrameUrl: "https://x.test/a.jpg" });
    const ls = klingLipSyncPipeline.buildRequest({ mode: "audio2video", videoUrl: "https://x.test/a.mp4", audioUrl: "https://x.test/a.mp3" });

    // Text to Video sends a prompt and no media.
    expect(JSON.stringify(t2v)).not.toContain("first_frame");
    expect(JSON.stringify(t2v)).not.toContain("video");
    // Image to Video sends a frame.
    expect(JSON.stringify(i2v)).toContain("first_frame");
    // Lip Sync is a different shape entirely — `input`, not `contents`.
    expect(Object.keys(ls)).toEqual(["input"]);
    expect(JSON.stringify(ls)).not.toContain("contents");
  });
});

describe("§36 — capability states the UI can trust", () => {
  const pricing = livePricing();

  it("a runnable feature with a credential and an enabled tier is available", () => {
    for (const f of KLING_RUNNABLE_FEATURES) {
      expect(klingCapability(f, { configured: true, pricing }).state, f).toBe("available");
    }
  });

  it("🔴 no credential is TEMPORARY, not unsupported — the difference matters to a member", () => {
    const v = klingCapability("text_to_video", { configured: false, pricing });
    expect(v.state).toBe("temporarily_unavailable");
    expect(v.reason).toMatch(/nothing has been charged/i);
  });

  it("a paused deployment reports admin_disabled, not broken", () => {
    const paused = normalizeKlingPricing({ ...pricing, paused: true });
    expect(klingCapability("text_to_video", { configured: true, pricing: paused }).state).toBe("admin_disabled");
  });

  it("a tier switched off reports admin_disabled", () => {
    const off = normalizeKlingPricing({
      ...pricing,
      matrix: { ...pricing.matrix, "text_to_video:720p": { ...pricing.matrix["text_to_video:720p"], enabled: false } },
    });
    expect(klingCapability("text_to_video", { configured: true, pricing: off }).state).toBe("admin_disabled");
  });

  it("🔴 a member-facing reason never names a provider (§30)", () => {
    for (const r of klingCapabilityReport({ configured: false, pricing })) {
      if (!r.reason) continue;
      for (const leak of ["kling", "replicate", "fal", "api", "endpoint"]) {
        expect(r.reason.toLowerCase(), `${r.feature} / ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every refusal carries a concrete limitation and a revisit condition", () => {
    for (const p of KLING_UNSUPPORTED_PIPELINES) {
      expect(p.detail.length, p.feature).toBeGreaterThan(200);
      expect(p.revisitWhen.length, p.feature).toBeGreaterThan(20);
      expect(p.memberReason, p.feature).not.toMatch(/\b(TODO|later|for now|not yet implemented)\b/i);
    }
  });
});

describe("§21 — usage is calculated from the ACTUAL request", () => {
  const pricing = livePricing();

  it("the billed length follows the duration the member chose", () => {
    const short = klingTextToVideoPipeline.quote({ prompt: "a cat", options: { aspectRatio: "16:9", durationSeconds: 5 } }, pricing);
    const long = klingTextToVideoPipeline.quote({ prompt: "a cat", options: { aspectRatio: "16:9", durationSeconds: 10 } }, pricing);
    expect(short.ok && short.billableSeconds).toBe(5);
    expect(long.ok && long.billableSeconds).toBe(10);
    if (!long.ok || !short.ok) throw new Error("both quotes should price");
    expect(long.totalUsdCents).toBeGreaterThan(short.totalUsdCents);
  });

  it("the resolution the member chose selects the tier", () => {
    const q = klingTextToVideoPipeline.quote({ prompt: "a cat", options: { aspectRatio: "16:9", durationSeconds: 5, resolution: "1080p" } }, pricing);
    expect(q.ok && q.tier).toBe("text_to_video:1080p");
  });

  it("native audio is billed, and only when asked for", () => {
    const withAudio = normalizeKlingPricing({
      ...pricing,
      matrix: { ...pricing.matrix, "text_to_video:720p": { ...pricing.matrix["text_to_video:720p"], audioSurchargeUsdCentsPerSecond: 5 } },
    });
    const off = klingTextToVideoPipeline.quote({ prompt: "a", options: { aspectRatio: "16:9", durationSeconds: 5 } }, withAudio);
    const on = klingTextToVideoPipeline.quote({ prompt: "a", options: { aspectRatio: "16:9", durationSeconds: 5, audio: "native" } }, withAudio);
    if (!on.ok || !off.ok) throw new Error("both quotes should price");
    expect(on.totalUsdCents).toBeGreaterThan(off.totalUsdCents);
  });

  it("🔴 Lip Sync bills on the MEASURED source length, and refuses without one", () => {
    const measured = klingLipSyncPipeline.quote({ mode: "audio2video", videoUrl: "https://x.test/a.mp4", audioUrl: "https://x.test/a.mp3", sourceSeconds: 8 }, pricing);
    expect(measured.ok && measured.billableSeconds).toBe(8);
    // No measurement = no quote. A browser-claimed duration is never accepted (§26).
    const unmeasured = klingLipSyncPipeline.quote({ mode: "audio2video", videoUrl: "https://x.test/a.mp4", audioUrl: "https://x.test/a.mp3" }, pricing);
    expect(unmeasured.ok).toBe(false);
  });

  it("every pipeline prices through the ONE shared calculator", () => {
    for (const f of KLING_RUNNABLE_FEATURES) {
      const source = code(`lib/ai/kling/pipelines/${f.replace(/_/g, "-")}.ts`);
      expect(source, f).toContain("quoteKling(");
      // no pipeline does its own arithmetic on money
      expect(source, f).not.toMatch(/totalUsdCents\s*=/);
    }
  });
});

describe("§27 — each pipeline validates its own inputs", () => {
  it("Text to Video refuses an empty prompt", () => {
    expect(klingTextToVideoPipeline.validate({ prompt: "  ", options: { aspectRatio: "16:9" } }).ok).toBe(false);
  });

  it("Image to Video refuses a missing or unsafe image", () => {
    expect(klingImageToVideoPipeline.validate({ firstFrameUrl: "" }).ok).toBe(false);
    expect(klingImageToVideoPipeline.validate({ firstFrameUrl: "http://x.test/a.jpg" }).ok).toBe(false);
  });

  it("Lip Sync refuses a request with no speech source", () => {
    expect(klingLipSyncPipeline.validate({ mode: "audio2video", videoUrl: "https://x.test/a.mp4", audioUrl: "" }).ok).toBe(false);
  });

  it("🔴 one feature's input is not accepted by another (the types make it impossible, and so does validation)", () => {
    // A Lip Sync body handed to Text to Video has no prompt at all.
    expect(klingTextToVideoPipeline.validate({ prompt: "" } as never).ok).toBe(false);
    expect(klingPipeline("lip_sync").feature).toBe("lip_sync");
    expect(klingPipeline("text_to_video").feature).toBe("text_to_video");
  });
});
