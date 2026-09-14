import { describe, expect, it } from "vitest";

import { buildAudioPrepareArgs, isKnownAudioArg, isWavCompatible } from "./audio-ffmpeg";
import { AUDIO_FIT_TOLERANCE_MS, decideAudioFit, estimateSpeechMs, sniffAudioContainer, sniffedContainerAgrees, validateAudioFile, validateProbedAudio } from "./audio-validate";
import { SYNC_INPUT_FIELDS, buildSyncLabsInput, lipSyncProviderFor, lipSyncProviderUsdCentsPerSecond } from "./lipsync-provider";
import { minimaxLanguageHint, ttsSupportedLanguagesFor } from "./tts-languages";
import { MINIMAX_INPUT_FIELDS, buildMiniMaxInput, textToSpeechProviderFor } from "./tts-provider";

/**
 * Part 6 §29 — the audio, the voice and the lip sync, as far as they are
 * pure: the signature check on the bytes, the fit decision, the ffmpeg plan,
 * and the two provider payloads. A real file through ffprobe/ffmpeg is the
 * worker's job and is covered by the real-run checklist.
 */

const bytes = (...b: (number | string)[]): Uint8Array => {
  const out: number[] = [];
  for (const x of b) {
    if (typeof x === "string") for (const ch of x) out.push(ch.charCodeAt(0));
    else out.push(x);
  }
  while (out.length < 16) out.push(0);
  return new Uint8Array(out);
};

describe("replacement audio — the file, before and after it is opened", () => {
  it("accepts MP3, WAV, M4A, AAC and OGG by type OR extension; refuses the rest, the oversized and the empty", () => {
    const limits = { maxBytes: 1000 };
    expect(validateAudioFile({ name: "a.mp3", size: 10, type: "audio/mpeg" }, limits)).toEqual({ ok: true });
    expect(validateAudioFile({ name: "a.bin", size: 10, type: "audio/wav" }, limits)).toEqual({ ok: true });
    expect(validateAudioFile({ name: "a.m4a", size: 10, type: "" }, limits)).toEqual({ ok: true });
    expect(validateAudioFile({ name: "a.ogg", size: 10, type: "application/ogg" }, limits)).toEqual({ ok: true });
    expect(validateAudioFile({ name: "a.mp4", size: 10, type: "video/mp4" }, limits)).toEqual({ ok: false, code: "unsupported-audio" });
    expect(validateAudioFile({ name: "a.mp3", size: 1001, type: "audio/mpeg" }, limits)).toEqual({ ok: false, code: "audio-too-large" });
    expect(validateAudioFile({ name: "a.mp3", size: 0, type: "audio/mpeg" }, limits)).toEqual({ ok: false, code: "invalid-audio" });
  });

  it("🔴 the signature is the bytes, not the name: a PDF called song.mp3 stops here", () => {
    expect(sniffAudioContainer(bytes("ID3", 4, 0, 0))).toBe("mp3");
    expect(sniffAudioContainer(bytes(0xff, 0xfb, 0x90, 0x00))).toBe("mp3");
    expect(sniffAudioContainer(bytes(0xff, 0xf1, 0x50, 0x80))).toBe("aac");
    expect(sniffAudioContainer(bytes("RIFF", 0, 0, 0, 0, "WAVE"))).toBe("wav");
    expect(sniffAudioContainer(bytes(0, 0, 0, 0x20, "ftypM4A "))).toBe("mp4");
    expect(sniffAudioContainer(bytes("OggS", 0, 2))).toBe("ogg");
    expect(sniffAudioContainer(bytes("%PDF-1.7"))).toBeNull();
    expect(sniffedContainerAgrees(null, { name: "song.mp3", type: "audio/mpeg" })).toBe(false);
    expect(sniffedContainerAgrees("wav", { name: "song.mp3", type: "audio/mpeg" })).toBe(true); // a real container, declared as another audio kind — accepted
    expect(sniffedContainerAgrees("mp3", { name: "song.exe", type: "application/octet-stream" })).toBe(false);
  });

  it("a probed file needs an audio stream in an accepted codec, no picture, within the ceiling", () => {
    const limits = { maxDurationMs: 120_000, minDurationMs: 200 };
    const good = { hasAudio: true, hasVideo: false, durationSeconds: 9.5, audioCodec: "mp3", sampleRate: 44_100, channels: 2, bitrate: 128_000 };
    expect(validateProbedAudio(good, limits)).toEqual({ ok: true });
    expect(validateProbedAudio({ ...good, hasVideo: true }, limits)).toEqual({ ok: false, code: "unsupported-audio" });
    expect(validateProbedAudio({ ...good, audioCodec: "wmav2" }, limits)).toEqual({ ok: false, code: "unsupported-audio" });
    expect(validateProbedAudio({ ...good, durationSeconds: 121 }, limits)).toEqual({ ok: false, code: "audio-too-long" });
    expect(validateProbedAudio({ ...good, durationSeconds: 0 }, limits)).toEqual({ ok: false, code: "invalid-audio" });
    expect(validateProbedAudio({ ...good, durationSeconds: 0.1 }, limits)).toEqual({ ok: false, code: "audio-too-short" });
    expect(validateProbedAudio(null, limits)).toEqual({ ok: false, code: "invalid-audio" });
  });
});

