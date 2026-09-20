import { describe, expect, it } from "vitest";

import { CHARACTER_REPLACE_DEFAULTS, publicCharacterReplaceConfig } from "./config";
import type { CharacterAsset, PricingSnapshot, SourceVideo, VideoMetadata } from "./types";
import { aspectRatioOf, buildJobInput, inputReadiness, resolutionLabelOf } from "./validate";
import {
  INITIAL_STATE,
  canEnterStep,
  canStart,
  formatClock,
  formatSeconds,
  furthestStep,
  selectedDurationSeconds,
  summaryLines,
  trimmedSeconds,
  videoFits,
  workspaceReducer,
  type WorkspaceState,
} from "./workspace";

/**
 * The workspace's decisions, without a browser.
 *
 * Every rule the interface enforces — which step may open, whether the kept
 * range fits, whether Start may be pressed — is a pure function here, so the
 * gate that keeps §20 true ("no paid inference") is asserted rather than
 * trusted. Part 2 added the two asset slots and their invariant; the STATE
 * block below is §24's matrix.
 */

const config = publicCharacterReplaceConfig(CHARACTER_REPLACE_DEFAULTS, { code: "NGN", symbol: "₦" }, false);

const photo = (): CharacterAsset => ({
  file: new File(["x"], "me.jpg", { type: "image/jpeg" }),
  objectUrl: "blob:photo",
  width: 1200,
  height: 1600,
  size: 1,
  mimeType: "image/jpeg",
  name: "me.jpg",
});

const meta = (durationMs: number | null, width = 1080, height = 1920): VideoMetadata => ({
  durationMs,
  width,
  height,
  aspect: aspectRatioOf(width, height),
  resolutionLabel: resolutionLabelOf(width, height),
  sizeBytes: 1,
  mimeType: "video/mp4",
  container: "mp4",
  frameRate: null,
  videoCodec: null,
  hasAudio: null,
  audioDurationMs: null,
});

const video = (durationMs: number | null = 18_437, url = "blob:video"): SourceVideo => ({
  file: new File(["x"], "clip.mp4", { type: "video/mp4" }),
  objectUrl: url,
  name: "clip.mp4",
  size: 1,
  mimeType: "video/mp4",
  metadata: meta(durationMs),
});

function withBoth(durationMs: number | null = 18_437): WorkspaceState {
  let s = workspaceReducer(INITIAL_STATE, { type: "photo/ready", asset: photo() });
  s = workspaceReducer(s, { type: "video/ready", video: video(durationMs), maxDurationMs: config.maximumDurationSeconds * 1000 });
  return s;
}

describe("steps", () => {
  it("opens only what has been earned", () => {
    expect(canEnterStep(INITIAL_STATE.project, "photo")).toBe(true);
    expect(canEnterStep(INITIAL_STATE.project, "video")).toBe(false);
    expect(canEnterStep(INITIAL_STATE.project, "review")).toBe(false);
    const both = withBoth();
    expect(canEnterStep(both.project, "review")).toBe(true);
    expect(furthestStep(INITIAL_STATE.project)).toBe("photo");
    expect(furthestStep(both.project)).toBe("review");
  });

  it("refuses a jump to a step that is not earned, and allows one that is", () => {
    const stuck = workspaceReducer(INITIAL_STATE, { type: "go", step: "settings" });
    expect(stuck.step).toBe("photo");
    const moved = workspaceReducer(withBoth(), { type: "go", step: "voice" });
    expect(moved.step).toBe("voice");
  });
});

