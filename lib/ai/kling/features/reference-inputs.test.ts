import { describe, expect, it } from "vitest";

import { KLING_OMNI, klingMaxReferenceImages } from "./capabilities";
import { klingImageToVideo } from "./image-to-video";
import { bindReferencePrompt, referenceItems, validateReferenceInputs } from "./shared";
import { klingTextToVideo } from "./text-to-video";
import { KLING_PRICING_DEFAULTS, quoteKling, type KlingPricingConfig } from "../pricing";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 REFERENCE INPUTS — the conditional ceiling, and the priced surcharge
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The vendor, verbatim: "reference_images: Up to 7 reference images (up to 4
 * when also using a reference video)".
 *
 * That second clause is the whole reason this file exists. A ceiling of 7 is
 * easy to get right and easy to test; a ceiling that CHANGES when an unrelated
 * field is filled is how a member composes six images, attaches a video, pays,
 * and gets a 400 from Kling. The rule lives in exactly one function and these
 * tests hold it there.
 */
const img = (n: number) => Array.from({ length: n }, (_, i) => `https://cdn.example.com/ref-${i}.jpg`);
const VIDEO = "https://cdn.example.com/ref.mp4";

describe("the reference-image ceiling", () => {
  it("is 7 on its own and 4 with a reference video", () => {
    expect(klingMaxReferenceImages(false)).toBe(7);
    expect(klingMaxReferenceImages(true)).toBe(4);
    // the table and the function must not drift apart
    expect(klingMaxReferenceImages(false)).toBe(KLING_OMNI.images.max);
    expect(klingMaxReferenceImages(true)).toBe(KLING_OMNI.images.maxWithReferenceVideo);
  });

  it("accepts 7 images alone", () => {
    expect(validateReferenceInputs({ referenceImageUrls: img(7) }).ok).toBe(true);
  });

  it("refuses an 8th image — the number the brief assumed", () => {
    const verdict = validateReferenceInputs({ referenceImageUrls: img(8) });
    expect(verdict.ok).toBe(false);
  });

  /*
    🔴 THE TEETH. Five images is VALID on its own and INVALID the moment a video
    joins it. A guard that only ever saw one of those two states would pass on an
    implementation that ignored the video entirely.
  */
  it("flips on the same image count when a video is attached", () => {
    expect(validateReferenceInputs({ referenceImageUrls: img(5) }).ok).toBe(true);
    const withVideo = validateReferenceInputs({ referenceImageUrls: img(5), referenceVideoUrl: VIDEO });
    expect(withVideo.ok).toBe(false);
    // and the message has to offer BOTH ways out, or it hides one of them
    if (!withVideo.ok) {
      expect(withVideo.reason).toContain("remove the video");
      expect(withVideo.reason).toContain("4");
    }
  });

  it("accepts 4 images with a video", () => {
    expect(validateReferenceInputs({ referenceImageUrls: img(4), referenceVideoUrl: VIDEO }).ok).toBe(true);
  });

  it("refuses a non-https or local reference", () => {
    expect(validateReferenceInputs({ referenceImageUrls: ["http://cdn.example.com/a.jpg"] }).ok).toBe(false);
    expect(validateReferenceInputs({ referenceVideoUrl: "https://127.0.0.1/a.mp4" }).ok).toBe(false);
  });

  it("refuses the same image twice — a paid slot spent on nothing", () => {
    const dupe = "https://cdn.example.com/same.jpg";
    expect(validateReferenceInputs({ referenceImageUrls: [dupe, dupe] }).ok).toBe(false);
  });
});

describe("both Omni features enforce it", () => {
  const base = { options: { aspectRatio: "16:9" as const } };
  it("text to video", () => {
    expect(klingTextToVideo.validate({ prompt: "a cat", ...base, referenceImageUrls: img(7) }).ok).toBe(true);
    expect(klingTextToVideo.validate({ prompt: "a cat", ...base, referenceImageUrls: img(5), referenceVideoUrl: VIDEO }).ok).toBe(false);
  });
  it("image to video", () => {
    const first = { firstFrameUrl: "https://cdn.example.com/first.jpg" };
    expect(klingImageToVideo.validate({ ...first, referenceImageUrls: img(7) }).ok).toBe(true);
    expect(klingImageToVideo.validate({ ...first, referenceImageUrls: img(5), referenceVideoUrl: VIDEO }).ok).toBe(false);
  });
});

