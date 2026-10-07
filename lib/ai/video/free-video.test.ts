import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FREE_VIDEO, freeVideoQualifies } from "./free-video";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const ok = { options: { durationSeconds: 3, resolution: "720p" } };

describe("the complimentary video (owner 2026-10-07: 3 s, 720p, no reference video, once per device)", () => {
  it("the rules are the owner's", () => {
    expect(FREE_VIDEO).toEqual({ seconds: 3, resolution: "720p", allowReferenceVideo: false });
  });

  it("3 s at 720p qualifies, with or without a reference IMAGE", () => {
    expect(freeVideoQualifies(ok).ok).toBe(true);
    expect(freeVideoQualifies({ ...ok, referenceImageUrls: ["https://x/a.jpg"] } as never).ok).toBe(true);
  });

  it("teeth: longer, 1080p, unstated resolution, or a reference video never qualifies", () => {
    expect(freeVideoQualifies({ options: { durationSeconds: 5, resolution: "720p" } })).toMatchObject({ ok: false, reason: "duration" });
    expect(freeVideoQualifies({ options: { resolution: "720p" } })).toMatchObject({ ok: false, reason: "duration" });
    expect(freeVideoQualifies({ options: { durationSeconds: 3, resolution: "1080p" } })).toMatchObject({ ok: false, reason: "resolution" });
    expect(freeVideoQualifies({ options: { durationSeconds: 3 } })).toMatchObject({ ok: false, reason: "resolution" });
    expect(freeVideoQualifies({ ...ok, referenceVideoUrl: "https://x/v.mp4" })).toMatchObject({ ok: false, reason: "reference_video" });
  });

  it("create asks the shared pool ONLY for a qualifying request, and never without a device marker", () => {
    const create = read("lib/ai/video/create.ts");
    expect(create).toContain("freeVideoQualifies(opts.input as unknown as FreeVideoRequest).ok");
    expect(create).toContain("!cr.antiAbuse.deviceDetection || !!readDeviceId(opts.request)");
    expect(create).toContain("getCharacterReplaceFreeEligibility(");
    // the use is atomic in the database and is what the undo path restores
    expect(create).toContain("consumeFreeUse(");
    expect(create).toContain('funding_source: fundingKind');
    // a complimentary job charges nothing and never reads the wallet
    expect(create).toContain("chargedCents: useCredits || complimentary ? 0 : quote.totalUsdCents");
  });

  it("the jobs route hands the request over (device cookie + network), and the quote route plants the marker", () => {
    expect(read("app/api/ai/video/jobs/route.ts")).toMatch(/\n\s+request,\n\s+\}\);/);
    const quote = read("app/api/ai/video/quote/route.ts");
    expect(quote).toContain("deviceCookieHeader(newDeviceId())");
    expect(quote).toContain("freeVideoQualifies(");
  });
});
