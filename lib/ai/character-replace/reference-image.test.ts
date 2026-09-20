import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildReferenceImageArgs, isKnownReferenceImageArg, REFERENCE_MAX_LONG_EDGE, type ReferenceImagePlan } from "./ffmpeg";
import { providerReferencePaths, referencePaths } from "./job-meta";

/**
 * 2026-09-20: a phone's JPEG (progressive, EXIF + thumbnail, XMP, ICC, IPTC)
 * broke the provider's own resize on two Skin + Face jobs. The worker now
 * hands every provider a plain baseline JPEG. These pin the plan and the
 * path the submit reads.
 */
describe("the reference image plan", () => {
  const plan: ReferenceImagePlan = { input: "/tmp/x/character-1.bin", output: "/tmp/x/character-1-prepared.jpg", maxEdge: REFERENCE_MAX_LONG_EDGE };

  it("strips every metadata block, writes ONE baseline JPEG frame, caps the long edge, and every argument is a known one", () => {
    const args = buildReferenceImageArgs(plan);
    expect(args).toContain("-map_metadata");
    expect(args[args.indexOf("-map_metadata") + 1]).toBe("-1");
    expect(args[args.indexOf("-frames:v") + 1]).toBe("1");
    expect(args[args.indexOf("-c:v") + 1]).toBe("mjpeg");
    expect(args[args.indexOf("-q:v") + 1]).toBe("2");
    expect(args[args.indexOf("-vf") + 1]).toContain(`min(iw,${REFERENCE_MAX_LONG_EDGE})`);
    expect(args[args.indexOf("-vf") + 1]).toContain("lanczos");
    expect(args[0]).toBe("-y");
    expect(args[args.length - 1]).toBe(plan.output);
    for (const a of args) expect(isKnownReferenceImageArg(a, plan), a).toBe(true);
    // nothing that could reach a shell or a colour transform
    expect(args.join(" ")).not.toMatch(/tonemap|colorspace|eq=|-filter_complex|;|&&/);
  });

  it("refuses an unknown argument or a different edge", () => {
    expect(isKnownReferenceImageArg("-vf", plan)).toBe(true);
    expect(isKnownReferenceImageArg("scale=100:100", plan)).toBe(false);
    expect(isKnownReferenceImageArg("/etc/passwd", plan)).toBe(false);
    expect(() => buildReferenceImageArgs({ ...plan, maxEdge: 4096 as unknown as typeof REFERENCE_MAX_LONG_EDGE })).toThrow();
  });
});

describe("which image path the provider reads", () => {
  const meta = {
    character: { path: "u/f/j/character.jpg", mime: "image/jpeg", size: 1, width: 10, height: 10, preparedPath: "u/f/j/character-prepared.jpg" },
    references: [
      { path: "u/f/j/character-2.png", mime: "image/png", size: 1, width: 10, height: 10, preparedPath: "u/f/j/character-2-prepared.jpg" },
      { path: "u/f/j/character-3.webp", mime: "image/webp", size: 1, width: 10, height: 10, preparedPath: null },
    ],
  };
  it("the prepared JPEG when the worker wrote one, the upload otherwise — uploads stay the paths /start stats", () => {
    expect(providerReferencePaths(meta)).toEqual(["u/f/j/character-prepared.jpg", "u/f/j/character-2-prepared.jpg", "u/f/j/character-3.webp"]);
    expect(referencePaths(meta)).toEqual(["u/f/j/character.jpg", "u/f/j/character-2.png", "u/f/j/character-3.webp"]);
    // a row from before 2026-09-20 has no preparedPath at all
    expect(providerReferencePaths({ character: { ...meta.character, preparedPath: undefined }, references: [] })).toEqual(["u/f/j/character.jpg"]);
  });
  it("the submit reads the provider paths and the worker records them", () => {
    const submit = readFileSync("lib/ai/character-replace/submit.ts", "utf8");
    expect(submit).toContain("const refs = providerReferencePaths(meta);");
    const prepare = readFileSync("server/services/ai-character-replace-prepare-service.ts", "utf8");
    expect(prepare).toContain("preparedPath: preparedReferencePaths[0] ?? null");
    expect(prepare).toContain('recordJobEvent(job.id, "reference.prepared"');
  });
});
