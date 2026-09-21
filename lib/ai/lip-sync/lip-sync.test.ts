import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FAL_SYNC_LIPSYNC_PATTERN, isAllowedLipSyncModel, lipSyncPriceLine, normalizeLipSyncConfig, versionLipSyncConfig } from "./config";
import { readLipSyncMeta } from "./job-meta";
import { estimateSpeechMs, lipSyncCredits, lipSyncQuoteCanonical, publicLipSyncQuote, quoteLipSync, verifyLipSyncQuote } from "./pricing";
import { buildKlingLipSyncInput, KLING_LIP_SYNC_INPUT_FIELDS, KLING_VOICES } from "./providers/kling-lipsync";
import { buildSyncLabsProInput, SYNC_LABS_INPUT_FIELDS } from "./providers/sync-labs";
import { createLipSyncJobSchema, startLipSyncJobSchema } from "./schemas";
import { AI_PLANS_DEFAULTS } from "../credits/config";
import { buildPrepareArgs, isKnownPrepareArg } from "../character-replace/ffmpeg";
import { AI_FEATURES, WALLET_FUNDED_FEATURES, isWalletFundedFeature, jobToView, type AiJobRow } from "../jobs";
import { buildTempoArgs, isKnownTempoArg, tempoFilter } from "../voice/audio-tempo";
import { decideAudioFit } from "../voice/audio-validate";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

process.env.AI_QUOTE_SIGNING_SECRET ??= "test-signing-secret";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LIP SYNC PRO (2026-09-21, migration 0169) — pinned
 * ═══════════════════════════════════════════════════════════════════════════
 */

describe("the feature and its funding", () => {
  it("ai_lip_sync is registered, wallet-funded like Character Replace, and the migration widens the check LAST", () => {
    expect(AI_FEATURES.find((f) => f.id === "ai_lip_sync")).toMatchObject({ label: "Lip Sync Pro", needsFinalizer: true, freeDailyJobs: 0 });
    expect(WALLET_FUNDED_FEATURES).toEqual(["ai_character_replace", "ai_lip_sync"]);
    expect(isWalletFundedFeature("ai_lip_sync")).toBe(true);
    expect(isWalletFundedFeature("ai_clean")).toBe(false);
    const sql = src("supabase/migrations/0169_ai_lip_sync_feature.sql");
    expect(sql).toContain("'ai_lip_sync'");
    expect(sql).toContain(") not valid;");
    expect(sql.trimEnd().split("\n").filter((l) => l.startsWith("alter")).pop()).toContain("validate constraint ai_jobs_feature_chk");
  });
  it("every branch that used to name Character Replace alone asks isWalletFundedFeature (funding, recovery, stall, webhook, reconcile, cancel, the read routes)", () => {
    for (const f of ["lib/ai/funding.ts", "lib/ai/recovery.ts", "lib/ai/stall-server.ts", "lib/ai/webhook-handler.ts", "lib/ai/reconcile.ts", "app/api/ai/jobs/[id]/cancel/route.ts", "app/api/ai/jobs/route.ts", "app/api/ai/jobs/[id]/route.ts"]) {
      expect(code(f), f).toContain("isWalletFundedFeature(");
    }
    expect(code("app/api/internal/ai/prepare/route.ts")).toContain("prepareLipSyncJob");
    expect(code("app/api/internal/ai/finalize/route.ts")).toContain('featureId === "ai_lip_sync"');
    expect(code("lib/ai/submit.ts")).toContain("submitLipSyncJob(job, opts)");
    expect(code("lib/ai/notify.ts")).toContain("/studio/ai/lip-sync/result/");
  });
});

