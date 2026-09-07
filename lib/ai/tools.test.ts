import { describe, expect, it } from "vitest";

import {
  FRENZ_AI_TOOLS,
  frenzAiTool,
  toolAvailability,
  toolsForMedia,
  type FrenzAiCapabilities,
} from "./tools";

/**
 * Frenz AI's registry is read by BOTH the client (to decide what to offer) and
 * the route (to decide what to run). Every test here is really the same
 * assertion: the two can never disagree about what is possible, because a tool
 * offered and then refused is the shape of half the bugs already fixed on this
 * project.
 */

const full: FrenzAiCapabilities = { vision: true, transcription: true };
const today: FrenzAiCapabilities = { vision: true, transcription: false };
const none: FrenzAiCapabilities = { vision: false, transcription: false };

describe("the registry itself", () => {
  it("has unique ids and a blurb on every tool", () => {
    const ids = FRENZ_AI_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of FRENZ_AI_TOOLS) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.blurb.length).toBeGreaterThan(0);
      expect(t.appliesTo.length).toBeGreaterThan(0);
      expect(t.cost).toBeGreaterThan(0);
    }
  });

  it("charges a vision tool more than a text one", () => {
    // Reading stills is many times the work of rewriting a line of text.
    // Charging both as "one use" would let the expensive one hide inside every
    // usage number and every bill.
    const frames = FRENZ_AI_TOOLS.filter((t) => t.requires === "frames");
    const text = FRENZ_AI_TOOLS.filter((t) => t.requires === "text");
    expect(Math.min(...frames.map((t) => t.cost))).toBeGreaterThanOrEqual(
      Math.max(...text.map((t) => t.cost)),
    );
  });

  it("resolves a known id and refuses an unknown one", () => {
    expect(frenzAiTool("summarise")?.label).toBe("Summarise this");
    expect(frenzAiTool("not-a-tool")).toBeNull();
    expect(frenzAiTool("")).toBeNull();
  });
});

describe("availability is honest about what is not configured", () => {
  it("refuses audio tools, because nothing configured can transcribe", () => {
    // The point of the registry: these are DECLARED and marked unavailable
    // rather than hidden, so it is visible what adding a provider would unlock.
    for (const t of FRENZ_AI_TOOLS.filter((x) => x.requires === "audio")) {
      const a = toolAvailability(t, today);
      expect(a.available).toBe(false);
      expect(a.available === false && a.reason).toMatch(/speech-to-text/i);
    }
  });

  it("allows the same tools the day a transcription provider is added", () => {
    for (const t of FRENZ_AI_TOOLS) {
      expect(toolAvailability(t, full).available).toBe(true);
    }
  });

  it("refuses everything when no AI is configured at all", () => {
    for (const t of FRENZ_AI_TOOLS) {
      expect(toolAvailability(t, none).available).toBe(false);
    }
  });

  it("allows frames and text tools with vision alone — today's real state", () => {
    const runnable = FRENZ_AI_TOOLS.filter((t) => toolAvailability(t, today).available);
    expect(runnable.length).toBeGreaterThan(0);
    for (const t of runnable) expect(t.requires).not.toBe("audio");
  });
});

describe("tools are offered only where they make sense", () => {
  it("never offers a video tool on an image", () => {
    for (const t of toolsForMedia("image")) expect(t.appliesTo).toContain("image");
    expect(toolsForMedia("image").map((t) => t.id)).not.toContain("subtitles");
  });

  it("offers something for every media kind the app can save", () => {
    for (const kind of ["video", "image", "audio"] as const) {
      expect(toolsForMedia(kind).length).toBeGreaterThan(0);
    }
  });

  it("keeps registry order, so the list does not reshuffle between renders", () => {
    const ids = toolsForMedia("video").map((t) => t.id);
    const expected = FRENZ_AI_TOOLS.filter((t) => t.appliesTo.includes("video")).map((t) => t.id);
    expect(ids).toEqual(expected);
  });
});
