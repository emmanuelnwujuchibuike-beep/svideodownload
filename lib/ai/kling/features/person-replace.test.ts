import { describe, expect, it } from "vitest";

import { KLING_PRICING_DEFAULTS, normalizeKlingPricing } from "../pricing";
import { klingPersonReplacePipeline } from "../pipelines/person-replace";
import { klingPersonReplace, maxImagesPerTarget, PERSON_REPLACE, type KlingPersonReplaceInput } from "./person-replace";
import {
  buildPersonReplacePrompt,
  describePeople,
  PERSON_DESCRIPTION_MAX_CHARS,
  referenceLayout,
  sanitizePersonDescription,
  sanitizeReplaceInstructions,
  type DetectedPerson,
} from "./person-replace-prompt";

/**
 * Character Replace on Kling Omni (2026-10-19) — the rules person-replace.ts and
 * person-replace-prompt.ts say are asserted here. Every guard has a case that
 * fails on a bad fixture.
 */

const person = (id: string, cx: number, h = 0.6): DetectedPerson => ({ id, score: 0.9, box: { x: cx - 0.08, y: 0.2, w: 0.16, h } });
const THREE = [person("p1", 0.2), person("p2", 0.5), person("p3", 0.8)];
const FACTS = { durationMs: 5000, width: 1280, height: 720, fps: 30, container: "mov,mp4,m4a,3gp,3g2,mj2", sizeBytes: 4 * 1024 * 1024 };
const photo = (n: string) => `https://storage.example.com/ref-${n}.jpg`;

const input = (over: Partial<KlingPersonReplaceInput> = {}): KlingPersonReplaceInput => ({
  videoUrl: "https://storage.example.com/clip.mp4",
  video: FACTS,
  people: THREE,
  frameMs: 600,
  targets: [{ personId: "p2", referenceImageUrls: [photo("a")] }],
  ...over,
});

describe("sanitising the member's words — a description can describe, never re-point", () => {
  it("strips Omni's placeholder and element syntax, brackets and every line break", () => {
    const s = sanitizePersonDescription("the man <<<image_2>>> @Bob\nin\u2028blue [shirt]");
    expect(s).not.toMatch(/[<>@[\]\n\u2028]/);
    expect(s).toContain("the man");
    expect(s).toContain("blue");
  });

  it("🔴 teeth: digits and ordinary letters survive (the regex must not eat 0, 2, 8 or 9)", () => {
    expect(sanitizePersonDescription("player number 2809")).toBe("player number 2809");
  });

  it("cuts at a word boundary and drops a description that is only punctuation", () => {
    const long = "the tall woman in the long red coat standing beside the fountain near the old stone bridge at dusk";
    const s = sanitizePersonDescription(long);
    expect(s.length).toBeLessThanOrEqual(PERSON_DESCRIPTION_MAX_CHARS);
    expect(long.startsWith(s)).toBe(true);
    expect(sanitizePersonDescription("?!...")).toBe("");
    expect(sanitizePersonDescription(null)).toBe("");
  });

  it("extra instructions keep free text but cannot hand one person's photo to the other", () => {
    const s = sanitizeReplaceInstructions("make it night <<<image_2>>> and rainy");
    expect(s).not.toContain("<<<");
    expect(s).toContain("make it night");
    expect(s).toContain("rainy");
  });
});

describe("where each person stands, in words", () => {
  it("names one, two and three people by position, with the count for three or more", () => {
    expect(describePeople([person("p1", 0.5)]).get("p1")!.position).toBe("the only person in the video");
    const two = describePeople([person("p1", 0.3), person("p2", 0.7)]);
    expect(two.get("p1")!.position).toBe("the person on the left");
    expect(two.get("p2")!.position).toBe("the person on the right");
    const three = describePeople(THREE);
    expect(three.get("p1")!.position).toMatch(/^the person on the far left/);
    expect(three.get("p2")!.position).toMatch(/^the person in the middle/);
    expect(three.get("p3")!.position).toContain("(the third of three people, counting from the left)");
  });

  it("orders by the box centre, not by the detector's ids", () => {
    const d = describePeople([person("p1", 0.8), person("p2", 0.2)]);
    expect(d.get("p2")!.position).toBe("the person on the left");
  });

  it("🔴 two people standing in the same place are ambiguous — and two far apart are not", () => {
    const close = describePeople([person("p1", 0.5), person("p2", 0.53), person("p3", 0.9)]);
    expect(close.get("p1")!.ambiguous).toBe(true);
    expect(close.get("p2")!.ambiguous).toBe(true);
    expect(close.get("p3")!.ambiguous).toBe(false);
    expect([...describePeople(THREE).values()].some((d) => d.ambiguous)).toBe(false);
  });

  it("calls a clearly taller person the foreground and a clearly shorter one the background", () => {
    const d = describePeople([person("p1", 0.2, 0.9), person("p2", 0.5, 0.5), person("p3", 0.8, 0.25)]);
    expect(d.get("p1")!.position).toContain("in the foreground");
    expect(d.get("p3")!.position).toContain("in the background");
  });
});