describe("the configuration — the switch, the models, the locks", () => {
  it("defaults: Replicate active with Sync Labs lipsync-2-pro; fal.ai = Sync-3 with its listed cost; both speech sources on; ElevenLabs for text", () => {
    const c = normalizeLipSyncConfig(null);
    expect(c.provider).toBe("replicate");
    expect(c.models.replicate.model).toBe("sync/lipsync-2-pro");
    expect(c.models.fal.model).toBe("fal-ai/sync-lipsync/v3");
    expect(c.models.fal.providerCostPerSecondUsdCents).toBeCloseTo(13.33);
    expect(c.textMode.enabled && c.audioMode.enabled).toBe(true);
    expect(c.tts.provider).toBe("elevenlabs");
  });
  it("the fal.ai switch takes Sync-3 or a higher Sync Labs endpoint, never anything else; the voice provider stays ElevenLabs whatever a patch says", () => {
    expect(isAllowedLipSyncModel("fal", "fal-ai/sync-lipsync/v3")).toBe(true);
    expect(isAllowedLipSyncModel("fal", "fal-ai/sync-lipsync/v3.5")).toBe(true);
    expect(isAllowedLipSyncModel("fal", "fal-ai/sync-lipsync/v4/pro")).toBe(true);
    expect(isAllowedLipSyncModel("fal", "fal-ai/sync-lipsync/v2")).toBe(false);
    expect(isAllowedLipSyncModel("fal", "fal-ai/kling-video/lipsync/text-to-video")).toBe(false);
    expect(FAL_SYNC_LIPSYNC_PATTERN.test("fal-ai/sync-lipsync/v10")).toBe(true);
    const c = normalizeLipSyncConfig({ provider: "fal", models: { fal: { model: "fal-ai/pixverse/lipsync" }, replicate: { model: "kwaivgi/kling-lip-sync" } }, tts: { provider: "fal", model: "elevenlabs/eleven_v3" } });
    expect(c.provider).toBe("fal");
    expect(c.models.fal.model).toBe("fal-ai/sync-lipsync/v3");
    expect(c.models.replicate.model).toBe("kwaivgi/kling-lip-sync");
    expect(c.tts.provider).toBe("elevenlabs");
  });
  it("the pricing version bumps on a price, the version on any change, neither on a re-save", () => {
    const a = normalizeLipSyncConfig(null);
    const same = versionLipSyncConfig(a, normalizeLipSyncConfig(a));
    expect([same.version, same.pricingVersion]).toEqual([a.version, a.pricingVersion]);
    const priced = versionLipSyncConfig(a, normalizeLipSyncConfig({ ...a, models: { ...a.models, fal: { ...a.models.fal, perSecondCents: 40 } } }));
    expect(priced.pricingVersion).toBe(a.pricingVersion + 1);
    const routed = versionLipSyncConfig(a, normalizeLipSyncConfig({ ...a, provider: "fal" }));
    expect([routed.version, routed.pricingVersion]).toEqual([a.version + 1, a.pricingVersion]);
  });
  it("the price line is a sentence, not a rate", () => {
    expect(lipSyncPriceLine(25, 0, "$")).toBe("from $0.25/sec");
    expect(lipSyncPriceLine(25, 100, "$")).toBe("from $0.25/sec + $1 per video");
    expect(lipSyncPriceLine(0, 0, "$")).toBeNull();
  });
});

describe("exactly one speech source (§3)", () => {
  const video = { name: "a.mp4", mimeType: "video/mp4", size: 1000, durationMs: 5000, width: 1280, height: 720 };
  it("text parses, audio parses, both do not, neither does not", () => {
    expect(createLipSyncJobSchema.safeParse({ clientRequestId: "abcdefghij", video, speech: { source: "text", text: "Hello" } }).success).toBe(true);
    expect(createLipSyncJobSchema.safeParse({ clientRequestId: "abcdefghij", video, speech: { source: "audio", audio: { name: "a.mp3", mimeType: "audio/mpeg", size: 100, durationMs: 4000 } } }).success).toBe(true);
    expect(createLipSyncJobSchema.safeParse({ clientRequestId: "abcdefghij", video, speech: { source: "text", text: "Hello", audio: { name: "a.mp3", mimeType: "audio/mpeg", size: 100, durationMs: 4000 } } }).success).toBe(false);
    expect(createLipSyncJobSchema.safeParse({ clientRequestId: "abcdefghij", video, speech: { source: "audio", text: "Hello" } }).success).toBe(false);
    expect(createLipSyncJobSchema.safeParse({ clientRequestId: "abcdefghij", video }).success).toBe(false);
    expect(createLipSyncJobSchema.safeParse({ clientRequestId: "abcdefghij", video, speech: {} }).success).toBe(false);
  });
  it("the row's contract is the same union — a row cannot carry both", () => {
    const base = { tool: "lip_sync", attempt: 1, video: { path: "u/ai_lip_sync/j/source.mp4", mime: "video/mp4", size: 1, durationMs: 5000, width: 1280, height: 720 }, settings: { expression: null, activeSpeaker: false, durationPolicy: "provider_sync_mode" }, trim: null, quote: null, prepared: null, audio: null, pipeline: null };
    expect(readLipSyncMeta({ ...base, speech: { source: "text", text: "hi", voiceId: null, providerVoiceId: null, languageCode: null, speed: 1, path: null } })).not.toBeNull();
    expect(readLipSyncMeta({ ...base, speech: { source: "audio", upload: { path: "u/ai_lip_sync/j/voice.mp3", mime: "audio/mpeg", size: 1, durationMs: null, name: "v.mp3" } } })).not.toBeNull();
    expect(readLipSyncMeta({ ...base, speech: { source: "text", upload: { path: "x", mime: "audio/mpeg", size: 1, durationMs: null, name: "v" } } })).toBeNull();
  });
  it("the start body echoes the signed quote fields only — no vendor, no model, no price a client could set unsigned", () => {
    const ok = startLipSyncJobSchema.safeParse({ quote: { id: "x".repeat(20), durationMs: 5000, speechSource: "text", speechPath: "tts", textCharacters: 12, routeKey: "abcdefghijkl", totalCents: 125, currency: "USD", pricingConfigVersion: 1, expiresAt: new Date().toISOString() }, trim: null, consent: true });
    expect(ok.success).toBe(true);
    expect(startLipSyncJobSchema.safeParse({ quote: { id: "x".repeat(20), durationMs: 5000, speechSource: "text", speechPath: "tts", textCharacters: 12, routeKey: "abcdefghijkl", totalCents: 125, currency: "USD", pricingConfigVersion: 1, expiresAt: "2026", vendor: "fal" }, trim: null, consent: true }).success).toBe(false);
  });
});

