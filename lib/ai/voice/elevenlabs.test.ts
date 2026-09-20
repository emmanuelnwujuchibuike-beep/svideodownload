import { beforeAll, describe, expect, it } from "vitest";

import { normalizeCharacterReplaceConfig, publicCharacterReplaceConfig, voiceProviderForModel } from "@/lib/ai/character-replace/config";
// (ELEVENLABS_REPLICATE_VOICE_NAMES is imported with the models below)
import { quoteCanonical } from "@/lib/ai/character-replace/wallet";
import { planPipeline } from "@/lib/ai/character-replace/pipeline";
import { normalizeQuoteInput, quoteCharacterReplace, validateQuoteInput } from "@/lib/ai/character-replace/pricing";
import { buildElevenLabsTtsBody } from "./elevenlabs";
import { ELEVENLABS_DEFAULT_VOICES, ELEVENLABS_REPLICATE_TTS_MODELS, ELEVENLABS_REPLICATE_VOICE_NAMES, ELEVENLABS_TTS_MODELS, elevenLabsTtsModel, voiceAgeFromLabel, voiceGenderFromLabel } from "./elevenlabs-models";
import { buildReplicateElevenLabsInput, textToSpeechProviderFor, ttsRunsInWorker } from "./tts-provider";
import { ttsSupportedLanguagesFor } from "./tts-languages";
import { voiceChangeProviderFor } from "./voice-change-provider";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ELEVENLABS v3 + THE VOICE CHANGER (owner, 2026-09-20)
 * ═══════════════════════════════════════════════════════════════════════════
 * "let's use eleven lab v3 and let users set gender type in text to speech,
 * and when converting a video to audio a gender and voice set-up should be
 * available … the gender should include gender and age types."
 */

describe("the ElevenLabs request bodies", () => {
  it("v3 and Multilingual v2 are never sent a language_code; Turbo/Flash v2.5 are, lower-cased", () => {
    expect(buildElevenLabsTtsBody({ text: "Hello", modelId: "eleven_v3", languageCode: "EN", languageCodeParam: false })).toEqual({ text: "Hello", model_id: "eleven_v3" });
    expect(buildElevenLabsTtsBody({ text: "Hello", modelId: "eleven_turbo_v2_5", languageCode: "FR", languageCodeParam: true })).toEqual({ text: "Hello", model_id: "eleven_turbo_v2_5", language_code: "fr" });
    expect(ELEVENLABS_TTS_MODELS["elevenlabs/eleven_v3"]!.languageCodeParam).toBe(false);
    expect(ELEVENLABS_TTS_MODELS["elevenlabs/eleven_turbo_v2_5"]!.languageCodeParam).toBe(true);
  });
  it("the adapter builds the same body, plus the catalogue voice, and refuses text over the model's ceiling", async () => {
    const p = textToSpeechProviderFor("elevenlabs/eleven_v3");
    expect(p.id).toBe("elevenlabs");
    expect(p.runsIn).toBe("worker");
    expect(p.buildInput({ text: "Hi", languageCode: "en", providerVoiceId: "9BWtsMINqrJLrRacOk9x" })).toEqual({ text: "Hi", model_id: "eleven_v3", voice_id: "9BWtsMINqrJLrRacOk9x" });
    await expect(p.createPrediction({ jobId: "j", text: "Hi", languageCode: "en", providerVoiceId: "x", webhookUrl: "https://x" })).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    // without a key the provider says so — TTS is not offered rather than failed
    const key = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    expect(p.isConfigured()).toBe(false);
    await expect(p.synthesize({ jobId: "j", text: "Hi", languageCode: "en", providerVoiceId: "x" })).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
    if (key) process.env.ELEVENLABS_API_KEY = key;
  });
  it("MiniMax stays a Replicate prediction; an unknown model speaks nothing", () => {
    expect(textToSpeechProviderFor("minimax/speech-02-hd").runsIn).toBe("replicate");
    expect(ttsRunsInWorker("minimax/speech-02-hd")).toBe(false);
    expect(ttsRunsInWorker("elevenlabs/eleven_v3")).toBe(true);
    expect(textToSpeechProviderFor("acme/voice").supportedLanguages()).toEqual([]);
  });
  it("ElevenLabs ON REPLICATE (the route in use): a prediction with a voice stage, the text as prompt, a voice NAME from the schema, the language", () => {
    const p = textToSpeechProviderFor("elevenlabs/v3");
    expect(p.id).toBe("replicate");
    expect(p.runsIn).toBe("replicate");
    expect(ttsRunsInWorker("elevenlabs/v3")).toBe(false);
    expect(p.version).toBe(ELEVENLABS_REPLICATE_TTS_MODELS["elevenlabs/v3"]!.version);
    expect(p.supportedLanguages()).toContain("ha");
    expect(buildReplicateElevenLabsInput({ text: "Hello there", languageCode: "EN", providerVoiceId: "Sarah" })).toEqual({ prompt: "Hello there", voice: "Sarah", language_code: "en" });
    // only the 26 names the model enumerates; an ElevenLabs voice ID is refused before any money moves
    expect(() => buildReplicateElevenLabsInput({ text: "Hi", languageCode: "en", providerVoiceId: "21m00Tcm4TlvDq8ikWAM" })).toThrow();
    expect(() => buildReplicateElevenLabsInput({ text: "Hi", languageCode: "en", providerVoiceId: null })).toThrow();
    expect(ELEVENLABS_REPLICATE_VOICE_NAMES).toHaveLength(26);
    // every default catalogue row names a voice the model accepts
    for (const v of ELEVENLABS_DEFAULT_VOICES) expect(ELEVENLABS_REPLICATE_VOICE_NAMES, v.label).toContain(v.providerVoiceId);
    for (const m of ["elevenlabs/turbo-v2.5", "elevenlabs/flash-v2.5", "elevenlabs/v2-multilingual"]) expect(textToSpeechProviderFor(m).runsIn).toBe("replicate");
  });
});