describe("the request body carries them", () => {
  /*
    🔴 ROOT CAUSE, 2026-10-06: these went as `image` / `video`, which Omni
    accepts and IGNORES. Settled by generation: `refer_image` and
    `base_video` are read (the reference person appeared; the base clip was
    edited). This test used to assert the broken shape.
  */
  it("sends one `refer_image` item per reference and the video as `base_video` (edit) by default", () => {
    const body = klingTextToVideo.buildRequest({
      prompt: "a cat",
      options: { aspectRatio: "16:9" },
      referenceImageUrls: img(3),
      referenceVideoUrl: VIDEO,
    }) as { contents: { type: string; url?: string; text?: string }[]; settings: Record<string, unknown> };
    expect(body.contents.filter((c) => c.type === "refer_image")).toHaveLength(3);
    expect(body.contents.filter((c) => c.type === "base_video")).toHaveLength(1);
    expect(body.contents.some((c) => c.type === "image" || c.type === "video")).toBe(false);
    for (const c of body.contents) expect(KLING_OMNI.contentTypes).toContain(c.type);
    // Kling refuses video input in multi-shot mode
    expect(body.settings.multi_shot).toBe(false);
  });

  it("a motion reference goes as `feature_video`", () => {
    const body = klingTextToVideo.buildRequest({ prompt: "a cat", options: { aspectRatio: "16:9" }, referenceVideoUrl: VIDEO, referenceVideoMode: "feature" }) as { contents: { type: string }[] };
    expect(body.contents.map((c) => c.type)).toContain("feature_video");
  });

  it("the prompt NAMES the references (how Omni binds them), and a prompt that already does is left as typed", () => {
    const bound = bindReferencePrompt("make me dance", { referenceImageUrls: img(2), referenceVideoUrl: VIDEO });
    expect(bound).toContain("<<<video_1>>>");
    expect(bound).toContain("<<<image_1>>>, <<<image_2>>>");
    expect(bound).toContain("make me dance");
    const typed = "Replace the woman in <<<video_1>>> with <<<image_1>>>";
    expect(bindReferencePrompt(typed, { referenceImageUrls: img(1), referenceVideoUrl: VIDEO })).toBe(typed);
    expect(bindReferencePrompt("a cat", {})).toBe("a cat");
  });

  it("Image to Video sends a reference video as motion to follow, never a clip to edit", () => {
    const body = klingImageToVideo.buildRequest({ firstFrameUrl: img(1)[0]!, prompt: "dance", referenceVideoUrl: VIDEO, referenceVideoMode: "base" }) as { contents: { type: string }[]; settings: Record<string, unknown> };
    expect(body.contents.map((c) => c.type)).toContain("feature_video");
    expect(body.contents.map((c) => c.type)).not.toContain("base_video");
    expect(body.settings.multi_shot).toBe(false);
  });

  it("multi-shot with a reference video is refused before the charge", () => {
    expect(klingTextToVideo.validate({ prompt: "a cat", multiShot: true, options: { aspectRatio: "16:9" }, referenceVideoUrl: VIDEO }).ok).toBe(false);
  });

  it("sends nothing when nothing was attached", () => {
    expect(referenceItems({})).toEqual([]);
  });
});