describe("🔴 which photo belongs to which person — the prompt and the request agree", () => {
  it("numbers target A's photos first, then target B's", () => {
    expect(referenceLayout([{ imageCount: 2 }, { imageCount: 1 }])).toEqual([[1, 2], [3]]);
    expect(referenceLayout([{ imageCount: 1 }, { imageCount: 3 }])).toEqual([[1], [2, 3, 4]]);
  });

  it("the prompt's image numbers are the order the request sends refer_image in", () => {
    const req = input({
      targets: [
        { personId: "p1", referenceImageUrls: [photo("a1"), photo("a2")] },
        { personId: "p3", referenceImageUrls: [photo("b1")] },
      ],
    });
    const body = klingPersonReplace.buildRequest(req) as { contents: { type: string; text?: string; url?: string }[] };
    const prompt = body.contents[0]!.text!;
    const refs = body.contents.filter((c) => c.type === "refer_image").map((c) => c.url);
    expect(refs).toEqual([photo("a1"), photo("a2"), photo("b1")]);
    const a = prompt.slice(prompt.indexOf("Person A:"), prompt.indexOf("Person B:"));
    const b = prompt.slice(prompt.indexOf("Person B:"));
    expect(a).toContain("the person on the far left");
    expect(a).toContain("with the person shown in <<<image_1>>> and <<<image_2>>>.");
    expect(a).not.toContain("<<<image_3>>>");
    expect(b).toContain("the person on the far right");
    expect(b).toContain("with the person shown in <<<image_3>>>.");
  });

  it("builds base_video last, no duration or aspect ratio, and multi_shot off", () => {
    const body = klingPersonReplace.buildRequest(input({ options: { resolution: "720p", audio: "original" } })) as { contents: { type: string }[]; settings: Record<string, unknown> };
    expect(body.contents.map((c) => c.type)).toEqual(["prompt", "refer_image", "base_video"]);
    expect(body.settings).toEqual({ resolution: "720p", audio: "original", multi_shot: false });
  });

  it("the member's extra changes come AFTER the replacement rules, quoted", () => {
    const p = buildPersonReplacePrompt({ people: THREE, frameMs: 600, targets: [{ personId: "p2", imageCount: 1 }], instructions: "make it night" });
    expect(p.indexOf("Person A")).toBeLessThan(p.indexOf('"make it night"'));
    expect(buildPersonReplacePrompt({ people: THREE, frameMs: 600, targets: [{ personId: "p2", imageCount: 1 }] })).not.toContain("Other changes");
  });
});