describe("fitting audio to the video (§4) — never stretched, never looped", () => {
  const policy = { shorterAudio: "silence" as const, minimumCoverageFraction: 0.5, trimToFit: false };
  it("keeps within tolerance, pads a shorter clip, refuses one that covers too little", () => {
    expect(decideAudioFit(10_000, 10_000 + AUDIO_FIT_TOLERANCE_MS, policy)).toMatchObject({ ok: true, action: "keep" });
    expect(decideAudioFit(8_000, 10_000, policy)).toMatchObject({ ok: true, action: "pad" });
    expect(decideAudioFit(4_000, 10_000, policy)).toMatchObject({ ok: false, code: "audio-much-shorter-than-video" });
    expect(decideAudioFit(8_000, 10_000, { ...policy, shorterAudio: "reject" })).toMatchObject({ ok: false });
    expect(decideAudioFit(0, 10_000, policy)).toMatchObject({ ok: false, code: "audio-too-short" });
  });
  it("🔴 cuts longer audio ONLY when the member asked", () => {
    expect(decideAudioFit(14_000, 10_000, policy)).toMatchObject({ ok: false, code: "audio-longer-than-video" });
    expect(decideAudioFit(14_000, 10_000, { ...policy, trimToFit: true })).toMatchObject({ ok: true, action: "trim" });
  });
  it("the speaking-time estimate is honest arithmetic", () => {
    expect(estimateSpeechMs("")).toBe(0);
    expect(estimateSpeechMs("x".repeat(150))).toBe(10_000);
  });
});

describe("the WAV plan — copy when compatible, encode otherwise, pad with silence only", () => {
  const plan = { input: "/tmp/a/voice.bin", output: "/tmp/a/voice-prepared.wav", videoMs: 12_400, action: "keep" as const, compatible: false };
  it("encodes to 16-bit mono 32 kHz WAV, and every argument is a known one", () => {
    const args = buildAudioPrepareArgs(plan);
    expect(args).toContain("pcm_s16le");
    expect(args).toContain("32000");
    expect(args).not.toContain("-t");
    for (const a of args) expect(isKnownAudioArg(a, plan), a).toBe(true);
  });
  it("copies a compatible stream; trims with -t; pads with apad up to the video's length", () => {
    expect(buildAudioPrepareArgs({ ...plan, compatible: true })).toContain("copy");
    const trim = buildAudioPrepareArgs({ ...plan, action: "trim" });
    expect(trim[trim.indexOf("-t") + 1]).toBe("12.400");
    const pad = buildAudioPrepareArgs({ ...plan, action: "pad", compatible: true });
    expect(pad[pad.indexOf("-af") + 1]).toBe("apad=whole_dur=12.400");
    expect(pad).not.toContain("copy");
    for (const a of pad) expect(isKnownAudioArg(a, { ...plan, action: "pad" }), a).toBe(true);
    expect(isKnownAudioArg("-filter_complex", plan)).toBe(false);
    expect(isWavCompatible({ audioCodec: "pcm_s16le", sampleRate: 32_000, channels: 1 })).toBe(true);
    expect(isWavCompatible({ audioCodec: "mp3", sampleRate: 32_000, channels: 1 })).toBe(false);
  });
});