describe("the surcharge is the operator's, never ours", () => {
  const priced = (over: Partial<KlingPricingConfig["matrix"]["text_to_video:720p"]>): KlingPricingConfig => ({
    ...KLING_PRICING_DEFAULTS,
    matrix: {
      ...KLING_PRICING_DEFAULTS.matrix,
      "text_to_video:720p": { ...KLING_PRICING_DEFAULTS.matrix["text_to_video:720p"], priceUsdCentsPerRun: 100, ...over },
    },
  });

  /*
    🔴 Zero by default. A deployment whose operator has set no surcharge must
    price a referenced generation exactly as it prices a plain one — inventing a
    figure nobody chose is the fabricated-number rule, applied to money.
  */
  it("defaults to no surcharge at all", () => {
    const c = priced({});
    const plain = quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 5 });
    const withRefs = quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 5, referenceImages: 7, referenceVideo: true });
    expect(plain.ok && withRefs.ok && withRefs.totalUsdCents).toBe(plain.ok ? plain.totalUsdCents : -1);
  });

  it("charges per image and once for the video, when the operator sets them", () => {
    const c = priced({ referenceImageSurchargeUsdCentsPerRun: 5, referenceVideoSurchargeUsdCentsPerRun: 50 });
    const plain = quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 5 });
    const three = quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 5, referenceImages: 3 });
    const threeAndVideo = quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 5, referenceImages: 3, referenceVideo: true });
    expect(plain.ok && three.ok && three.totalUsdCents - plain.totalUsdCents).toBe(15);
    expect(three.ok && threeAndVideo.ok && threeAndVideo.totalUsdCents - three.totalUsdCents).toBe(50);
  });

  it("cannot be made cheaper by a negative count", () => {
    const c = priced({ referenceImageSurchargeUsdCentsPerRun: 5 });
    const plain = quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 5 });
    const evil = quoteKling(c, { feature: "text_to_video", resolution: "720p", seconds: 5, referenceImages: -100 });
    expect(plain.ok && evil.ok && evil.totalUsdCents).toBe(plain.ok ? plain.totalUsdCents : -1);
  });

  it("never surcharges Lip Sync, whose video is the feature not a reference", () => {
    const c: KlingPricingConfig = {
      ...KLING_PRICING_DEFAULTS,
      matrix: {
        ...KLING_PRICING_DEFAULTS.matrix,
        "lip_sync:source": { ...KLING_PRICING_DEFAULTS.matrix["lip_sync:source"], priceUsdCentsPerRun: 100, referenceVideoSurchargeUsdCentsPerRun: 999 },
      },
    };
    const q = quoteKling(c, { feature: "lip_sync", resolution: "720p", seconds: 5, referenceVideo: true });
    expect(q.ok && q.totalUsdCents).toBe(100);
  });
});

/*
  2026-10-06, measured direct to Kling: a 5 s edit billed 4.5 units (0.9/s, the
  "with video input" rate) and an edit asked for 3 s came back — and billed —
  at the base clip length (5.04 s). The member price must follow both.
*/
describe("a reference video is priced at Kling's video-input rate and an edit at the clip length", () => {
  const paid: KlingPricingConfig = {
    ...KLING_PRICING_DEFAULTS,
    matrix: { ...KLING_PRICING_DEFAULTS.matrix, "text_to_video:720p": { ...KLING_PRICING_DEFAULTS.matrix["text_to_video:720p"], priceUsdCentsPerSecond: 12 } },
  };
  it("the per-second price rises by the video-input multiplier (1.5 by default)", () => {
    const plain = quoteKling(paid, { feature: "text_to_video", resolution: "720p", seconds: 5 });
    const withVideo = quoteKling(paid, { feature: "text_to_video", resolution: "720p", seconds: 5, referenceVideo: true });
    expect(plain.ok && plain.totalUsdCents).toBe(60);
    expect(withVideo.ok && withVideo.totalUsdCents).toBe(90);
  });
  it("an edit bills the longer of the asked length and the clip; an unmeasured clip bills the longest Kling accepts", async () => {
    const { klingTextToVideoPipeline } = await import("../pipelines/text-to-video");
    const q = (extra: Record<string, unknown>) =>
      klingTextToVideoPipeline.quote({ prompt: "x", options: { aspectRatio: "16:9", durationSeconds: 3 }, referenceVideoUrl: VIDEO, ...extra } as never, paid);
    const measured = q({ referenceVideoSeconds: 5.04 });
    expect(measured.ok && measured.seconds).toBeCloseTo(5.04, 2);
    const unmeasured = q({});
    expect(unmeasured.ok && unmeasured.seconds).toBe(KLING_OMNI.video.maxSeconds);
    const motionOnly = q({ referenceVideoMode: "feature", referenceVideoSeconds: 8 });
    expect(motionOnly.ok && motionOnly.seconds).toBe(3); // a motion reference does not set the length
  });
});
