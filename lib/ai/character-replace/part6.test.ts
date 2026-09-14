import { describe, expect, it } from "vitest";

import { CHARACTER_REPLACE_DEFAULTS, modeConfig, normalizeCharacterReplaceConfig, pricingFingerprint, publicCharacterReplaceConfig, versionCharacterReplacePricing } from "./config";
import { readCharacterReplaceMeta, readPipeline } from "./job-meta";
import { FACE_ONLY_TIER_MAP, SKIN_FACE_PRESERVATION_PROMPT, SKIN_FACE_TIER_MAP, closestSupportedTier, isReplacementMode } from "./modes";
import { advance, canAdvance, markSubmitted, markSucceeded, nextStage, planPipeline, stageName, stageSteps } from "./pipeline";
import { centsForDuration, normalizeQuoteInput, providerCostEstimateUsdCents, quoteCharacterReplace, rateLineFor, tierRateCents, validateQuoteInput, type QuoteInput } from "./pricing";
import { FACE_ONLY_INPUT_FIELDS, buildFaceOnlyInput, XRUNDA_HELLO } from "./providers/face-only";
import { P_VIDEO_REPLACE, SKIN_FACE_INPUT_FIELDS, buildSkinFaceInput } from "./providers/skin-face";
import { createCharacterReplaceJobSchema, startCharacterReplaceJobSchema } from "./start-schema";
import { quoteRequestSchema } from "./quote-schema";
import { quoteCanonical } from "./wallet";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 6 — three replacement modes, one pricing engine, a staged pipeline
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The owner's regression list (Face Only §10, Skin + Face §15, Part 6 §29),
 * as far as it is pure: pricing by mode and tier, duration arithmetic, the
 * quality → provider mapping ("never pretend"), the forged-field refusals,
 * the pipeline's legal moves, and the exact provider payloads. The parts
 * that need a provider, a bucket or a worker are covered by the real-run
 * checklist in the implementation report.
 */

const cfg = normalizeCharacterReplaceConfig({
  ...CHARACTER_REPLACE_DEFAULTS,
  pricePerSecondCents: 2_500,
  basePriceCents: 0,
  minimumChargeCents: 100,
  modes: {
    face_only: { tiers: [{ id: "standard", perSecondCents: 1_500 }] },
    skin_face: { tiers: [{ id: "standard", perSecondCents: 3_000 }, { id: "high", perSecondCents: 6_000 }, { id: "ultra", perSecondCents: 9_000 }] },
  },
  tts: { perRequestCents: 5_000, perCharacterCents: 10 },
  lipSync: [{ id: "standard", perSecondCents: 1_000 }, { id: "studio", perSecondCents: 2_500 }],
});
const money = { currency: "NGN", symbol: "₦", now: new Date("2026-09-14T12:00:00Z") };
const base: QuoteInput = { selectedDurationMs: 12_400, quality: "720p", voiceMode: "original", lipSyncMode: null };

/* ───────────────────────────── modes & the provider mapping ─────────────── */