describe("the price and the credits (§10, §11)", () => {
  const cfg = normalizeLipSyncConfig({ models: { replicate: { perSecondCents: 25 } }, tts: { perRequestCents: 50, perCharacterCents: 1, providerCostPerCharacterUsdCents: 0.03 }, basePriceCents: 0 });
  it("audio: lip-sync line only; text through the voice provider: + the TTS lines; text on a native model: no TTS line", () => {
    const audio = quoteLipSync({ durationMs: 10_000, speechSource: "audio", speechPath: "audio", textCharacters: 0 }, cfg, { currency: "USD" });
    expect(audio.totalCents).toBe(250);
    expect(audio.ttsCents).toBe(0);
    expect(audio.lines.map((l) => l.key)).toEqual(["lipsync"]);
    const tts = quoteLipSync({ durationMs: 10_000, speechSource: "text", speechPath: "tts", textCharacters: 100 }, cfg, { currency: "USD" });
    expect(tts.totalCents).toBe(250 + 50 + 100);
    expect(tts.ttsCents).toBe(150);
    expect(tts.providerCostEstimate.ttsUsdCents).toBe(3);
    const native = quoteLipSync({ durationMs: 10_000, speechSource: "text", speechPath: "native", textCharacters: 100 }, cfg, { currency: "USD" });
    expect(native.totalCents).toBe(250);
    expect(native.ttsCents).toBe(0);
  });
  it("the fal.ai side prices by ITS rate and carries its cost estimate", () => {
    const fal = normalizeLipSyncConfig({ provider: "fal", models: { fal: { perSecondCents: 40 } } });
    const q = quoteLipSync({ durationMs: 60_000, speechSource: "audio", speechPath: "audio", textCharacters: 0 }, fal, { currency: "USD" });
    expect(q.totalCents).toBe(2400);
    expect(q.vendor).toBe("fal");
    expect(q.providerCostEstimate.lipSyncUsdCents).toBeCloseTo(799.8, 0);
  });
  it("the quote is signed over the priced facts and an opaque route key; the public view carries no vendor, model or cost estimate", () => {
    const q = quoteLipSync({ durationMs: 10_000, speechSource: "audio", speechPath: "audio", textCharacters: 0 }, cfg, { currency: "USD" });
    expect(verifyLipSyncQuote(q)).toBe(true);
    expect(verifyLipSyncQuote({ ...q, totalCents: q.totalCents - 1 })).toBe(false);
    expect(verifyLipSyncQuote({ ...q, routeKey: "othersothers" })).toBe(false);
    const canonical = lipSyncQuoteCanonical(q);
    expect(canonical).not.toContain("sync/lipsync");
    expect(canonical).not.toContain("replicate");
    const pub = publicLipSyncQuote(q) as Record<string, unknown>;
    expect(pub.vendor).toBeUndefined();
    expect(pub.model).toBeUndefined();
    expect(pub.providerCostEstimate).toBeUndefined();
    expect(pub.routeKey).toBe(q.routeKey);
  });
  it("credits come from the one engine, feature ai_lip_sync, the model multiplier applied", () => {
    const q = quoteLipSync({ durationMs: 10_000, speechSource: "audio", speechPath: "audio", textCharacters: 0 }, cfg, { currency: "USD" });
    const credits = lipSyncCredits(q, cfg, AI_PLANS_DEFAULTS);
    expect(credits.feature).toBe("ai_lip_sync");
    expect(credits.creditsRequired).toBe(Math.ceil(250 / AI_PLANS_DEFAULTS.credits.centsPerCredit));
    const doubled = lipSyncCredits(q, normalizeLipSyncConfig({ ...cfg, models: { ...cfg.models, replicate: { ...cfg.models.replicate, creditMultiplier: 2 } } }), AI_PLANS_DEFAULTS);
    expect(doubled.creditsRequired).toBe(credits.creditsRequired * 2);
  });
  it("the speech estimate is ~15 characters a second, faster at a higher speed", () => {
    expect(estimateSpeechMs(150, 1)).toBe(10_000);
    expect(estimateSpeechMs(150, 2)).toBe(5_000);
  });
});