describe("text-to-speech — the provider seam and the MiniMax adapter", () => {
  it("speaks the languages the live schema names, and not the ones it does not", () => {
    expect(minimaxLanguageHint("en")).toBe("English");
    expect(minimaxLanguageHint("HI")).toBe("Hindi");
    expect(minimaxLanguageHint("yo")).toBeNull();
    expect(ttsSupportedLanguagesFor("minimax/speech-02-hd")).toContain("ar");
    expect(ttsSupportedLanguagesFor("some/other-model")).toEqual([]);
  });
  it("builds WAV 32 kHz mono with the language hint and the catalogue's voice id; refuses an unsupported language", () => {
    const input = buildMiniMaxInput({ text: "Hello there", languageCode: "es", providerVoiceId: "Spanish_SereneWoman" });
    expect(Object.keys(input).sort()).toEqual([...MINIMAX_INPUT_FIELDS].sort());
    expect(input).toEqual({ text: "Hello there", voice_id: "Spanish_SereneWoman", language_boost: "Spanish", audio_format: "wav", sample_rate: 32000, channel: "mono" });
    expect(buildMiniMaxInput({ text: "x", languageCode: "en", providerVoiceId: null })).not.toHaveProperty("voice_id");
    expect(() => buildMiniMaxInput({ text: "x", languageCode: "yo", providerVoiceId: null })).toThrow();
  });
  it("an unknown model is unconfigured and speaks nothing — never guessed", () => {
    const p = textToSpeechProviderFor("acme/tts");
    expect(p.isConfigured()).toBe(false);
    expect(p.supportedLanguages()).toEqual([]);
    expect(textToSpeechProviderFor("minimax/speech-02-hd").version).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("lip sync — the provider seam and the Sync Labs adapter", () => {
  it("sends video, audio and a sync mode that never changes the length; the price stays out of the customer's sight", () => {
    const input = buildSyncLabsInput({ videoUrl: "https://x/replaced.mp4", audioUrl: "https://x/voice.wav", syncMode: "silence" });
    expect(Object.keys(input).sort()).toEqual([...SYNC_INPUT_FIELDS].sort());
    expect(input.sync_mode).toBe("silence");
    expect(buildSyncLabsInput({ videoUrl: "https://x/a.mp4", audioUrl: "https://x/a.wav", syncMode: "cut_off" as unknown as "silence" }).sync_mode).toBe("silence");
    expect(JSON.stringify(input)).not.toMatch(/temperature|active_speaker/);
    expect(lipSyncProviderUsdCentsPerSecond("sync/lipsync-2-pro")).toBeCloseTo(8.325);
    expect(lipSyncProviderUsdCentsPerSecond("sync/lipsync-2")).toBe(0);
  });
  it("each tier's model has a pin; an unknown model is refused", () => {
    expect(lipSyncProviderFor("sync/lipsync-2-pro").version).toMatch(/^[0-9a-f]{64}$/);
    expect(lipSyncProviderFor("sync/lipsync-2").version).toMatch(/^[0-9a-f]{64}$/);
    expect(lipSyncProviderFor("acme/lips").isConfigured()).toBe(false);
  });
});