describe("the mode vocabulary and the tier → provider mapping", () => {
  it("names exactly three modes", () => {
    expect(isReplacementMode("face_only")).toBe(true);
    expect(isReplacementMode("skin_face")).toBe(true);
    expect(isReplacementMode("full_character")).toBe(true);
    expect(isReplacementMode("body_only")).toBe(false);
  });

  it("🔴 Face Only never pretends: xrunda/hello has one configuration, so High and Ultra are unsupported", () => {
    expect(FACE_ONLY_TIER_MAP.standard.support).toBe("supported");
    expect(FACE_ONLY_TIER_MAP.high.support).toBe("unsupported");
    expect(FACE_ONLY_TIER_MAP.ultra.support).toBe("unsupported");
    expect(closestSupportedTier("face_only", "ultra")).toBe("standard");
  });

  it("Skin + Face maps its three tiers onto three REAL p-video-replace configurations, fps untouched", () => {
    expect(SKIN_FACE_TIER_MAP.standard.settings).toEqual({ resolution: "720p", turbo: true, target_fps: "original" });
    expect(SKIN_FACE_TIER_MAP.high.settings).toEqual({ resolution: "720p", turbo: false, target_fps: "original" });
    expect(SKIN_FACE_TIER_MAP.ultra.settings).toEqual({ resolution: "1080p", turbo: false, target_fps: "original" });
    expect(closestSupportedTier("skin_face", "ultra")).toBe("ultra");
  });

  it("the configuration forces an unsupported tier OFF however it was saved, and keeps a supported one", () => {
    const c = normalizeCharacterReplaceConfig({ modes: { face_only: { tiers: [{ id: "high", enabled: true, perSecondCents: 999 }] } } });
    expect(c.modes.face_only.tiers.find((t) => t.id === "high")?.enabled).toBe(false);
    expect(modeConfig(c, "face_only").tiers.find((t) => t.id === "high")).toMatchObject({ enabled: false, supported: false });
    expect(modeConfig(c, "skin_face").tiers.every((t) => t.supported)).toBe(true);
    // reference images are clamped to what the mode can take; a model name is validated as owner/model
    const d = normalizeCharacterReplaceConfig({ modes: { face_only: { maximumReferenceImages: 3, provider: { model: "not a model" } }, skin_face: { maximumReferenceImages: 9 } } });
    expect(d.modes.face_only.maximumReferenceImages).toBe(1);
    expect(d.modes.face_only.provider.model).toBe("xrunda/hello");
    expect(d.modes.skin_face.maximumReferenceImages).toBe(3);
  });

  it("Full Character's mode view is the top-level configuration, unchanged from Part 3", () => {
    const v = modeConfig(cfg, "full_character");
    expect(v.tiers.map((t) => [t.id, t.perSecondCents, t.enabled])).toEqual([
      ["480p", 1_500, true],
      ["720p", 2_500, true],
      ["1080p", 4_000, false],
    ]);
    expect(v.providerModel).toBe("wan-video/wan-2.2-animate-replace");
  });
});

/* ───────────────────────────── pricing, every mode ──────────────────────── */