describe("the asset slots (§20/§21)", () => {
  it("photo + video ready", () => {
    const s = withBoth();
    expect(s.photo).toEqual({ status: "ready" });
    expect(s.video).toEqual({ status: "ready" });
    expect(inputReadiness(s.project, config).ready).toBe(true);
  });

  it("Face Only with its own tier is ready — the gate reads the MODE's tiers, not the Full Character list (owner, 2026-09-14: Continue stayed grey)", () => {
    const face = workspaceReducer(withBoth(), { type: "mode", mode: "face_only", defaultQuality: "standard", maxReferences: 1 });
    expect(face.project.settings.quality).toBe("standard");
    const r = inputReadiness(face.project, config);
    expect(r.issues).not.toContain("quality-unavailable");
    expect(r.ready).toBe(true);
    // a tier the mode does not support stays refused
    const ultra = { ...face, project: { ...face.project, settings: { ...face.project.settings, quality: "ultra" as const } } };
    expect(inputReadiness(ultra.project, config).issues).toContain("quality-unavailable");
  });

  it("🔴 'ready' is impossible without the file — the slot and the asset move together", () => {
    const s = workspaceReducer(withBoth(), { type: "video/clear" });
    expect(s.video).toEqual({ status: "empty" });
    expect(s.project.video).toBeNull();
    expect(inputReadiness(s.project, config).issues).toContain("video-missing");
    const p = workspaceReducer(s, { type: "photo/clear" });
    expect(p.photo).toEqual({ status: "empty" });
    expect(p.project.character).toBeNull();
    expect(furthestStep(p.project)).toBe("photo");
  });

  it("a refused file leaves the slot invalid, with the code, and no asset", () => {
    const s = workspaceReducer(withBoth(), { type: "video/invalid", code: "file-too-large" });
    expect(s.video).toEqual({ status: "invalid", code: "file-too-large" });
    expect(s.project.video).toBeNull();
    expect(s.project.settings.trim).toBeNull();
    const p = workspaceReducer(s, { type: "photo/error", code: "invalid-image" });
    expect(p.photo).toEqual({ status: "error", code: "invalid-image" });
    expect(p.project.character).toBeNull();
  });

  it("replacing a video clears its metadata, trim and price BEFORE the new one is read", () => {
    let s = withBoth(18_437);
    s = workspaceReducer(s, { type: "trim", start: 2, end: 8 });
    s = workspaceReducer(s, { type: "pricing", pricing: { status: "pending" } });
    s = workspaceReducer(s, { type: "video/validating" });
    expect(s.video).toEqual({ status: "validating" });
    expect(s.project.video).toBeNull();
    expect(s.project.settings.trim).toBeNull();
    expect(s.pricing).toEqual({ status: "idle" });
    s = workspaceReducer(s, { type: "video/ready", video: video(5_000, "blob:next"), maxDurationMs: 60_000 });
    expect(s.project.video?.objectUrl).toBe("blob:next");
    expect(s.project.video?.metadata.durationMs).toBe(5_000);
    expect(s.project.settings.trim).toBeNull();
  });

  it("replacing a photo clears the old one while the new one is validating", () => {
    let s = withBoth();
    s = workspaceReducer(s, { type: "photo/validating" });
    expect(s.photo).toEqual({ status: "validating" });
    expect(s.project.character).toBeNull();
    // The video is untouched by a photo change.
    expect(s.project.video).not.toBeNull();
  });

  it("clearing the video drops the trim and the price with it", () => {
    let s = withBoth();
    s = workspaceReducer(s, { type: "trim", start: 2, end: 8 });
    expect(s.project.settings.trim).toEqual({ start: 2, end: 8 });
    s = workspaceReducer(s, { type: "video/clear" });
    expect(s.project.video).toBeNull();
    expect(s.project.settings.trim).toBeNull();
    expect(s.pricing).toEqual({ status: "idle" });
  });
});