describe("the adapters send only what their live schema names (§4, §12, §17)", () => {
  const base = { videoUrl: "https://x/v.mp4", syncMode: "silence" as const, temperature: 0.8, activeSpeaker: true, facts: null, audioFacts: null };
  it("Sync Labs: video · audio · sync_mode · temperature · active_speaker — and refuses text", () => {
    const input = buildSyncLabsProInput({ ...base, speech: { kind: "audio", audioUrl: "https://x/a.wav" } });
    expect(Object.keys(input).sort()).toEqual([...SYNC_LABS_INPUT_FIELDS].sort());
    expect(input).toMatchObject({ sync_mode: "silence", temperature: 0.8, active_speaker: true });
    expect(() => buildSyncLabsProInput({ ...base, speech: { kind: "text", text: "hi", providerVoiceId: null, languageCode: null, speed: 1 } })).toThrow(/audio, not text/);
    expect(buildSyncLabsProInput({ ...base, temperature: null, activeSpeaker: null, speech: { kind: "audio", audioUrl: "https://x/a.wav" } })).toEqual({ video: "https://x/v.mp4", audio: "https://x/a.wav", sync_mode: "silence" });
  });
  it("Kling Lip Sync: text → text + voice_id + voice_speed (never audio_file); audio → audio_file (never text); its window is enforced", () => {
    const text = buildKlingLipSyncInput({ ...base, speech: { kind: "text", text: "Hello there", providerVoiceId: "en_uk_man2", languageCode: "en", speed: 1.5 } });
    expect(text).toEqual({ video_url: "https://x/v.mp4", text: "Hello there", voice_id: "en_uk_man2", voice_speed: 1.5 });
    const audio = buildKlingLipSyncInput({ ...base, speech: { kind: "audio", audioUrl: "https://x/a.mp3" } });
    expect(audio).toEqual({ video_url: "https://x/v.mp4", audio_file: "https://x/a.mp3" });
    for (const k of Object.keys({ ...text, ...audio })) expect(KLING_LIP_SYNC_INPUT_FIELDS).toContain(k);
    // an unknown voice falls to the schema's default; the speed is clamped to 0.8–2.0
    expect(buildKlingLipSyncInput({ ...base, speech: { kind: "text", text: "x", providerVoiceId: "not-a-voice", languageCode: null, speed: 5 } })).toMatchObject({ voice_id: "en_AOT", voice_speed: 2 });
    expect(() => buildKlingLipSyncInput({ ...base, facts: { durationMs: 12_000, width: 1280, height: 720, bytes: 1 }, speech: { kind: "audio", audioUrl: "https://x/a.mp3" } })).toThrow(/2–10 s/);
    expect(() => buildKlingLipSyncInput({ ...base, facts: { durationMs: 5_000, width: 640, height: 360, bytes: 1 }, speech: { kind: "audio", audioUrl: "https://x/a.mp3" } })).toThrow(/720–1920/);
    expect(KLING_VOICES.some((v) => v.id === "en_AOT")).toBe(true);
  });
  it("no adapter forces text into an audio-only model: the router plans text → native only where supports_text is true", () => {
    const router = code("lib/ai/lip-sync/providers/router.ts");
    expect(router).toContain('return adapter?.capabilities.supports_text ? "native" : "tts"');
    expect(code("lib/ai/lip-sync/providers/fal-sync3.ts")).toContain("Sync-3 takes audio, not text");
  });
});