describe("pricing — duration × the mode's tier rate, one engine", () => {
  it("Face Only Standard: 12.4 s × ₦15/s = ₦186, rate line printed from the integers", () => {
    const q = quoteCharacterReplace({ ...base, mode: "face_only", quality: "standard" }, cfg, money);
    expect(q.mode).toBe("face_only");
    expect(q.qualityRateCents).toBe(1_500);
    expect(q.videoCents).toBe(centsForDuration(1_500, 12_400));
    expect(q.videoCents).toBe(18_600);
    expect(q.totalCents).toBe(18_600);
    expect(q.rateLine).toBe("12.4s × ₦15.00/s = ₦186.00");
    expect(q.lines.find((l) => l.key === "character")).toMatchObject({ label: "Face replacement", value: "Face Only" });
  });

  it("Skin + Face High: 12.5 s × ₦60/s = ₦750 (the brief's example)", () => {
    const q = quoteCharacterReplace({ ...base, selectedDurationMs: 12_500, mode: "skin_face", quality: "high" }, cfg, money);
    expect(q.videoCents).toBe(75_000);
    expect(rateLineFor(12_500, 6_000, 75_000, "₦")).toBe("12.5s × ₦60.00/s = ₦750.00");
    expect(tierRateCents(cfg, "skin_face", "ultra")).toBe(9_000);
  });

  it("Full Character prices exactly as before Part 6 — mode absent = full_character", () => {
    const before = quoteCharacterReplace(base, cfg, money);
    const explicit = quoteCharacterReplace({ ...base, mode: "full_character" }, cfg, money);
    expect(before.totalCents).toBe(explicit.totalCents);
    expect(before.mode).toBe("full_character");
    expect(before.videoCents).toBe(31_000);
    expect(normalizeQuoteInput(base).mode).toBe("full_character");
  });

  it("a new voice from text adds the per-request and per-character fees; lip sync adds its tier per second", () => {
    const q = quoteCharacterReplace({ ...base, voiceMode: "new_voice", voiceSource: "tts", ttsCharacters: 120, lipSyncMode: "studio" }, cfg, money);
    expect(q.ttsRequestCents).toBe(5_000);
    expect(q.ttsCharacterRateCents).toBe(10);
    expect(q.voiceCents).toBe(5_000 + 120 * 10);
    expect(q.lipSyncCents).toBe(centsForDuration(2_500, 12_400));
    expect(q.totalCents).toBe(31_000 + 6_200 + 31_000);
    const upload = quoteCharacterReplace({ ...base, voiceMode: "new_voice", voiceSource: "upload", lipSyncMode: null }, cfg, money);
    expect(upload.voiceCents).toBe(0);
    expect(upload.lipSyncCents).toBe(0);
  });

  it("🔴 refuses: a tier the provider cannot honour, a disabled mode, a dialogue outside the bounds, lip sync past its ceiling", () => {
    expect(validateQuoteInput({ ...base, mode: "face_only", quality: "high" }, cfg).ok).toBe(false);
    expect(validateQuoteInput({ ...base, mode: "face_only", quality: "720p" }, cfg).ok).toBe(false);
    expect(validateQuoteInput({ ...base, mode: "skin_face", quality: "ultra" }, cfg).ok).toBe(true);
    const off = normalizeCharacterReplaceConfig({ ...cfg, modes: { face_only: { enabled: false } } });
    expect(validateQuoteInput({ ...base, mode: "face_only", quality: "standard" }, off).ok).toBe(false);
    expect(validateQuoteInput({ ...base, mode: "skin_face", quality: "standard" }, off).ok).toBe(true);
    expect(validateQuoteInput({ ...base, voiceMode: "new_voice", voiceSource: "tts", ttsCharacters: 0 }, cfg).ok).toBe(false);
    expect(validateQuoteInput({ ...base, voiceMode: "new_voice", voiceSource: "tts", ttsCharacters: 5_000 }, cfg).ok).toBe(false);
    const shortLip = normalizeCharacterReplaceConfig({ ...cfg, lipSyncMaximumDurationSeconds: 10 });
    expect(validateQuoteInput({ ...base, voiceMode: "new_voice", voiceSource: "upload", lipSyncMode: "standard" }, shortLip).ok).toBe(false);
    expect(validateQuoteInput({ ...base, selectedDurationMs: 9_000, voiceMode: "new_voice", voiceSource: "upload", lipSyncMode: "standard" }, shortLip).ok).toBe(true);
  });

  it("a mode's own duration ceiling applies", () => {
    const tight = normalizeCharacterReplaceConfig({ ...cfg, modes: { face_only: { maximumDurationSeconds: 5 } } });
    expect(validateQuoteInput({ ...base, mode: "face_only", quality: "standard" }, tight).ok).toBe(false);
    expect(validateQuoteInput({ ...base, selectedDurationMs: 5_000, mode: "face_only", quality: "standard" }, tight).ok).toBe(true);
  });

  it("the provider cost estimate is the operator's, in US cents, never on the quote", () => {
    expect(providerCostEstimateUsdCents({ ...base, mode: "skin_face", quality: "high" }, cfg, () => 0)).toBeNull();
    const est = normalizeCharacterReplaceConfig({ ...cfg, modes: { skin_face: { providerCostPerSecondUsdCents: 4 } } });
    expect(providerCostEstimateUsdCents({ ...base, mode: "skin_face", quality: "high" }, est, () => 0)).toEqual({ replaceUsdCents: 50, lipSyncUsdCents: 0, totalUsdCents: 50 });
    expect(providerCostEstimateUsdCents({ ...base, mode: "skin_face", quality: "high", voiceMode: "new_voice", voiceSource: "upload", lipSyncMode: "studio" }, est, () => 8.325)).toMatchObject({ lipSyncUsdCents: 104 });
    const q = quoteCharacterReplace({ ...base, mode: "skin_face", quality: "high" }, est, money) as unknown as Record<string, unknown>;
    expect(JSON.stringify(q)).not.toMatch(/provider|usd/i);
  });

  it("the fingerprint moves with a mode rate or a TTS fee — a pricing version bump — and the history records who and why", () => {
    const a = pricingFingerprint(cfg);
    expect(pricingFingerprint(normalizeCharacterReplaceConfig({ ...cfg, modes: { face_only: { tiers: [{ id: "standard", perSecondCents: 1_501 }] } } }))).not.toBe(a);
    expect(pricingFingerprint(normalizeCharacterReplaceConfig({ ...cfg, tts: { perCharacterCents: 11 } }))).not.toBe(a);
    expect(pricingFingerprint(normalizeCharacterReplaceConfig({ ...cfg, audio: { maximumDurationSeconds: 30 } }))).toBe(a);
    const next = normalizeCharacterReplaceConfig({ ...cfg, tts: { perCharacterCents: 11 } });
    const versioned = versionCharacterReplacePricing(cfg, next, { changedBy: "admin-1", reason: "TTS cost went up" });
    expect(versioned.pricingVersion).toBe(cfg.pricingVersion + 1);
    expect(versioned.pricingHistory.at(-1)).toMatchObject({ version: cfg.pricingVersion, changedBy: "admin-1", reason: "TTS cost went up" });
  });
});