describe("trim arithmetic (§7/§9)", () => {
  it("selected = the kept range; the whole video when there is no trim — from integer ms", () => {
    const s = withBoth(18_437);
    expect(selectedDurationSeconds(s.project)).toBeCloseTo(18.437, 3);
    expect(formatSeconds(selectedDurationSeconds(s.project))).toBe("18.4 sec");
    const t = workspaceReducer(s, { type: "trim", start: 3.2, end: 13.2 });
    expect(selectedDurationSeconds(t.project)).toBeCloseTo(10, 3);
    expect(trimmedSeconds(t.project)).toBeCloseTo(8.437, 3);
    expect(formatClock(3.2)).toBe("00:03.2");
    expect(formatClock(13.2)).toBe("00:13.2");
    expect(formatClock(75.06)).toBe("01:15.1");
  });

  it("the job input carries the range as integer milliseconds, not a rounded display", () => {
    let s = withBoth(18_437);
    s = workspaceReducer(s, { type: "trim", start: 3.2, end: 13.2 });
    const input = buildJobInput(s.project)!;
    expect(input.trim).toEqual({ startMs: 3200, endMs: 13200, selectedDurationMs: 10000, whole: false });
    expect(input.video.originalDurationMs).toBe(18_437);
    const whole = buildJobInput(withBoth(18_437).project)!;
    expect(whole.trim).toEqual({ startMs: 0, endMs: 18_437, selectedDurationMs: 18_437, whole: true });
  });

  it("a range covering everything is 'no trim', not a trim of everything", () => {
    const s = workspaceReducer(withBoth(18_437), { type: "trim", start: 0, end: 18.437 });
    expect(s.project.settings.trim).toBeNull();
  });

  it("clamps a range to the video and never lets end precede start", () => {
    const s = workspaceReducer(withBoth(18_437), { type: "trim", start: 30, end: 5 });
    expect(s.project.settings.trim).toEqual({ start: 5, end: 5 });
    expect(inputReadiness(s.project, config).issues).toContain("trim-too-short");
  });

  it("🔴 pre-trims a video longer than the tool's ceiling, rather than refusing it", () => {
    const s = withBoth(200_000);
    expect(s.project.settings.trim).toEqual({ start: 0, end: config.maximumDurationSeconds });
    expect(videoFits(s.project, config)).toBe(true);
  });

  it("refuses a kept range over the ceiling, under the minimum, or unmeasured", () => {
    const over = workspaceReducer(withBoth(200_000), { type: "trim/clear" });
    expect(videoFits(over.project, config)).toBe(false);
    expect(inputReadiness(over.project, config).issues).toContain("trim-too-long");
    const tiny = workspaceReducer(withBoth(18_437), { type: "trim", start: 0, end: 0.2 });
    expect(videoFits(tiny.project, config)).toBe(false);
    expect(videoFits(withBoth(null).project, config)).toBe(false);
    expect(inputReadiness(withBoth(null).project, config).issues).toContain("video-unmeasured");
  });

  it("minimum allowed duration passes exactly", () => {
    const s = workspaceReducer(withBoth(18_437), { type: "trim", start: 0, end: config.trim.minimumSeconds });
    expect(videoFits(s.project, config)).toBe(true);
  });

  it("start and end handle moves each land where they were sent", () => {
    let s = withBoth(18_437);
    s = workspaceReducer(s, { type: "trim", start: 4, end: 18.437 });
    expect(s.project.settings.trim).toEqual({ start: 4, end: 18.437 });
    s = workspaceReducer(s, { type: "trim", start: 4, end: 12 });
    expect(s.project.settings.trim).toEqual({ start: 4, end: 12 });
    s = workspaceReducer(s, { type: "trim/clear" });
    expect(s.project.settings.trim).toBeNull();
    expect(selectedDurationSeconds(s.project)).toBeCloseTo(18.437, 3);
  });

  it("writes seconds with one decimal, always", () => {
    expect(formatSeconds(10)).toBe("10.0 sec");
    expect(formatSeconds(18.44)).toBe("18.4 sec");
    expect(formatSeconds(null)).toBe("—");
  });
});

