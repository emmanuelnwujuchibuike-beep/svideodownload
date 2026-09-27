import { describe, expect, it } from "vitest";

import { buildElevenLabsTtsBody } from "@/lib/ai/voice/elevenlabs";
import { buildReplicateElevenLabsInput } from "@/lib/ai/voice/tts-provider";
import {
  clampVoiceSettings,
  nearestStability,
  normalizeTtsVoiceSettings,
  TTS_DELIVERIES,
  TTS_DELIVERY_PRESETS,
  TTS_VOICE_SETTINGS_DEFAULTS,
  voiceSettingsCapability,
  voiceSettingsForDelivery,
} from "@/lib/ai/voice/voice-settings";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE DELIVERY — the settings that had never been sent (2026-09-27)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner: "i test the text to speech now and i think is not realistic enough,
 * sounds like ai, isnt it the realistic multilingual v2 and v3?" It was v3.
 * What was missing was `voice_settings`, and specifically `style` — which
 * defaults to ZERO at the provider, and zero is a reading.
 *
 * The first test is the regression: a body built WITH settings must carry them.
 * The rest guard the thing that makes this safe to ship — v3 takes only three
 * stability values, and a field a model does not read is LEFT OUT rather than
 * sent, so a request cannot be refused for carrying a knob that model ignores.
 */
describe("the delivery dials", () => {
  it("defaults are expressive, not flat — style above zero is the whole fix", () => {
    expect(TTS_VOICE_SETTINGS_DEFAULTS.style).toBeGreaterThan(0);
    expect(TTS_VOICE_SETTINGS_DEFAULTS.stability).toBeLessThan(0.5);
    expect(TTS_VOICE_SETTINGS_DEFAULTS.similarityBoost).toBeGreaterThanOrEqual(0.7);
  });

  it("v3 gets a stability it accepts and NO style — it reads neither the in-between value nor the dial", () => {
    const out = clampVoiceSettings({ ...TTS_VOICE_SETTINGS_DEFAULTS, stability: 0.45, style: 0.6 }, "eleven_v3");
    expect(out.stability).toBe(0.5);
    expect(out.style).toBeUndefined();
    expect(out.use_speaker_boost).toBeUndefined();
    expect(out.speed).toBeUndefined();
  });

  it("Multilingual v2 gets the continuous range AND the expressiveness dial", () => {
    const out = clampVoiceSettings({ ...TTS_VOICE_SETTINGS_DEFAULTS, stability: 0.42, style: 0.35 }, "eleven_multilingual_v2");
    expect(out.stability).toBe(0.42);
    expect(out.style).toBe(0.35);
    expect(out.use_speaker_boost).toBe(true);
    // v2 has no speed parameter
    expect(out.speed).toBeUndefined();
  });

  it("Turbo and Flash v2.5 take speed, and a speed of 1 is left out because it changes nothing", () => {
    const fast = clampVoiceSettings({ ...TTS_VOICE_SETTINGS_DEFAULTS, speed: 1.1 }, "eleven_turbo_v2_5");
    expect(fast.speed).toBe(1.1);
    expect(clampVoiceSettings({ ...TTS_VOICE_SETTINGS_DEFAULTS, speed: 1 }, "eleven_flash_v2_5").speed).toBeUndefined();
  });

  it("clamps out of range rather than passing a value the API would refuse", () => {
    const out = clampVoiceSettings({ stability: 9, similarityBoost: -3, style: 42, speakerBoost: false, speed: 99 }, "eleven_multilingual_v2");
    expect(out.stability).toBe(1);
    expect(out.similarity_boost).toBe(0);
    expect(out.style).toBe(1);
    expect(out.use_speaker_boost).toBe(false);
  });

  it("nearestStability picks the accepted value, never the midpoint of two", () => {
    expect(nearestStability(0.1, [0, 0.5, 1])).toBe(0);
    expect(nearestStability(0.4, [0, 0.5, 1])).toBe(0.5);
    expect(nearestStability(0.9, [0, 0.5, 1])).toBe(1);
  });

  it("every model id this project configures resolves to a capability", () => {
    for (const model of ["eleven_v3", "eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_flash_v2_5", "elevenlabs/v3", "elevenlabs/v2-multilingual", "elevenlabs/turbo-v2.5", "elevenlabs/flash-v2.5"]) {
      const cap = voiceSettingsCapability(model);
      expect(Array.isArray(cap.stabilityChoices)).toBe(true);
      expect(typeof cap.style).toBe("boolean");
    }
  });

  it("v3 on Replicate is treated as v3, not as a v2 wrapper", () => {
    expect(voiceSettingsCapability("elevenlabs/v3").stabilityChoices).toEqual([0, 0.5, 1]);
    expect(voiceSettingsCapability("elevenlabs/turbo-v2.5").stabilityChoices).toEqual([]);
  });

  it("each preset is a real move, and Expressive is the loosest of the three", () => {
    const seen = new Set<string>();
    for (const d of TTS_DELIVERIES) seen.add(`${TTS_DELIVERY_PRESETS[d].stability}:${TTS_DELIVERY_PRESETS[d].style}`);
    expect(seen.size).toBe(TTS_DELIVERIES.length);
    expect(TTS_DELIVERY_PRESETS.expressive.stability).toBeLessThan(TTS_DELIVERY_PRESETS.calm.stability);
    expect(TTS_DELIVERY_PRESETS.expressive.style).toBeGreaterThan(TTS_DELIVERY_PRESETS.calm.style);
  });

  it("a delivery moves stability and style but keeps the operator's other numbers", () => {
    const base = { stability: 0.9, similarityBoost: 0.62, style: 0.1, speakerBoost: false, speed: 1.05 };
    const out = voiceSettingsForDelivery(base, "expressive");
    expect(out.similarityBoost).toBe(0.62);
    expect(out.speakerBoost).toBe(false);
    expect(out.speed).toBe(1.05);
    expect(out.stability).toBe(TTS_DELIVERY_PRESETS.expressive.stability);
  });

  it("no delivery means the operator's own numbers, untouched", () => {
    const base = { ...TTS_VOICE_SETTINGS_DEFAULTS, stability: 0.77 };
    expect(voiceSettingsForDelivery(base, null)).toEqual(base);
  });

  it("the normaliser heals a junk row without inventing a flat voice", () => {
    const out = normalizeTtsVoiceSettings({ stability: "0.3", similarityBoost: null, style: "nonsense", speakerBoost: "yes", speed: 5 });
    expect(out.stability).toBe(0.3);
    expect(out.similarityBoost).toBe(TTS_VOICE_SETTINGS_DEFAULTS.similarityBoost);
    expect(out.style).toBe(TTS_VOICE_SETTINGS_DEFAULTS.style);
    // "yes" is not a boolean — the default stands rather than being coerced truthy
    expect(out.speakerBoost).toBe(TTS_VOICE_SETTINGS_DEFAULTS.speakerBoost);
    expect(out.speed).toBe(1.2);
  });
});