/* ───────────────────────────── the signature covers the new fields ──────── */

describe("the signed quote — a forged mode, source or dialogue length changes the canonical form", () => {
  const q = quoteCharacterReplace({ ...base, mode: "face_only", quality: "standard" }, cfg, money);
  it("differs by mode, voice source and character count; a pre-Part-6 quote canonicalises exactly as before", () => {
    const a = quoteCanonical(q);
    expect(quoteCanonical({ ...q, mode: "skin_face" })).not.toBe(a);
    expect(quoteCanonical({ ...q, voiceSource: "tts" })).not.toBe(a);
    expect(quoteCanonical({ ...q, ttsCharacters: 40 })).not.toBe(a);
    const old = quoteCharacterReplace(base, cfg, money);
    expect(quoteCanonical(old)).toBe(JSON.stringify({ p: "character_replace", v: cfg.pricingVersion, d: 12_400, q: "720p", vm: "original", ls: null, t: old.totalCents, c: "NGN", e: old.expiresAt }));
  });
});

/* ───────────────────────────── the provider payloads ────────────────────── */

describe("provider payloads — exactly the documented fields, nothing invented", () => {
  it("xrunda/hello: source + target, pinned", () => {
    const input = buildFaceOnlyInput({ videoUrl: "https://x/v.mp4", faceImageUrl: "https://x/f.jpg" });
    expect(Object.keys(input).sort()).toEqual([...FACE_ONLY_INPUT_FIELDS].sort());
    expect(input).toEqual({ source: "https://x/v.mp4", target: "https://x/f.jpg" });
    expect(XRUNDA_HELLO.version).toMatch(/^[0-9a-f]{64}$/);
    expect(() => buildFaceOnlyInput({ videoUrl: "http://x/v.mp4", faceImageUrl: "https://x/f.jpg" })).toThrow();
  });

  it("p-video-replace: video, 1–3 images, the owner's preservation prompt verbatim, the tier's settings, save_audio", () => {
    const input = buildSkinFaceInput({ videoUrl: "https://x/v.mp4", imageUrls: ["https://x/1.jpg", "https://x/2.jpg"], settings: SKIN_FACE_TIER_MAP.ultra.settings!, saveAudio: true });
    expect(Object.keys(input).sort()).toEqual([...SKIN_FACE_INPUT_FIELDS].sort());
    expect(input.images).toHaveLength(2);
    expect(input.instruction_prompt).toBe(SKIN_FACE_PRESERVATION_PROMPT);
    expect(input.instruction_prompt).toMatch(/Do not redesign, recolor, regenerate or replace the clothing/);
    expect(input).toMatchObject({ resolution: "1080p", turbo: false, target_fps: "original", save_audio: true });
    expect(JSON.stringify(input)).not.toMatch(/seed|no_op|disable_safety_checker|ignore_audio/);
    expect(P_VIDEO_REPLACE.version).toMatch(/^[0-9a-f]{64}$/);
    expect(() => buildSkinFaceInput({ videoUrl: "https://x/v.mp4", imageUrls: [], settings: SKIN_FACE_TIER_MAP.standard.settings!, saveAudio: false })).toThrow();
    expect(buildSkinFaceInput({ videoUrl: "https://x/v.mp4", imageUrls: ["https://x/1.jpg", "https://x/2.jpg", "https://x/3.jpg", "https://x/4.jpg"], settings: SKIN_FACE_TIER_MAP.standard.settings!, saveAudio: false }).images).toHaveLength(3);
  });
});

