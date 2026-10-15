import { describe, expect, it } from "vitest";

import { KLING_OMNI } from "@/lib/ai/kling/features/capabilities";

import { loadPromptLibrary } from "./catalog";
import { IMAGE_TO_VIDEO_PROMPTS } from "./catalog-image-to-video";
import { TEXT_TO_VIDEO_PROMPTS } from "./catalog-text-to-video";
import { combinePrompt, readiness, requirementLabel, WORKSPACE_CAPABILITIES, type PromptSuggestion } from "./schema";
import { indexSuggestions, searchSuggestions } from "./search";

/** Owner's brief, 2026-10-15: "Frenz AI: smart video prompt suggestions". */
const t2v = loadPromptLibrary("text_to_video");
const i2v = loadPromptLibrary("image_to_video");
const all = [...TEXT_TO_VIDEO_PROMPTS, ...IMAGE_TO_VIDEO_PROMPTS];
const count = (lib: typeof t2v, cat: string) => lib.suggestions.filter((s) => s.category === cat).length;

describe("the catalog has what the brief lists, as complete prompts", () => {
  it("Text to Video: every category at its listed size (12, 20, 24, 10, 10, 10, 10, 8, 10)", () => {
    expect(
      Object.fromEntries(t2v.categories.map((c) => [c.id, count(t2v, c.id)])),
    ).toEqual({
      "character-replacement": 12,
      "short-movies": 20,
      "animal-kingdom": 24,
      "cinematic-vfx": 10,
      "social-viral": 10,
      "fashion-lifestyle": 10,
      "nature-travel": 10,
      "music-performance": 8,
      "business-advertising": 10,
    });
  });

  it("Image to Video: a different library, every category at its listed size (10, 8, 12, 10, 10, 8, 10, 8)", () => {
    expect(Object.fromEntries(i2v.categories.map((c) => [c.id, count(i2v, c.id)]))).toEqual({
      animate: 10,
      transformation: 8,
      cinematic: 12,
      animals: 10,
      product: 10,
      "anime-cartoon": 8,
      nature: 10,
      action: 8,
    });
    expect(i2v.suggestions.every((s) => s.mode === "image_to_video")).toBe(true);
    expect(t2v.suggestions.every((s) => s.mode === "text_to_video")).toBe(true);
  });

  it("every prompt is a real, complete instruction that fits the model's limit — not a title", () => {
    for (const s of all) {
      expect(s.prompt.length, s.id).toBeGreaterThan(200);
      expect(s.prompt.length, `${s.id} is over the model's ${KLING_OMNI.prompt.maxChars} characters`).toBeLessThanOrEqual(KLING_OMNI.prompt.maxChars);
      expect(s.prompt.trim(), s.id).toMatch(/[.!]$/);
      expect(s.title.length, s.id).toBeGreaterThan(3);
      expect(s.description.length, s.id).toBeGreaterThan(15);
    }
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
  });

  it("the brief's own example prompts are carried word for word", () => {
    const find = (title: string) => all.find((s) => s.title === title)!.prompt;
    expect(find("Short Action Movie")).toMatch(/^Create a high-energy cinematic action sequence featuring a skilled protagonist/);
    expect(find("Short African Folktale Movie")).toMatch(/^Create a visually rich cinematic African folktale/);
    expect(find("Cartoon Animal Kingdom")).toMatch(/^Create a colorful, high-quality 3D animated video set in a magical animal kingdom/);
    expect(find("Make My Photo Come Alive")).toMatch(/^Animate the subject in the uploaded image with subtle, natural movements/);
    expect(find("Animate My Product Photo")).toMatch(/^Animate the product in the uploaded image into a premium commercial video/);
  });

  it("every Image to Video prompt works FROM the uploaded image", () => {
    for (const s of IMAGE_TO_VIDEO_PROMPTS) expect(s.prompt, s.id).toMatch(/uploaded/);
  });

  it("featured suggestions exist in both libraries", () => {
    expect(t2v.suggestions.filter((s) => s.featured).length).toBeGreaterThanOrEqual(5);
    expect(i2v.suggestions.filter((s) => s.featured).length).toBeGreaterThanOrEqual(5);
  });

  it("teeth: an inactive suggestion or category is never returned by the loader", () => {
    const s = TEXT_TO_VIDEO_PROMPTS[0]!;
    s.active = false;
    try {
      expect(loadPromptLibrary("text_to_video").suggestions.some((x) => x.id === s.id)).toBe(false);
    } finally {
      s.active = true;
    }
  });
});

