import { describe, expect, it } from "vitest";

import { CHARACTER_REPLACE_DEFAULTS, publicCharacterReplaceConfig } from "./config";
import type { CharacterAsset, PricingSnapshot, SourceVideo } from "./types";
import {
  INITIAL_STATE,
  canEnterStep,
  canStart,
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
 * gate that keeps §20 true ("no paid inference in Part 1") is asserted rather
 * than trusted.
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

const video = (duration: number | null = 18.4): SourceVideo => ({
  file: new File(["x"], "clip.mp4", { type: "video/mp4" }),
  objectUrl: "blob:video",
  durationSeconds: duration,
  width: 1080,
  height: 1920,
  size: 1,
  mimeType: "video/mp4",
  name: "clip.mp4",
});

function withBoth(duration: number | null = 18.4): WorkspaceState {
  let s = workspaceReducer(INITIAL_STATE, { type: "photo/set", asset: photo() });
  s = workspaceReducer(s, { type: "video/set", video: video(duration), maxDurationSeconds: config.maximumDurationSeconds });
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

describe("trim arithmetic", () => {
  it("selected = the kept range; the whole video when there is no trim", () => {
    const s = withBoth(18.4);
    expect(selectedDurationSeconds(s.project)).toBeCloseTo(18.4);
    const t = workspaceReducer(s, { type: "trim", start: 4, end: 14 });
    expect(selectedDurationSeconds(t.project)).toBe(10);
    expect(trimmedSeconds(t.project)).toBeCloseTo(8.4);
  });

  it("a range covering everything is 'no trim', not a trim of everything", () => {
    const s = workspaceReducer(withBoth(18.4), { type: "trim", start: 0, end: 18.4 });
    expect(s.project.settings.trim).toBeNull();
  });

  it("clamps a range to the video and never lets end precede start", () => {
    const s = workspaceReducer(withBoth(18.4), { type: "trim", start: 30, end: 5 });
    expect(s.project.settings.trim).toEqual({ start: 5, end: 5 });
  });

  it("🔴 pre-trims a video longer than the tool's ceiling, rather than refusing it", () => {
    const s = withBoth(200);
    expect(s.project.settings.trim).toEqual({ start: 0, end: config.maximumDurationSeconds });
    expect(videoFits(s.project, config)).toBe(true);
  });

  it("refuses a kept range over the ceiling, under the minimum, or unmeasured", () => {
    const over = workspaceReducer(withBoth(200), { type: "trim/clear" });
    expect(videoFits(over.project, config)).toBe(false);
    const tiny = workspaceReducer(withBoth(18.4), { type: "trim", start: 0, end: 0.2 });
    expect(videoFits(tiny.project, config)).toBe(false);
    expect(videoFits(withBoth(null).project, config)).toBe(false);
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
  };

  it("a quote goes stale when any priced input moves, and survives an unpriced one", () => {
    let s = workspaceReducer(withBoth(), { type: "pricing", pricing: { status: "quoted", snapshot } });
    s = workspaceReducer(s, { type: "voice/language", code: "fr" });
    expect(s.pricing.status).toBe("quoted");
    s = workspaceReducer(s, { type: "quality", quality: "1080p" });
    expect(s.pricing.status).toBe("stale");
  });

  it("summary lines carry the choices and NEVER an amount", () => {
    let s = withBoth(18.4);
    s = workspaceReducer(s, { type: "trim", start: 4, end: 14 });
    s = workspaceReducer(s, { type: "voice/mode", mode: "new_voice", defaults: { languageCode: "en", voiceId: "warm", tier: "standard" } });
    const lines = summaryLines(s.project, config);
    expect(lines.map((l) => [l.key, l.value])).toEqual([
      ["video", "10.0 sec"],
      ["quality", "720p"],
      ["character", "Included"],
      ["voice", "English · Warm"],
      ["lipSync", "Standard"],
    ]);
    expect(lines.every((l) => l.amountCents === null)).toBe(true);
    const original = summaryLines(withBoth().project, config);
    expect(original.find((l) => l.key === "voice")?.value).toBe("Original audio");
    expect(original.find((l) => l.key === "lipSync")?.value).toBe("Not selected");
  });

  it("🔴 Start is impossible without a server quote — the Part 1 guarantee", () => {
    let s = withBoth(18.4);
    s = workspaceReducer(s, { type: "consent", value: true });
    const base = { project: s.project, config, available: true, balanceCents: 1_000_000 };
    expect(canStart({ ...base, pricing: { status: "idle" } })).toBe(false);
    expect(canStart({ ...base, pricing: { status: "pending" } })).toBe(false);
    expect(canStart({ ...base, pricing: { status: "stale", snapshot } })).toBe(false);
    expect(canStart({ ...base, pricing: { status: "error", message: "x" } })).toBe(false);
    // And with a quote: consent, availability and the balance all still gate.
    expect(canStart({ ...base, pricing: { status: "quoted", snapshot } })).toBe(true);
    expect(canStart({ ...base, pricing: { status: "quoted", snapshot }, balanceCents: 100 })).toBe(false);
    expect(canStart({ ...base, pricing: { status: "quoted", snapshot }, available: false })).toBe(false);
    const noConsent = workspaceReducer(s, { type: "consent", value: false });
    expect(canStart({ ...base, project: noConsent.project, pricing: { status: "quoted", snapshot } })).toBe(false);
  });

  it("a new voice must be fully described before Start", () => {
    let s = withBoth(18.4);
    s = workspaceReducer(s, { type: "consent", value: true });
    s = workspaceReducer(s, { type: "voice/mode", mode: "new_voice", defaults: { languageCode: null, voiceId: null, tier: null } });
    expect(canStart({ project: s.project, config, available: true, balanceCents: 1_000_000, pricing: { status: "quoted", snapshot } })).toBe(false);
    s = workspaceReducer(s, { type: "voice/language", code: "en" });
    s = workspaceReducer(s, { type: "voice/voice", id: "warm" });
    s = workspaceReducer(s, { type: "lipsync/tier", tier: "studio" });
    expect(canStart({ project: s.project, config, available: true, balanceCents: 1_000_000, pricing: { status: "quoted", snapshot } })).toBe(true);
  });

  it("switching back to the original audio clears the voice and the tier", () => {
    let s = withBoth();
    s = workspaceReducer(s, { type: "voice/mode", mode: "new_voice", defaults: { languageCode: "en", voiceId: "warm", tier: "studio" } });
    s = workspaceReducer(s, { type: "voice/mode", mode: "original", defaults: { languageCode: null, voiceId: null, tier: null } });
    expect(s.project.voice).toEqual({ mode: "original", languageCode: null, voiceId: null });
    expect(s.project.lipSync.tier).toBeNull();
  });
});