/* ───────────────────────────── the pipeline ─────────────────────────────── */

describe("the pipeline — planned once, moved only forward", () => {
  it("plans the stages from the settings", () => {
    expect(planPipeline({ mode: "full_character", voiceMode: "original", voiceSource: null, lipSyncMode: null }).stages).toEqual(["replace", "finalize"]);
    expect(planPipeline({ mode: "face_only", voiceMode: "new_voice", voiceSource: "upload", lipSyncMode: null }).stages).toEqual(["replace", "finalize"]);
    expect(planPipeline({ mode: "face_only", voiceMode: "new_voice", voiceSource: "upload", lipSyncMode: "studio" }).stages).toEqual(["replace", "lipsync", "finalize"]);
    expect(planPipeline({ mode: "skin_face", voiceMode: "new_voice", voiceSource: "tts", lipSyncMode: "standard" }).stages).toEqual(["voice", "replace", "lipsync", "finalize"]);
    expect(planPipeline({ mode: "skin_face", voiceMode: "new_voice", voiceSource: "tts", lipSyncMode: null }).stages).toEqual(["voice", "replace", "finalize"]);
  });

  it("🔴 LIPSYNC → REPLACE is impossible; only the next stage of the plan, and only after success", () => {
    let p = planPipeline({ mode: "skin_face", voiceMode: "new_voice", voiceSource: "tts", lipSyncMode: "standard" });
    expect(canAdvance(p, "voice", "replace")).toBe(false); // not succeeded yet
    p = markSubmitted(p, "voice", { predictionId: "p1", provider: { id: "replicate", model: "minimax/speech-02-hd", version: "v" }, at: "2026-09-14T12:00:00Z" });
    p = markSucceeded(p, "voice", "https://replicate.delivery/a.wav", "2026-09-14T12:01:00Z");
    expect(p.pending_advance).toBe("voice");
    expect(canAdvance(p, "voice", "lipsync")).toBe(false); // skipping
    expect(canAdvance(p, "voice", "replace")).toBe(true);
    const moved = advance(p, "voice", "replace", "u/f/j/voice-prepared.wav")!;
    expect(moved.current).toBe("replace");
    expect(moved.pending_advance).toBeNull();
    expect(moved.records.voice?.storedPath).toBe("u/f/j/voice-prepared.wav");
    expect(advance(moved, "lipsync", "replace", null)).toBeNull(); // backwards
    expect(advance(moved, "replace", "lipsync", null)).toBeNull(); // replace not succeeded
    const r = markSucceeded(markSubmitted(moved, "replace", { predictionId: "p2", provider: { id: "replicate", model: "prunaai/p-video-replace", version: "v" }, at: "t" }), "replace", "https://replicate.delivery/b.mp4", "t");
    expect(nextStage(r, "replace")).toBe("lipsync");
    const l = advance(r, "replace", "lipsync", "u/f/j/replaced.mp4")!;
    const done = markSucceeded(markSubmitted(l, "lipsync", { predictionId: "p3", provider: { id: "replicate", model: "sync/lipsync-2", version: "v" }, at: "t" }), "lipsync", "https://replicate.delivery/c.mp4", "t");
    // the last provider stage owes no advance — the finalizer takes it
    expect(done.pending_advance).toBeNull();
  });

  it("names the owner's states and words the tracker per mode", () => {
    const p = markSubmitted(planPipeline({ mode: "face_only", voiceMode: "new_voice", voiceSource: "tts", lipSyncMode: "studio" }), "voice", { predictionId: "p", provider: { id: "replicate", model: "m", version: null }, at: "t" });
    expect(stageName({ status: "processing", pipeline: p, refund: "none" })).toBe("AUDIO_GENERATION_QUEUED");
    expect(stageName({ status: "failed", pipeline: p, refund: "pending" })).toBe("REFUND_PENDING");
    expect(stageName({ status: "failed", pipeline: p, refund: "refunded" })).toBe("REFUNDED");
    expect(stageName({ status: "finalizing", pipeline: p, refund: "none" })).toBe("FINALIZING");
    expect(stageName({ status: "processing", pipeline: null, refund: "none" })).toBe("CHARACTER_REPLACEMENT_QUEUED");
    const steps = stageSteps({ status: "processing", pipeline: p, mode: "face_only" });
    expect(steps.map((s) => s.key)).toEqual(["prepare", "voice", "replace", "lipsync", "finalize"]);
    expect(steps.map((s) => s.state)).toEqual(["done", "doing", "todo", "todo", "todo"]);
    expect(steps.find((s) => s.key === "replace")?.label).toBe("Replacing the face");
    expect(stageSteps({ status: "complete", pipeline: p, mode: "skin_face" }).every((s) => s.state === "done")).toBe(true);
    // no percentage anywhere in a step
    expect(JSON.stringify(steps)).not.toMatch(/%/);
  });
});