describe("languages and the voice vocabulary", () => {
  it("each ElevenLabs model answers its own documented list; v3 speaks Hausa, Multilingual v2 does not", () => {
    expect(ttsSupportedLanguagesFor("elevenlabs/eleven_v3")).toContain("ha");
    expect(ttsSupportedLanguagesFor("elevenlabs/eleven_multilingual_v2")).not.toContain("ha");
    expect(ttsSupportedLanguagesFor("elevenlabs/eleven_multilingual_v2")).toHaveLength(29);
    expect(ttsSupportedLanguagesFor("elevenlabs/eleven_turbo_v2_5")).toHaveLength(32);
    expect(elevenLabsTtsModel("elevenlabs/eleven_v3")?.languages.length).toBeGreaterThanOrEqual(70);
  });
  it("the provider's labels map onto our two words, and anything odd is the neutral / middle-aged default", () => {
    expect(voiceGenderFromLabel("female")).toBe("female");
    expect(voiceGenderFromLabel("Male")).toBe("male");
    expect(voiceGenderFromLabel("non-binary")).toBe("neutral");
    expect(voiceGenderFromLabel(undefined)).toBe("neutral");
    expect(voiceAgeFromLabel("young")).toBe("young");
    expect(voiceAgeFromLabel("middle-aged")).toBe("middle_aged");
    expect(voiceAgeFromLabel("middle_aged")).toBe("middle_aged");
    expect(voiceAgeFromLabel("old")).toBe("old");
    expect(voiceAgeFromLabel("")).toBe("middle_aged");
  });
  it("the default library has unique ids and provider ids, and covers both genders and all three ages", () => {
    expect(new Set(ELEVENLABS_DEFAULT_VOICES.map((v) => v.id)).size).toBe(ELEVENLABS_DEFAULT_VOICES.length);
    expect(new Set(ELEVENLABS_DEFAULT_VOICES.map((v) => v.providerVoiceId)).size).toBe(ELEVENLABS_DEFAULT_VOICES.length);
    for (const g of ["female", "male"]) expect(ELEVENLABS_DEFAULT_VOICES.some((v) => v.gender === g), g).toBe(true);
    expect(new Set(ELEVENLABS_DEFAULT_VOICES.map((v) => v.age)).size).toBe(3);
  });
});