describe("pricing state", () => {
  const snapshot: PricingSnapshot = {
    id: "q1",
    currency: "NGN",
    symbol: "₦",
    lines: [],
    totalCents: 25_000,
    savings: [],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    durationMs: 10_000,
    subtotalCents: 25_000,
    minimumChargeCents: 100,
    minimumApplied: false,
    pricingConfigVersion: 1,
    mode: "full_character",
    quality: "720p",
    qualityRateCents: 2_500,
    videoCents: 25_000,
    voiceCents: 0,
    lipSyncCents: 0,
    basePriceCents: 0,
    voiceMode: "original",
    voiceSource: null,
    ttsCharacters: 0,
    voiceChange: false,
    lipSyncMode: null,
    rateLine: "10.0s × ₦25.00/s = ₦250.00",
  };

  it("a quote goes stale when any priced input moves, and survives an unpriced one", () => {
    let s = workspaceReducer(withBoth(), { type: "pricing", pricing: { status: "quoted", snapshot } });
    s = workspaceReducer(s, { type: "voice/language", code: "fr" });
    expect(s.pricing.status).toBe("quoted");
    s = workspaceReducer(s, { type: "quality", quality: "1080p" });
    expect(s.pricing.status).toBe("stale");
  });

  it("summary lines carry the choices and NEVER an amount", () => {
    let s = withBoth(18_437);
    s = workspaceReducer(s, { type: "trim", start: 3.2, end: 13.2 });
    s = workspaceReducer(s, { type: "voice/mode", mode: "new_voice", defaults: { languageCode: "en", voiceId: "el-aria", tier: "standard" } });
    const lines = summaryLines(s.project, config);
    expect(lines.map((l) => [l.key, l.value])).toEqual([
      ["video", "10.0 sec"],
      ["quality", "720p"],
      ["character", "Full Character"],
      ["voice", "English · Aria"],
      ["lipSync", "Standard"],
    ]);
    expect(lines.every((l) => l.amountCents === null)).toBe(true);
    const original = summaryLines(withBoth().project, config);
    expect(original.find((l) => l.key === "voice")?.value).toBe("Original audio");
    expect(original.find((l) => l.key === "lipSync")?.value).toBe("Not selected");
  });

  it("🔴 Start is impossible without a server quote — the no-inference guarantee", () => {
    let s = withBoth(18_437);
    s = workspaceReducer(s, { type: "consent", value: true });
    const base = { project: s.project, config, available: true, balanceCents: 1_000_000 };
    expect(canStart({ ...base, pricing: { status: "idle" } })).toBe(false);
    expect(canStart({ ...base, pricing: { status: "pending" } })).toBe(false);
    expect(canStart({ ...base, pricing: { status: "stale", snapshot } })).toBe(false);
    expect(canStart({ ...base, pricing: { status: "error", message: "x" } })).toBe(false);
    // And with a quote: consent, availability, readiness and the balance all still gate.
    expect(canStart({ ...base, pricing: { status: "quoted", snapshot } })).toBe(true);
    expect(canStart({ ...base, pricing: { status: "quoted", snapshot }, balanceCents: 100 })).toBe(false);
    expect(canStart({ ...base, pricing: { status: "quoted", snapshot }, available: false })).toBe(false);
    const noConsent = workspaceReducer(s, { type: "consent", value: false });
    expect(canStart({ ...base, project: noConsent.project, pricing: { status: "quoted", snapshot } })).toBe(false);
    const noVideo = workspaceReducer(s, { type: "video/clear" });
    expect(canStart({ ...base, project: noVideo.project, pricing: { status: "quoted", snapshot } })).toBe(false);
  });

  it("a new voice must be fully described before Start — a dialogue, a language and a voice (Part 6); lip sync is optional", () => {
    let s = withBoth(18_437);
    s = workspaceReducer(s, { type: "consent", value: true });
    s = workspaceReducer(s, { type: "voice/mode", mode: "new_voice", defaults: { languageCode: null, voiceId: null, tier: null, source: "tts" } });
    const start = (project: typeof s.project) => canStart({ project, config, available: true, balanceCents: 1_000_000, pricing: { status: "quoted", snapshot } });
    expect(start(s.project)).toBe(false);
    s = workspaceReducer(s, { type: "voice/language", code: "en" });
    s = workspaceReducer(s, { type: "voice/voice", id: "warm" });
    expect(start(s.project)).toBe(false); // no dialogue yet
    s = workspaceReducer(s, { type: "voice/text", text: "Hello there, this is the new voice." });
    expect(start(s.project)).toBe(true);
    s = workspaceReducer(s, { type: "lipsync/tier", tier: "studio" });
    expect(start(s.project)).toBe(true);
    s = workspaceReducer(s, { type: "lipsync/clear" });
    expect(start(s.project)).toBe(true);
    // a language the provider does not speak is refused locally too
    s = workspaceReducer(s, { type: "voice/language", code: "yo" });
    expect(start(s.project)).toBe(false);
  });

  it("an uploaded voice needs the file AND the rights confirmation (Part 6 §6)", () => {
    let s = withBoth(18_437);
    s = workspaceReducer(s, { type: "consent", value: true });
    s = workspaceReducer(s, { type: "voice/mode", mode: "new_voice", defaults: { languageCode: "en", voiceId: "warm", tier: null, source: "upload" } });
    const start = (project: typeof s.project) => canStart({ project, config, available: true, balanceCents: 1_000_000, pricing: { status: "quoted", snapshot } });
    expect(start(s.project)).toBe(false);
    s = workspaceReducer(s, { type: "audio/ready", asset: { file: new File(["x"], "v.mp3", { type: "audio/mpeg" }), objectUrl: "blob:a", name: "v.mp3", size: 1, mimeType: "audio/mpeg", durationMs: 9_000 } });
    expect(s.audio.status).toBe("ready");
    expect(start(s.project)).toBe(false);
    s = workspaceReducer(s, { type: "voice/consent", value: true });
    expect(start(s.project)).toBe(true);
    // the dialogue's length is a priced input: changing it goes stale; the source too
    s = workspaceReducer(s, { type: "pricing", pricing: { status: "quoted", snapshot } });
    s = workspaceReducer(s, { type: "voice/source", source: "tts" });
    expect(s.pricing.status).toBe("stale");
  });

  it("switching back to the original audio clears the voice, its audio and the tier", () => {
    let s = withBoth();
    s = workspaceReducer(s, { type: "voice/mode", mode: "new_voice", defaults: { languageCode: "en", voiceId: "warm", tier: "studio" } });
    s = workspaceReducer(s, { type: "voice/mode", mode: "original", defaults: { languageCode: null, voiceId: null, tier: null } });
    expect(s.project.voice).toEqual({ mode: "original", source: null, audio: null, trimAudioToFit: false, text: "", languageCode: null, voiceId: null, voiceConsent: false, changeVoice: false, changeVoiceId: null });
    expect(s.project.lipSync.tier).toBeNull();
    expect(s.audio.status).toBe("empty");
  });

  it("switching the mode keeps the files, resets the tier to the mode's default, and trims extra references (Part 6)", () => {
    let s = withBoth(18_437);
    s = workspaceReducer(s, { type: "pricing", pricing: { status: "quoted", snapshot } });
    s = workspaceReducer(s, { type: "mode", mode: "skin_face", defaultQuality: "high", maxReferences: 3 });
    expect(s.project.mode).toBe("skin_face");
    expect(s.project.settings.quality).toBe("high");
    expect(s.project.character).not.toBeNull();
    expect(s.project.video).not.toBeNull();
    expect(s.pricing.status).toBe("stale");
    s = workspaceReducer(s, { type: "reference/add", asset: photo(), max: 3 });
    s = workspaceReducer(s, { type: "reference/add", asset: photo(), max: 3 });
    s = workspaceReducer(s, { type: "reference/add", asset: photo(), max: 3 });
    expect(s.project.references).toHaveLength(2); // the primary + two = the maximum of three
    s = workspaceReducer(s, { type: "mode", mode: "face_only", defaultQuality: "standard", maxReferences: 1 });
    expect(s.project.references).toHaveLength(0);
    expect(s.project.settings.quality).toBe("standard");
    // the job input carries the mode and the voice source
    const input = buildJobInput(s.project);
    expect(input?.output.mode).toBe("face_only");
    expect(input?.audio.voiceSource).toBeNull();
  });
});