/* ───────────────────────────── the row contract ─────────────────────────── */

describe("the job metadata — every Part 1–5 row still reads, as a Full Character job", () => {
  const legacy = {
    tool: "character_replace",
    attempt: 1,
    character: { path: "u/aicharacterreplace/j/character.jpg", mime: "image/jpeg", size: 1, width: 900, height: 1600 },
    video: { path: "u/aicharacterreplace/j/source.mp4", mime: "video/mp4", size: 1, durationMs: 10_000, width: 720, height: 1280, hasAudio: true },
    trim: null,
    settings: { quality: "720p", voiceMode: "original", lipSyncMode: null },
    quote: null,
    prepared: null,
    provider: null,
  };
  it("defaults mode, references, audio and pipeline", () => {
    const m = readCharacterReplaceMeta(legacy)!;
    expect(m.mode).toBe("full_character");
    expect(m.references).toEqual([]);
    expect(m.audio).toBeNull();
    expect(m.pipeline).toBeNull();
    expect(readPipeline(legacy)).toBeNull();
  });
  it("reads a Part 6 row with its stages", () => {
    const m = readCharacterReplaceMeta({ ...legacy, mode: "skin_face", references: [{ ...legacy.character, path: "u/aicharacterreplace/j/character-2.jpg" }], settings: { quality: "high", voiceMode: "new_voice", lipSyncMode: "studio" }, audio: { source: "tts", tts: { text: "hi", languageCode: "en", voiceId: "warm", providerVoiceId: "English_Wiselady" }, trimToFit: false, voiceConsent: false, prepared: null }, pipeline: planPipeline({ mode: "skin_face", voiceMode: "new_voice", voiceSource: "tts", lipSyncMode: "studio" }) })!;
    expect(m.mode).toBe("skin_face");
    expect(m.references).toHaveLength(1);
    expect(m.audio?.source).toBe("tts");
    expect(readPipeline({ pipeline: m.pipeline })?.stages).toEqual(["voice", "replace", "lipsync", "finalize"]);
  });
});