describe("the catalogue and the public config", () => {
  const config = normalizeCharacterReplaceConfig(null);
  it("the default model is ElevenLabs v3 on Replicate, so the public voices are the ElevenLabs rows — with gender and age, WITHOUT the provider's id", () => {
    expect(config.tts.model).toBe("elevenlabs/v3");
    expect(voiceProviderForModel(config.tts.model)).toBe("elevenlabs");
    const pub = publicCharacterReplaceConfig(config, { code: "USD", symbol: "$" }, true);
    expect(pub.voices.length).toBe(ELEVENLABS_DEFAULT_VOICES.length);
    for (const v of pub.voices) {
      expect(["female", "male", "neutral"]).toContain(v.gender);
      expect(["young", "middle_aged", "old"]).toContain(v.age);
      expect("providerVoiceId" in v).toBe(false);
      expect("provider" in v).toBe(false);
    }
    // the default catalogue has no account rows, so the changer has nothing to offer until Import runs
    expect(pub.voiceChange.enabled).toBe(false);
    expect(pub.voiceChange.voices).toEqual([]);
  });
  it("switching the model to MiniMax offers the MiniMax rows only; the changer offers only ACCOUNT rows (ids), never the Replicate names", () => {
    const mm = normalizeCharacterReplaceConfig({ tts: { model: "minimax/speech-02-hd" } });
    const pub = publicCharacterReplaceConfig(mm, { code: "NGN", symbol: "₦" }, true);
    expect(pub.voices.every((v) => !v.id.startsWith("el-"))).toBe(true);
    expect(pub.voices.length).toBeGreaterThan(0);
    // no account rows yet → the changer has nothing to offer and is not enabled
    expect(pub.voiceChange.voices).toEqual([]);
    expect(pub.voiceChange.enabled).toBe(false);
    expect(voiceProviderForModel("elevenlabs/v3")).toBe("elevenlabs");
    expect(voiceProviderForModel("elevenlabs/eleven_v3")).toBe("elevenlabs_api");
    expect(voiceProviderForModel("minimax/speech-02-hd")).toBe("minimax");
  });
  it("🔴 a catalogue the Import action overwrote (account ids under the Replicate provider) is healed: ids become account rows, the names come back", () => {
    const overwritten = { voices: [{ id: "el-sarah", label: "Sarah", provider: "elevenlabs", gender: "female", age: "young", providerVoiceId: "EXAVITQu4vr4xnSDxMaL" }, { id: "el-roger", label: "Roger", provider: "elevenlabs", gender: "male", age: "middle_aged", providerVoiceId: "CwhRBWXzGAHq8TQ4Fs17" }] };
    const c = normalizeCharacterReplaceConfig(overwritten);
    const account = c.voices.filter((v) => v.provider === "elevenlabs_api");
    const replicate = c.voices.filter((v) => v.provider === "elevenlabs");
    expect(account.map((v) => v.id).sort()).toEqual(["ela-roger", "ela-sarah"]);
    expect(account.every((v) => /^[A-Za-z0-9]{15,}$/.test(v.providerVoiceId))).toBe(true);
    expect(replicate.length).toBe(ELEVENLABS_DEFAULT_VOICES.length);
    expect(replicate.every((v) => ELEVENLABS_REPLICATE_VOICE_NAMES.includes(v.providerVoiceId))).toBe(true);
    expect(new Set(c.voices.map((v) => v.id)).size).toBe(c.voices.length);
    const pub = publicCharacterReplaceConfig(c, { code: "USD", symbol: "$" }, true);
    expect(pub.voices.length).toBe(ELEVENLABS_DEFAULT_VOICES.length); // text-to-speech on Replicate: the names
    expect(pub.voiceChange.voices.map((v) => v.id).sort()).toEqual(["ela-roger", "ela-sarah"]); // the changer: the ids
  });
  it("a catalogue row saved before this date is a MiniMax row with the neutral / middle-aged default; a known id keeps its own", () => {
    const c = normalizeCharacterReplaceConfig({ voices: [{ id: "custom", label: "Custom", providerVoiceId: "English_Wiselady" }, { id: "el-aria", label: "Aria" }, { id: "x", label: "X", provider: "elevenlabs", gender: "male", age: "old", providerVoiceId: "abc" }] });
    expect(c.voices.find((v) => v.id === "custom")).toMatchObject({ provider: "minimax", gender: "neutral", age: "middle_aged" });
    expect(c.voices.find((v) => v.id === "el-aria")).toMatchObject({ provider: "elevenlabs", gender: "female", age: "middle_aged", providerVoiceId: "Aria" });
    expect(c.voices.find((v) => v.id === "x")).toMatchObject({ provider: "elevenlabs", gender: "male", age: "old" });
    // the changer's model must be one this build knows; anything else is the default changer
    expect(normalizeCharacterReplaceConfig({ tts: { voiceChange: { model: "acme/changer", perSecondCents: 12 } } }).tts.voiceChange).toEqual({ enabled: true, model: "elevenlabs/eleven_multilingual_sts_v2", perSecondCents: 12 });
  });
  it("the voice-change seam: configured only with a key and a known model", () => {
    const key = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    expect(voiceChangeProviderFor("elevenlabs/eleven_multilingual_sts_v2").isConfigured()).toBe(false);
    process.env.ELEVENLABS_API_KEY = "k";
    expect(voiceChangeProviderFor("elevenlabs/eleven_multilingual_sts_v2").isConfigured()).toBe(true);
    expect(voiceChangeProviderFor("elevenlabs/nope").isConfigured()).toBe(false);
    expect(voiceChangeProviderFor("elevenlabs/eleven_english_sts_v2").supportedLanguages()).toEqual(["en"]);
    if (key) process.env.ELEVENLABS_API_KEY = key;
    else delete process.env.ELEVENLABS_API_KEY;
  });
});