describe("the job input (§14)", () => {
  it("is plain JSON with no File, no object URL and no price", () => {
    let s = withBoth(18_437);
    s = workspaceReducer(s, { type: "voice/mode", mode: "new_voice", defaults: { languageCode: "yo", voiceId: "deep", tier: "studio" } });
    s = workspaceReducer(s, { type: "consent", value: true });
    const input = buildJobInput(s.project)!;
    const json = JSON.stringify(input);
    expect(json).not.toContain("blob:");
    expect(json).not.toMatch(/price|cents|total/i);
    expect(JSON.parse(json)).toEqual(input);
    expect(input.video).toMatchObject({ sourceWidth: 1080, sourceHeight: 1920, sourceResolution: "1080p", aspect: "9:16", hasAudio: null, container: "mp4" });
    expect(input.audio).toEqual({ voiceMode: "new_voice", voiceSource: "tts", languageCode: "yo", voiceId: "deep", lipSyncMode: "studio" });
    expect(input.output.mode).toBe("full_character");
    expect(input.output.requestedQuality).toBe("720p");
    expect(input.consent).toBe(true);
  });

  it("is null while the draft is incomplete", () => {
    expect(buildJobInput(INITIAL_STATE.project)).toBeNull();
    expect(buildJobInput(workspaceReducer(INITIAL_STATE, { type: "photo/ready", asset: photo() }).project)).toBeNull();
  });
});