describe("validation — every refusal happens before a charge", () => {
  it("accepts one person with one photo", () => {
    expect(klingPersonReplace.validate(input()).ok).toBe(true);
  });

  it("refuses no target, three targets, an unknown person and the same person twice", () => {
    expect(klingPersonReplace.validate(input({ targets: [] })).ok).toBe(false);
    const three = ["p1", "p2", "p3"].map((id, i) => ({ personId: id, referenceImageUrls: [photo(String(i))] }));
    expect(klingPersonReplace.validate(input({ targets: three })).ok).toBe(false);
    expect(klingPersonReplace.validate(input({ targets: [{ personId: "p9", referenceImageUrls: [photo("a")] }] })).ok).toBe(false);
    const twice = [{ personId: "p1", referenceImageUrls: [photo("a")] }, { personId: "p1", referenceImageUrls: [photo("b")] }];
    expect(klingPersonReplace.validate(input({ targets: twice })).ok).toBe(false);
  });

  it("🔴 holds the documented 4-photo ceiling with a video, split between the people", () => {
    expect(PERSON_REPLACE.maxImagesTotal).toBe(4);
    expect(maxImagesPerTarget(1)).toBe(4);
    expect(maxImagesPerTarget(2)).toBe(2);
    expect(klingPersonReplace.validate(input({ targets: [{ personId: "p2", referenceImageUrls: ["a", "b", "c", "d"].map(photo) }] })).ok).toBe(true);
    expect(klingPersonReplace.validate(input({ targets: [{ personId: "p2", referenceImageUrls: ["a", "b", "c", "d", "e"].map(photo) }] })).ok).toBe(false);
    const twoEach = [{ personId: "p1", referenceImageUrls: [photo("a"), photo("b")] }, { personId: "p3", referenceImageUrls: [photo("c"), photo("d"), photo("e")] }];
    expect(klingPersonReplace.validate(input({ targets: twoEach })).ok).toBe(false);
  });

  it("refuses a target with no photo, and one photo attached twice", () => {
    expect(klingPersonReplace.validate(input({ targets: [{ personId: "p2", referenceImageUrls: [] }] })).ok).toBe(false);
    const shared = [{ personId: "p1", referenceImageUrls: [photo("a")] }, { personId: "p3", referenceImageUrls: [photo("a")] }];
    expect(klingPersonReplace.validate(input({ targets: shared })).ok).toBe(false);
  });

  it("🔴 an ambiguous person needs the member's description — and accepts one", () => {
    const close = [person("p1", 0.5), person("p2", 0.53)];
    expect(klingPersonReplace.validate(input({ people: close, targets: [{ personId: "p1", referenceImageUrls: [photo("a")] }] })).ok).toBe(false);
    expect(klingPersonReplace.validate(input({ people: close, targets: [{ personId: "p1", description: "the man in the blue shirt", referenceImageUrls: [photo("a")] }] })).ok).toBe(true);
    // punctuation alone is not a description
    expect(klingPersonReplace.validate(input({ people: close, targets: [{ personId: "p1", description: "...", referenceImageUrls: [photo("a")] }] })).ok).toBe(false);
  });

  it("refuses a video outside the documented limits, no people, a crowd, and generated sound on an edit", () => {
    expect(klingPersonReplace.validate(input({ video: { ...FACTS, durationMs: 12_000 } })).ok).toBe(false);
    expect(klingPersonReplace.validate(input({ people: [] })).ok).toBe(false);
    const crowd = Array.from({ length: PERSON_REPLACE.maxPeople + 1 }, (_, i) => person(`p${i + 1}`, 0.05 + i * 0.1, 0.3));
    expect(klingPersonReplace.validate(input({ people: crowd })).ok).toBe(false);
    expect(klingPersonReplace.validate(input({ options: { audio: "native" as never } })).ok).toBe(false);
    expect(klingPersonReplace.validate(input({ videoUrl: "http://storage.example.com/clip.mp4" })).ok).toBe(false);
  });

  it("refuses a detected box that is off the frame", () => {
    const bad = [{ id: "p1", score: 0.9, box: { x: 0.9, y: 0.1, w: 0.3, h: 0.5 } }];
    expect(klingPersonReplace.validate(input({ people: bad, targets: [{ personId: "p1", referenceImageUrls: [photo("a")] }] })).ok).toBe(false);
  });
});

describe("🔴 the price comes from the MEASURED clip, and the tool is never the free video", () => {
  const priced = normalizeKlingPricing({
    ...KLING_PRICING_DEFAULTS,
    matrix: { ...KLING_PRICING_DEFAULTS.matrix, "character_replace:720p": { ...KLING_PRICING_DEFAULTS.matrix["character_replace:720p"], enabled: true, priceUsdCentsPerSecond: 20 } },
  });

  it("bills the worker's duration, and a longer clip costs more", () => {
    const five = klingPersonReplacePipeline.quote(input(), priced);
    const ten = klingPersonReplacePipeline.quote(input({ video: { ...FACTS, durationMs: 10_000 } }), priced);
    if (!five.ok || !ten.ok) throw new Error("an enabled, priced tier must quote");
    expect(ten.totalUsdCents).toBeGreaterThan(five.totalUsdCents);
  });

  it("is never complimentary and bills against its own row", () => {
    expect(klingPersonReplacePipeline.complimentary).toBe(false);
    expect(klingPersonReplacePipeline.pricedAs).toBe("character_replace");
    expect(klingPersonReplacePipeline.aiFeature).toBe("ai_person_replace");
  });
});