describe("the pipeline: an ElevenLabs voice is made by the worker, so there is no voice stage", () => {
  it("plans replace → lipsync → finalize for a worker voice and voice → replace → lipsync → finalize for a prediction", () => {
    expect(planPipeline({ mode: "face_only", voiceMode: "new_voice", voiceSource: "tts", lipSyncMode: "standard", ttsInWorker: true }).stages).toEqual(["replace", "lipsync", "finalize"]);
    expect(planPipeline({ mode: "face_only", voiceMode: "new_voice", voiceSource: "tts", lipSyncMode: "standard", ttsInWorker: false }).stages).toEqual(["voice", "replace", "lipsync", "finalize"]);
    // a plan from before this date (no flag) is the prediction plan it always was
    expect(planPipeline({ mode: "face_only", voiceMode: "new_voice", voiceSource: "tts", lipSyncMode: null }).stages).toEqual(["voice", "replace", "finalize"]);
    // an upload with a voice change has no voice stage either: the worker converts during prepare
    expect(planPipeline({ mode: "skin_face", voiceMode: "new_voice", voiceSource: "upload", lipSyncMode: "studio", ttsInWorker: true }).stages).toEqual(["replace", "lipsync", "finalize"]);
  });
});

describe("the voice change is priced per second and signed", () => {
  const config = normalizeCharacterReplaceConfig({ tts: { voiceChange: { enabled: true, perSecondCents: 50 } }, voice: { surchargePerSecondCents: 0 } });
  const money = { currency: "USD", symbol: "$" };
  it("10 s at $0.50/s adds $5.00 to the voice line; without the change nothing is added; text-to-speech never carries it", () => {
    const changed = quoteCharacterReplace({ selectedDurationMs: 10_000, mode: "face_only", quality: "standard", voiceMode: "new_voice", voiceSource: "upload", voiceChange: true, lipSyncMode: null }, config, money);
    const plain = quoteCharacterReplace({ selectedDurationMs: 10_000, mode: "face_only", quality: "standard", voiceMode: "new_voice", voiceSource: "upload", voiceChange: false, lipSyncMode: null }, config, money);
    expect(changed.voiceChange).toBe(true);
    expect(changed.voiceChangeRateCents).toBe(50);
    expect(changed.voiceCents - plain.voiceCents).toBe(500);
    expect(changed.totalCents - plain.totalCents).toBe(500);
    expect(changed.lines.find((l) => l.key === "voice")?.value).toBe("Your audio, in a new voice");
    expect(plain.voiceChange).toBe(false);
    const tts = normalizeQuoteInput({ selectedDurationMs: 10_000, mode: "face_only", quality: "standard", voiceMode: "new_voice", voiceSource: "tts", ttsCharacters: 40, voiceChange: true, lipSyncMode: null });
    expect(tts.voiceChange).toBe(false);
  });
  it("refused when the operator has it off, or without an upload", () => {
    const off = normalizeCharacterReplaceConfig({ tts: { voiceChange: { enabled: false } } });
    expect(validateQuoteInput({ selectedDurationMs: 10_000, mode: "face_only", quality: "standard", voiceMode: "new_voice", voiceSource: "upload", voiceChange: true, lipSyncMode: null }, off)).toMatchObject({ ok: false });
    expect(validateQuoteInput({ selectedDurationMs: 10_000, mode: "face_only", quality: "standard", voiceMode: "new_voice", voiceSource: "upload", voiceChange: true, lipSyncMode: null }, config)).toEqual({ ok: true });
  });
  it("the canonical string names the change only when there is one, so every older quote still verifies", () => {
    const changed = quoteCharacterReplace({ selectedDurationMs: 10_000, mode: "face_only", quality: "standard", voiceMode: "new_voice", voiceSource: "upload", voiceChange: true, lipSyncMode: null }, config, money);
    const plain = quoteCharacterReplace({ selectedDurationMs: 10_000, mode: "face_only", quality: "standard", voiceMode: "new_voice", voiceSource: "upload", lipSyncMode: null }, config, money);
    expect(quoteCanonical(changed)).toContain('"vc":1');
    expect(quoteCanonical(plain)).not.toContain("vc");
  });
});