describe("references and model capabilities (no capability is invented)", () => {
  const byTitle = (t: string) => all.find((s) => s.title === t)!;
  const none = { firstFrame: false, referenceImages: 0, referenceVideo: false };

  it("both workspaces run the one Kling Omni model; only Text to Video can EDIT a reference video", () => {
    expect(WORKSPACE_CAPABILITIES.text_to_video.model).toBe(WORKSPACE_CAPABILITIES.image_to_video.model);
    expect(WORKSPACE_CAPABILITIES.text_to_video.capabilities).toContain("reference_video_edit");
    expect(WORKSPACE_CAPABILITIES.image_to_video.capabilities).not.toContain("reference_video_edit");
  });

  it("character replacement with a reference video asks for the video, then for 'Edit this video'", () => {
    const s = byTitle("Character Replace — Reference Video");
    expect(readiness(s, "text_to_video", none)).toEqual({ kind: "missing", needs: ["reference video"] });
    expect(readiness(s, "text_to_video", { ...none, referenceVideo: true, referenceVideoMode: "feature" })).toEqual({ kind: "switch-to-edit" });
    expect(readiness(s, "text_to_video", { ...none, referenceVideo: true, referenceVideoMode: "base" })).toEqual({ kind: "ready" });
    // Image to Video only copies a video's motion: it says so and points to Text to Video
    expect(readiness(s, "image_to_video", { ...none, firstFrame: true, referenceVideo: true })).toEqual({ kind: "unsupported", alternative: "text_to_video" });
    expect(requirementLabel(s, "text_to_video")).toBe("Needs a reference video to edit");
  });

  it("every character-replacement-in-a-video prompt is marked as needing a video to edit", () => {
    for (const s of t2v.suggestions.filter((x) => x.category === "character-replacement" && x.id !== "t2v.character-replacement.new-scene")) {
      expect(s.supportedModelCapabilities, s.id).toContain("reference_video_edit");
      expect(s.requiredAssets, s.id).toMatch(/video/);
    }
  });

  it("unrelated Text to Video prompts never ask for a reference", () => {
    const s = byTitle("Short Horror Movie");
    expect(s.requiredAssets).toBe("none");
    expect(readiness(s, "text_to_video", none)).toEqual({ kind: "ready" });
  });

  it("Image to Video prompts need the photo, and only the photo", () => {
    const s = byTitle("Animate My Pet");
    expect(readiness(s, "image_to_video", none)).toEqual({ kind: "missing", needs: ["photo"] });
    expect(readiness(s, "image_to_video", { ...none, firstFrame: true })).toEqual({ kind: "ready" });
  });

  it("teeth: a suggestion claiming a capability no workspace has is unavailable everywhere", () => {
    const fake = { requiredAssets: "video" as const, supportedModelCapabilities: ["first_frame", "reference_video_edit"] as PromptSuggestion["supportedModelCapabilities"] };
    expect(readiness(fake, "image_to_video", none)).toEqual({ kind: "unsupported", alternative: null });
  });
});

describe("search — instant, local, by title, category, purpose and tags", () => {
  const t = indexSuggestions(t2v.suggestions, t2v.categories);
  const i = indexSuggestions(i2v.suggestions, i2v.categories);

  it.each([
    ["Character replacement", "Character Replace"],
    ["Reference video", "Character Replace — Reference Video"],
    ["Animal kingdom", "Cartoon Animal Kingdom"],
    ["Short movie", "Short"],
    ["Action", "Short Action Movie"],
    ["Cartoon", "Cartoon"],
    ["Advert", "Advertisement"],
    ["African movie", "African"],
  ])("Text to Video: “%s” finds %s", (q, expected) => {
    const hits = searchSuggestions(t, q);
    expect(hits.length, q).toBeGreaterThan(0);
    expect(hits.slice(0, 3).some((s) => s.title.includes(expected)), `${q} → ${hits.slice(0, 3).map((s) => s.title).join(" | ")}`).toBe(true);
  });

  it.each([
    ["Anime", "Anime"],
    ["Product animation", "Product"],
    ["pet", "Pet"],
  ])("Image to Video: “%s” finds %s", (q, expected) => {
    const hits = searchSuggestions(i, q);
    expect(hits.slice(0, 3).some((s) => s.title.includes(expected)), q).toBe(true);
  });

  it("every word must match, and nonsense finds nothing (the empty state shows)", () => {
    expect(searchSuggestions(t, "horror")).toHaveLength(1);
    expect(searchSuggestions(t, "zzqxw")).toEqual([]);
    expect(searchSuggestions(t, "")).toHaveLength(t2v.suggestions.length);
  });
});

describe("inserting a suggestion", () => {
  it("replaces, or adds after the member's own words without deleting them, never past the limit", () => {
    expect(combinePrompt("", "B", "append", 100)).toBe("B");
    expect(combinePrompt("my idea  ", "B", "append", 100)).toBe("my idea\n\nB");
    expect(combinePrompt("my idea", "B", "replace", 100)).toBe("B");
    expect(combinePrompt("x".repeat(95), "suggestion", "append", 100)).toHaveLength(100);
  });
});