describe("the worker's fit and the speed (§1, §7)", () => {
  it("the atempo plan: constants, two paths and a formatted filter; two stages past 2×", () => {
    const plan = { input: "/tmp/in.mp3", output: "/tmp/out.wav", speed: 1.5 };
    const args = buildTempoArgs(plan);
    for (const a of args) expect(isKnownTempoArg(a, plan)).toBe(true);
    expect(args).toContain("atempo=1.50");
    expect(tempoFilter(2.5)).toMatch(/^atempo=1\.581,atempo=1\.581$/);
    expect(() => buildTempoArgs({ ...plan, speed: 0.1 })).toThrow();
  });
  it("shorter audio may be KEPT for a provider with sync modes; longer audio is trimmed only when asked", () => {
    expect(decideAudioFit(4000, 10_000, { shorterAudio: "keep", minimumCoverageFraction: 0, trimToFit: true })).toMatchObject({ ok: true, action: "keep" });
    expect(decideAudioFit(4000, 10_000, { shorterAudio: "silence", minimumCoverageFraction: 0, trimToFit: true })).toMatchObject({ ok: true, action: "pad" });
    expect(decideAudioFit(14_000, 10_000, { shorterAudio: "keep", minimumCoverageFraction: 0, trimToFit: false })).toMatchObject({ ok: false, code: "audio-longer-than-video" });
  });
  it("the Kling lip-sync prepare profile caps the long edge at 1920 and raises the short edge to 720, with no frame-rate argument", () => {
    const plan = { input: "/tmp/in.bin", output: "/tmp/out.mp4", startMs: 0, endMs: null, profile: "kling_lipsync" as const };
    const args = buildPrepareArgs(plan);
    const scale = args.find((a) => a.startsWith("scale="))!;
    expect(scale).toContain("1920");
    expect(scale).toContain("720");
    expect(args).not.toContain("-r");
    for (const a of args) expect(isKnownPrepareArg(a, plan)).toBe(true);
  });
  it("the prepare service applies the operator's policy to MEASURED lengths and writes what it decided", () => {
    const s = code("server/services/ai-lip-sync-prepare-service.ts");
    for (const p of ['policy === "reject"', 'policy === "trim_video_to_audio"', 'policy === "loop_audio"', 'policy === "provider_sync_mode"']) expect(s).toContain(p);
    expect(s).toContain("duration_note: durationNote");
    expect(s).toContain("buildTempoArgs(tempo)");
    expect(s).toContain('speechPath === "native"');
  });
});

describe("the job view", () => {
  it("a lip sync row maps to `lipSync` — the source, the path, never the text", () => {
    const row = {
      id: "j",
      user_id: "u",
      guest_id: null,
      feature: "ai_lip_sync",
      provider: "replicate",
      model: "sync/lipsync-2-pro",
      model_version: null,
      status: "completed",
      client_request_id: "c",
      source_path: "p",
      result_path: "r",
      poster_path: null,
      funding_source: "balance",
      charged_cents: 250,
      source_size: 1,
      result_size: 2,
      result_duration: 10,
      result_mime_type: "video/mp4",
      audio_restored: true,
      source_duration: 10,
      source_mime_type: "video/mp4",
      source_kind: "upload",
      source_url: null,
      replicate_prediction_id: "pred",
      error_code: null,
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      expires_at: null,
      notified_at: null,
      finalize_attempts: 0,
      finalize_lease_until: null,
      finalize_next_at: null,
      finalize_error: null,
      metadata: { tool: "lip_sync", attempt: 1, speech: { source: "text", text: "SECRET WORDS", voiceId: "warm", languageCode: "en", speed: 1.2, path: "tts" }, settings: { expression: "expressive", activeSpeaker: true, durationPolicy: "provider_sync_mode" }, prepared: { durationMs: 10_000 }, quote: { currency: "USD", totalCents: 250 }, pipeline: { stages: ["lipsync", "finalize"], current: "finalize", records: { lipsync: { status: "succeeded" } } } },
    } as unknown as AiJobRow;
    const view = jobToView(row, () => "");
    expect(view.lipSync).toMatchObject({ speechSource: "text", speechPath: "tts", voiceId: "warm", languageCode: "en", speed: 1.2, textLength: 12, expression: "expressive", activeSpeaker: true, selectedDurationMs: 10_000, chargedCents: 250, billing: "PAID" });
    expect(JSON.stringify(view)).not.toContain("SECRET WORDS");
    expect(view.characterReplace).toBeNull();
  });
});