describe("verifyStartQuote with a voice change", () => {
  let verifyStartQuote: typeof import("@/lib/ai/character-replace/start-verify").verifyStartQuote;
  let signQuote: typeof import("@/lib/ai/character-replace/wallet").signQuote;
  const config = normalizeCharacterReplaceConfig({ tts: { voiceChange: { enabled: true, perSecondCents: 50 } }, voices: [{ id: "ela-aria", label: "Aria", provider: "elevenlabs_api", gender: "female", age: "middle_aged", providerVoiceId: "9BWtsMINqrJLrRacOk9x" }] });
  const money = { currency: "USD", symbol: "$" };
  beforeAll(async () => {
    process.env.AI_QUOTE_SIGNING_SECRET = "test-signing-key";
    ({ verifyStartQuote } = await import("@/lib/ai/character-replace/start-verify"));
    ({ signQuote } = await import("@/lib/ai/character-replace/wallet"));
  });
  const issued = (voiceChange: boolean) => {
    const q = quoteCharacterReplace({ selectedDurationMs: 10_000, mode: "face_only", quality: "standard", voiceMode: "new_voice", voiceSource: "upload", voiceChange, lipSyncMode: null }, config, money);
    q.id = signQuote(q);
    return q;
  };
  const bodyOf = (q: ReturnType<typeof issued>, voice: Record<string, unknown>) => ({
    quote: { id: q.id, product: "character_replace" as const, currency: q.currency, pricingConfigVersion: q.pricingConfigVersion, durationMs: q.durationMs, mode: q.mode, quality: q.quality, voiceMode: q.voiceMode, voiceSource: q.voiceSource, voiceChange: q.voiceChange, lipSyncMode: q.lipSyncMode, totalCents: q.totalCents, expiresAt: q.expiresAt },
    trim: null,
    consent: true as const,
    voice: { source: "upload" as const, voiceConsent: true, ...voice },
  });
  it("a priced change with a catalogue voice hands the provider id to the job; the changer must exist", () => {
    const q = issued(true);
    const ok = verifyStartQuote(bodyOf(q, { changeVoiceId: "ela-aria" }), config, money, { ttsLanguages: [], voiceChangeConfigured: true });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.voice?.change).toEqual({ voiceId: "ela-aria", providerVoiceId: "9BWtsMINqrJLrRacOk9x" });
    // a Replicate NAME row is never a change voice — the API would refuse it
    expect(verifyStartQuote(bodyOf(q, { changeVoiceId: "el-aria" }), config, money, { ttsLanguages: [], voiceChangeConfigured: true }).ok).toBe(false);
    const notConfigured = verifyStartQuote(bodyOf(q, { changeVoiceId: "ela-aria" }), config, money, { ttsLanguages: [], voiceChangeConfigured: false });
    expect(notConfigured.ok).toBe(false);
    if (!notConfigured.ok) expect(notConfigured.code).toBe("FEATURE_UNAVAILABLE");
  });
  it("a MiniMax voice, an unknown voice, or a voice sent without a priced change is refused; flipping the flag breaks the signature", () => {
    const q = issued(true);
    expect(verifyStartQuote(bodyOf(q, { changeVoiceId: "warm" }), config, money, { ttsLanguages: [], voiceChangeConfigured: true }).ok).toBe(false);
    expect(verifyStartQuote(bodyOf(q, { changeVoiceId: "nope" }), config, money, { ttsLanguages: [], voiceChangeConfigured: true }).ok).toBe(false);
    const plain = issued(false);
    expect(verifyStartQuote(bodyOf(plain, { changeVoiceId: "ela-aria" }), config, money, { ttsLanguages: [], voiceChangeConfigured: true }).ok).toBe(false);
    const forged = bodyOf(plain, {});
    forged.quote.voiceChange = true; // a change the price did not include
    expect(verifyStartQuote(forged, config, money, { ttsLanguages: [], voiceChangeConfigured: true }).ok).toBe(false);
  });
});