/* ───────────────────────────── the public config & the schemas ──────────── */

describe("what the browser is told, and what it may say back", () => {
  it("the public config carries the modes with their tiers' support, the audio ceilings, and only the languages the provider speaks", () => {
    const pub = publicCharacterReplaceConfig(CHARACTER_REPLACE_DEFAULTS, { code: "NGN", symbol: "₦" }, true);
    expect(pub.modes.map((m) => m.id)).toEqual(["face_only", "skin_face", "full_character"]);
    const face = pub.modes.find((m) => m.id === "face_only")!;
    expect(face.tiers.map((t) => [t.id, t.enabled, t.supported])).toEqual([["standard", true, true], ["high", false, false], ["ultra", false, false]]);
    expect(face.defaultTier).toBe("standard");
    expect(pub.modes.find((m) => m.id === "skin_face")?.defaultTier).toBe("high");
    expect(pub.defaultMode).toBe("full_character");
    expect(pub.tts.languages).toContain("en");
    expect(pub.tts.languages).toContain("hi");
    expect(pub.tts.languages).not.toContain("yo"); // MiniMax does not speak Yoruba — never offered as a fake
    expect(pub.audio.maximumDurationSeconds).toBe(120);
    expect(JSON.stringify(pub)).not.toMatch(/perSecondCents|providerCost|perCharacterCents|minimax|sync\/lipsync|xrunda|prunaai/);
  });

  it("the quote body accepts the new fields and still refuses a price; the start body carries the voice, and the create body the references and the audio", () => {
    expect(quoteRequestSchema.safeParse({ selectedDurationMs: 12_400, mode: "skin_face", quality: "high", voiceMode: "new_voice", voiceSource: "tts", ttsCharacters: 40, lipSyncMode: "studio" }).success).toBe(true);
    expect(quoteRequestSchema.safeParse({ selectedDurationMs: 12_400, quality: "720p", voiceMode: "original", lipSyncMode: null, price: 1 }).success).toBe(false);
    expect(quoteRequestSchema.safeParse({ selectedDurationMs: 12_400, mode: "body", quality: "720p", voiceMode: "original", lipSyncMode: null }).success).toBe(false);
    const start = startCharacterReplaceJobSchema.safeParse({
      quote: { id: "x".repeat(20), product: "character_replace", currency: "NGN", pricingConfigVersion: 1, durationMs: 12_400, mode: "face_only", quality: "standard", voiceMode: "new_voice", voiceSource: "tts", ttsCharacters: 12, lipSyncMode: null, totalCents: 18_600, expiresAt: "2026-09-14T12:10:00.000Z" },
      trim: null,
      consent: true,
      voice: { source: "tts", text: "Hello world!", languageCode: "en", voiceId: "warm" },
    });
    expect(start.success).toBe(true);
    const photo = { name: "a.jpg", mimeType: "image/jpeg", size: 10, width: 900, height: 1600 };
    const create = createCharacterReplaceJobSchema.safeParse({
      clientRequestId: "req-123456789",
      mode: "skin_face",
      photo,
      references: [photo, photo],
      video: { name: "v.mp4", mimeType: "video/mp4", size: 10, durationMs: 10_000, width: 720, height: 1280, hasAudio: true },
      audio: { name: "v.mp3", mimeType: "audio/mpeg", size: 10, durationMs: 9_000 },
    });
    expect(create.success).toBe(true);
    expect(createCharacterReplaceJobSchema.safeParse({ clientRequestId: "req-123456789", photo, references: [photo, photo, photo], video: { name: "v.mp4", mimeType: "video/mp4", size: 10, durationMs: 10_000, width: 720, height: 1280, hasAudio: true } }).success).toBe(false);
  });
});