describe("what each adapter actually sends", () => {
  /* 🔴 THE REGRESSION. Both of these used to send the text and the model only. */
  it("the direct API body carries voice_settings when a delivery was resolved", () => {
    const body = buildElevenLabsTtsBody({ text: "Hello there.", modelId: "eleven_multilingual_v2", languageCode: null, languageCodeParam: false, voiceSettings: TTS_VOICE_SETTINGS_DEFAULTS });
    expect(body.voice_settings).toBeDefined();
    expect(body.voice_settings!.style).toBe(TTS_VOICE_SETTINGS_DEFAULTS.style);
  });

  it("the direct API body omits voice_settings entirely when none was given — an old row generates as it did before", () => {
    expect(buildElevenLabsTtsBody({ text: "Hello there.", modelId: "eleven_v3", languageCode: null, languageCodeParam: false }).voice_settings).toBeUndefined();
  });

  it("the Replicate wrapper carries the dials, and v3 gets no style through it either", () => {
    const input = buildReplicateElevenLabsInput({ text: "Hello there.", languageCode: "en", providerVoiceId: "Rachel", voiceSettings: TTS_VOICE_SETTINGS_DEFAULTS }, "elevenlabs/v3");
    expect(input.stability).toBe(0.5);
    expect(input.similarity_boost).toBe(TTS_VOICE_SETTINGS_DEFAULTS.similarityBoost);
    expect(input.style).toBeUndefined();
  });

  it("the Replicate v2 wrapper carries the expressiveness dial", () => {
    const input = buildReplicateElevenLabsInput({ text: "Hello there.", languageCode: "en", providerVoiceId: "Rachel", voiceSettings: TTS_VOICE_SETTINGS_DEFAULTS }, "elevenlabs/v2-multilingual");
    expect(input.style).toBe(TTS_VOICE_SETTINGS_DEFAULTS.style);
  });

  it("the Replicate wrapper still refuses a voice that is not one of its names", () => {
    expect(() => buildReplicateElevenLabsInput({ text: "hi", languageCode: "en", providerVoiceId: "EXAVITQu4vr4xnSDxMaL" })).toThrow();
  });
});
